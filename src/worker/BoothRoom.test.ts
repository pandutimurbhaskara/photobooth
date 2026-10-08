import { env } from 'cloudflare:workers'
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { CAPTURE_LEAD_MS, EXCHANGE_TIMEOUT_MS, MAX_WS_FRAME_BYTES, ROOM_IDLE_MS, SLOT_GRACE_MS } from '../shared/constants'
import { defaultPlan, type Plan, type PlanAction, type TemplateId } from '../shared/plan'
import { closeAll, joinAs, newRoom, openSocket, peek, pid, type TestClient } from './test-helpers'

afterEach(closeAll)

describe('create / status', () => {
  it('create succeeds once, then reports a collision', async () => {
    const stub = env.BOOTH_ROOM.getByName('AAAAAA')
    expect(await stub.create('AAAAAA')).toBe(true)
    expect(await stub.create('AAAAAA')).toBe(false)
    expect(await stub.status(null)).toEqual({ exists: true, full: false })
  })

  it('reports a never-created room as not existing', async () => {
    expect(await env.BOOTH_ROOM.getByName('BBBBBB').status(null)).toEqual({ exists: false, full: false })
  })

  it('refuses a websocket upgrade to a never-created room', async () => {
    const res = await env.BOOTH_ROOM.getByName('CCCCCC').fetch('https://booth.test/ws', { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(404)
  })

  it('refuses a plain GET (no upgrade)', async () => {
    const code = await newRoom()
    const res = await env.BOOTH_ROOM.getByName(code).fetch('https://booth.test/ws')
    expect(res.status).toBe(426)
  })
})

describe('join', () => {
  it('gives the first joiner slot a and a waiting snapshot; the second gets b; the first is told', async () => {
    const code = await newRoom()
    const a = await openSocket(code)
    a.send({ type: 'join', participantId: pid(1) })
    const snapA = await a.take('room-state')
    expect(snapA.state).toMatchObject({ code, you: 'a', phase: 'waiting', round: 0, captureAt: null })
    expect(snapA.state.participants.b).toBeNull()

    const b = await openSocket(code)
    b.send({ type: 'join', participantId: pid(2) })
    const snapB = await b.take('room-state')
    expect(snapB.state).toMatchObject({ you: 'b', phase: 'ready' })
    expect(snapB.state.participants.a).toMatchObject({ connected: true, ready: false })

    await a.take('partner-joined')
    const refreshed = await a.take('room-state')
    expect(refreshed.state.participants.b).toMatchObject({ connected: true })
  })

  it('never reveals participant ids to the other side', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    const b = await joinAs(code, 2)
    await a.take('partner-joined')
    const text = JSON.stringify([...a.messages, ...b.messages])
    expect(text).not.toContain(pid(1))
    expect(text).not.toContain(pid(2))
  })

  it('rejects a third participant with room-full / 4403, and status says full', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    await joinAs(code, 1)
    await joinAs(code, 2)
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(3) })
    expect((await c.take('error')).code).toBe('room-full')
    expect(await c.waitClose()).toBe(4403)
    expect(await stub.status(pid(3))).toEqual({ exists: true, full: true })
    // Review Focus: a member reloading a full booth must NOT be told it is full.
    expect(await stub.status(pid(1))).toEqual({ exists: true, full: false })
  })

  it('lets a known participantId reclaim its slot: old socket gets 4001, partner sees partner-joined not partner-left', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    const b = await joinAs(code, 2)
    b.clear()
    const a2 = await openSocket(code)
    a2.send({ type: 'join', participantId: pid(1) })
    expect((await a2.take('room-state')).state.you).toBe('a')
    expect(await a.waitClose()).toBe(4001)
    await b.take('partner-joined')
    await b.expectNone('partner-left')
  })

  it('closes a socket whose first message is not join', async () => {
    const code = await newRoom()
    const c = await openSocket(code)
    c.send({ type: 'ready' })
    expect((await c.take('error')).code).toBe('not-joined')
    expect(await c.waitClose()).toBe(4400)
  })

  it('refuses a second join on the same socket', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    a.send({ type: 'join', participantId: pid(9) })
    expect((await a.take('error')).code).toBe('invalid-message')
    expect(await a.waitClose()).toBe(4400)
  })
})

describe('leaving', () => {
  it('tells the partner and keeps the slot reserved until the grace period passes', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    const a = await joinAs(code, 1)
    const b = await joinAs(code, 2)
    await a.take('partner-joined')
    await a.settle() // the room-state refresh that follows partner-joined must not be mistaken for the one after the leave

    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const after = await a.take('room-state')
    expect(after.state.phase).toBe('waiting')
    expect(after.state.participants.b).toMatchObject({ connected: false, ready: false })

    // Still reserved for pid(2): a stranger is told "full".
    expect(await stub.status(pid(3))).toEqual({ exists: true, full: true })

    // Age the absence past the grace period: the slot frees up and a newcomer takes it.
    await runInDurableObject(stub, (instance) => {
      const slot = peek(instance).rec.slots.b
      if (slot) slot.lastSeenAt -= SLOT_GRACE_MS + 1
    })
    expect(await stub.status(pid(3))).toEqual({ exists: true, full: false })
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(3) })
    expect((await c.take('room-state')).state.you).toBe('b')
  })

  it('lets the leaver come back inside the grace period', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    const b = await joinAs(code, 2)
    await a.take('partner-joined')
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const b2 = await openSocket(code)
    b2.send({ type: 'join', participantId: pid(2) })
    expect((await b2.take('room-state')).state.you).toBe('b')
    await a.take('partner-joined')
  })
})

const OFFER = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' } as const
const ANSWER = { type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n' } as const
const CANDIDATE = { candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 }

describe('signaling relay', () => {
  it('relays offer, answer and ice-candidate to the partner only', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    const b = await joinAs(code, 2)
    await a.take('partner-joined')
    await Promise.all([a.settle(), b.settle()])

    a.send({ type: 'offer', offer: OFFER })
    expect((await b.take('offer')).offer).toEqual(OFFER)
    b.send({ type: 'answer', answer: ANSWER })
    expect((await a.take('answer')).answer).toEqual(ANSWER)
    a.send({ type: 'ice-candidate', candidate: CANDIDATE })
    expect((await b.take('ice-candidate')).candidate).toEqual(CANDIDATE)

    await a.expectNone('offer') // never echoed back to the sender
    await b.expectNone('answer')
  })

  it('drops signaling when the partner is not connected (nothing is queued for later)', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    a.send({ type: 'offer', offer: OFFER })
    await a.expectNone('error')
    const b = await joinAs(code, 2)
    await b.expectNone('offer')
  })
})

describe('ping', () => {
  it('echoes clientTime and adds serverTime', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    const before = Date.now()
    a.send({ type: 'ping', clientTime: 123 })
    const pong = await a.take('pong')
    expect(pong.clientTime).toBe(123)
    expect(pong.serverTime).toBeGreaterThanOrEqual(before - 5)
  })
})

describe('validation and limits', () => {
  it('closes on malformed JSON', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    a.sendRaw('{not json')
    expect((await a.take('error')).code).toBe('invalid-message')
    expect(await a.waitClose()).toBe(4400)
  })

  it('closes on an unknown field', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    a.send({ type: 'ready', extra: true })
    expect(await a.waitClose()).toBe(4400)
  })

  it('closes on an oversize frame', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    a.sendRaw('x'.repeat(MAX_WS_FRAME_BYTES + 1))
    expect(await a.waitClose()).toBe(4400)
  })

  it('closes with 4429 when a socket floods messages', async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    for (let i = 0; i < 100; i++) a.send({ type: 'ping', clientTime: i }) // bucket holds 60, refills 10/s
    expect(await a.waitClose()).toBe(4429)
    await a.settle(200) // let the server finish the already-queued tail before the test environment is torn down
  })

  it('refuses a fifth socket (flood guard)', async () => {
    const code = await newRoom()
    for (let i = 0; i < 4; i++) await openSocket(code)
    const res = await env.BOOTH_ROOM.getByName(code).fetch('https://booth.test/ws', { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(429)
  })
})

// Final review I5: half-open sockets on mobile networks. A raw 'ka' is answered by the runtime itself, without waking the object.
describe('keepalive', () => {
  it("answers a raw 'ka' with 'ok' and keeps the socket open", async () => {
    const code = await newRoom()
    const a = await joinAs(code, 1)
    a.sendRaw('ka')
    expect(await a.takeRaw('ok')).toBe('ok')
    a.send({ type: 'ping', clientTime: 5 })
    expect((await a.take('pong')).clientTime).toBe(5) // still a normal, joined socket
    expect(a.closeCode).toBeNull()
  })

  it("answers 'ka' even from a socket that has not joined yet, and keeps answering after the object is evicted", async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    const early = await openSocket(code)
    early.sendRaw('ka')
    expect(await early.takeRaw('ok')).toBe('ok')
    await evictDurableObject(stub)
    early.sendRaw('ka')
    expect(await early.takeRaw('ok')).toBe('ok')
  })
})

describe('expiry', () => {
  it('keeps a recently active room alive and re-arms the alarm', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.lastActivityAt = Date.now() - ROOM_IDLE_MS / 2
    })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect((await stub.status(null)).exists).toBe(true)
    expect(await runDurableObjectAlarm(stub)).toBe(true) // it re-armed itself
  })

  it('expires an idle room: sockets closed with 4000, storage wiped', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    const a = await joinAs(code, 1)
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.lastActivityAt = Date.now() - ROOM_IDLE_MS - 1
    })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect((await a.take('error')).code).toBe('expired')
    expect(await a.waitClose()).toBe(4000)
    expect(await stub.status(null)).toEqual({ exists: false, full: false })
  })
})

describe('hibernation', () => {
  it('keeps working after the object is evicted from memory', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    const a = await joinAs(code, 1)
    const b = await joinAs(code, 2)
    await a.take('partner-joined')
    await Promise.all([a.settle(), b.settle()])

    await evictDurableObject(stub)

    a.send({ type: 'ping', clientTime: 7 })
    expect((await a.take('pong')).clientTime).toBe(7)
    a.send({ type: 'offer', offer: OFFER }) // slot attachments survived
    expect((await b.take('offer')).offer).toEqual(OFFER)
  })
})

async function pair() {
  const code = await newRoom()
  const stub = env.BOOTH_ROOM.getByName(code)
  const a = await joinAs(code, 1)
  const b = await joinAs(code, 2)
  await a.take('partner-joined')
  await Promise.all([a.settle(), b.settle()])
  return { code, stub, a, b }
}

/** The plan needs a template before READY means anything. */
async function choosePair(template: TemplateId = 'duo2') {
  const ctx = await pair()
  ctx.a.send({ type: 'plan', action: { k: 'template', template } })
  await Promise.all([ctx.a.settle(), ctx.b.settle()])
  return ctx
}

describe('ready → scheduled capture', () => {
  it('schedules one capture, identical for both, once both are ready', async () => {
    const { a, b } = await choosePair()
    const before = Date.now()
    a.send({ type: 'ready' })
    const first = await a.take('room-state')
    expect(first.state.participants.a?.ready).toBe(true)
    expect(first.state.phase).toBe('ready')
    await b.expectNone('capture-scheduled')

    b.send({ type: 'ready' })
    const sa = await a.take('capture-scheduled')
    const sb = await b.take('capture-scheduled')
    expect(sa).toEqual(sb)
    expect(sa.round).toBe(1)
    expect(sa.captureAt).toBeGreaterThanOrEqual(before + CAPTURE_LEAD_MS)
    expect(sa.captureAt).toBeLessThan(before + CAPTURE_LEAD_MS + 2000)

    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'capture', round: 1, captureAt: sa.captureAt })
    expect(state.state.participants.a).toMatchObject({ ready: false, photoDone: false })
  })

  // Review Focus 1: both people press READY in the same instant.
  it('schedules exactly one round when both press ready at the same instant', async () => {
    const { a, b } = await choosePair()
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    expect((await a.take('capture-scheduled')).round).toBe(1)
    expect((await b.take('capture-scheduled')).round).toBe(1)
    await a.expectNone('capture-scheduled')
    await b.expectNone('capture-scheduled')
  })

  it('lets someone un-ready, and ignores ready while alone', async () => {
    const code = await newRoom()
    const solo = await joinAs(code, 1)
    solo.send({ type: 'ready' })
    expect((await solo.take('room-state')).state.participants.a?.ready).toBe(false) // ignored while waiting

    const b = await joinAs(code, 2)
    await solo.take('partner-joined')
    await solo.settle()
    solo.send({ type: 'plan', action: { k: 'template', template: 'duo2' } })
    await solo.settle()
    solo.send({ type: 'ready' })
    expect((await solo.take('room-state')).state.participants.a?.ready).toBe(true)
    solo.send({ type: 'unready' })
    expect((await solo.take('room-state')).state.participants.a?.ready).toBe(false)
    await b.expectNone('capture-scheduled')
  })

  it('ignores ready/unready while a round is in flight', async () => {
    const { a, b } = await choosePair()
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    await a.take('capture-scheduled')
    await a.settle()
    a.send({ type: 'ready' })
    a.send({ type: 'unready' })
    await a.expectNone('capture-scheduled')
    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'capture', round: 1 })
    expect(state.state.participants.a?.ready).toBe(false)
  })
})

describe('round lifecycle', () => {
  async function startRound() {
    const ctx = await choosePair()
    ctx.a.send({ type: 'ready' })
    ctx.b.send({ type: 'ready' })
    await ctx.a.take('capture-scheduled')
    await ctx.b.take('capture-scheduled')
    await Promise.all([ctx.a.settle(), ctx.b.settle()])
    return ctx
  }

  it('returns to ready when both report photo-complete, and the next round is numbered 2', async () => {
    const { a, b } = await startRound()
    a.send({ type: 'photo-complete', round: 1 })
    expect((await b.take('room-state')).state.participants.a?.photoDone).toBe(true)
    b.send({ type: 'photo-complete', round: 1 })
    await a.take('room-state') // broadcast for a's own completion (round still in flight)
    const done = await a.take('room-state') // broadcast after b completed: the round is over
    expect(done.state).toMatchObject({ phase: 'ready', captureAt: null, round: 1 })

    await Promise.all([a.settle(), b.settle()])
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    expect((await a.take('capture-scheduled')).round).toBe(2)
  })

  it('ignores a photo-complete for the wrong round, or when nothing is in flight', async () => {
    const { a, stub } = await startRound()
    a.send({ type: 'photo-complete', round: 0 })
    a.send({ type: 'photo-complete', round: 9 })
    await a.expectNone('room-state')
    await runInDurableObject(stub, (instance) => {
      expect(peek(instance).rec.slots.a?.photoDone).toBe(false)
    })
  })

  it('cancels the round when the partner disconnects mid-capture', async () => {
    const { a, b } = await startRound()
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'waiting', captureAt: null })
  })

  // Final review I1: nothing used to wake the room when a round's exchange timed out, so both people could sit in
  // "WAITING FOR THE PHOTOS..." indefinitely.
  it('arms an alarm for when this round would time out', async () => {
    const { stub } = await startRound()
    const [alarmAt, captureAt] = await runInDurableObject(stub, async (instance, state) => [
      await state.storage.getAlarm(),
      peek(instance).rec.captureAt,
    ])
    expect(captureAt).not.toBeNull()
    expect(alarmAt).not.toBeNull()
    expect(alarmAt as number).toBeLessThanOrEqual((captureAt as number) + EXCHANGE_TIMEOUT_MS)
  })

  it('pushes everyone back to ready when the exchange times out, without anyone sending anything', async () => {
    const { a, b, stub } = await startRound()
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.captureAt = Date.now() - EXCHANGE_TIMEOUT_MS - 1
    })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    for (const client of [a, b]) {
      const state = await client.take('room-state')
      expect(state.state).toMatchObject({ phase: 'ready', captureAt: null })
    }
    expect((await stub.status(null)).exists).toBe(true) // and the room itself is still alive
  })

  it('drops a capture whose exchange never finished once EXCHANGE_TIMEOUT_MS has passed', async () => {
    const { a, stub } = await startRound()
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.captureAt = Date.now() - EXCHANGE_TIMEOUT_MS - 1
    })
    a.send({ type: 'ready' })
    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'ready', captureAt: null })
    expect(state.state.participants.a?.ready).toBe(true) // the ready press was accepted
  })
})

describe('plan', () => {
  const act = (action: PlanAction) => ({ type: 'plan', action }) as const

  async function choose(a: TestClient, b: TestClient, template: TemplateId = 'duo2'): Promise<Plan> {
    a.send(act({ k: 'template', template }))
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    return state.plan
  }
  /** Both press ready; resolves with the round the server scheduled. */
  async function nextRound(a: TestClient, b: TestClient): Promise<number> {
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    const scheduled = await a.take('capture-scheduled')
    await b.take('capture-scheduled')
    await Promise.all([a.settle(), b.settle()])
    return scheduled.round
  }
  async function completeRound(a: TestClient, b: TestClient, round: number): Promise<Plan> {
    a.send({ type: 'photo-complete', round })
    b.send({ type: 'photo-complete', round })
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    return state.plan
  }
  const shootTake = async (a: TestClient, b: TestClient): Promise<Plan> => completeRound(a, b, await nextRound(a, b))
  /** Both press ready in the pick stage (they agree on the kept take). */
  async function bothReady(a: TestClient, b: TestClient): Promise<Plan> {
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    return state.plan
  }

  it('the join snapshot carries a default plan', async () => {
    const code = await newRoom()
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(1) })
    expect((await c.take('room-state')).state.plan).toEqual(defaultPlan())
  })

  // Review Focus 1: nobody stays committed to a plan they did not see.
  it('a plan change reaches both people and clears every ready flag', async () => {
    const { a, b } = await pair()
    const plan = await choose(a, b, 'duo2')
    expect(plan).toMatchObject({ v: 1, stage: 'format', template: 'duo2', kinds: ['both', 'both'], takes: [[], []], kept: [null, null] })

    a.send({ type: 'ready' })
    expect((await a.lastState()).participants.a?.ready).toBe(true)
    await b.settle()

    b.send(act({ k: 'kind', cell: 0, kind: 'a' }))
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sa.plan.kinds).toEqual(['a', 'both'])
    expect(sb.plan).toEqual(sa.plan)
    expect(sa.participants.a?.ready).toBe(false)
  })

  it('ignores ready until a template has been chosen', async () => {
    const { a, b } = await pair()
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    await a.expectNone('capture-scheduled')
    expect((await a.lastState()).participants.a?.ready).toBe(false)
  })

  it('both ready in the format stage locks the plan and schedules round 1', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    expect(await nextRound(a, b)).toBe(1)
    a.send({ type: 'ready' }) // refused while a round is in flight, but it re-syncs the caller
    expect((await a.lastState()).plan).toMatchObject({ stage: 'shoot', cell: 0, template: 'duo2' })
  })

  it('refuses plan actions while a round is in flight', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    await nextRound(a, b)
    a.send(act({ k: 'reset' }))
    const state = await a.lastState()
    expect(state.phase).toBe('capture')
    expect(state.plan).toMatchObject({ stage: 'shoot', template: 'duo2' })
  })

  it('records a take only once BOTH people report photo-complete', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    const round = await nextRound(a, b)
    a.send({ type: 'photo-complete', round })
    expect((await a.lastState()).plan.takes).toEqual([[], []])
    b.send({ type: 'photo-complete', round })
    const state = await a.lastState()
    expect(state.plan).toMatchObject({ stage: 'shoot', takes: [[1], []] })
  })

  // Review Focus 3: a failed exchange records nothing and leaves the cell in `shoot`.
  it('a round whose exchange times out records no take', async () => {
    const { a, b, stub } = await pair()
    await choose(a, b)
    await nextRound(a, b)
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.captureAt = Date.now() - EXCHANGE_TIMEOUT_MS - 1
    })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    const state = await a.lastState()
    expect(state.phase).toBe('ready')
    expect(state.plan).toMatchObject({ stage: 'shoot', takes: [[], []] })
  })

  it('the second take opens the pick with the latest preselected, and keep changes it for both', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    await shootTake(a, b)
    const plan = await shootTake(a, b)
    expect(plan).toMatchObject({ stage: 'pick', cell: 0, takes: [[1, 2], []], kept: [2, null] })

    a.send(act({ k: 'keep', round: 1 }))
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sa.plan.kept[0]).toBe(1)
    expect(sb.plan).toEqual(sa.plan)
  })

  // Review Focus 4
  it('refuses a keep for a round that is not a take, and converges when both keep at once', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    await shootTake(a, b)
    await shootTake(a, b)

    a.send(act({ k: 'keep', round: 99 }))
    expect((await a.lastState()).plan.kept[0]).toBe(2) // unchanged
    await b.settle()

    a.send(act({ k: 'keep', round: 1 }))
    b.send(act({ k: 'keep', round: 2 }))
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sb.plan).toEqual(sa.plan)
    expect([1, 2]).toContain(sa.plan.kept[0])
  })

  it('both ready in the pick stage moves to the next cell, then to done; ready in done is ignored', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    await shootTake(a, b)
    await shootTake(a, b)
    expect(await bothReady(a, b)).toMatchObject({ stage: 'shoot', cell: 1 })

    await shootTake(a, b)
    await shootTake(a, b)
    expect(await bothReady(a, b)).toMatchObject({ stage: 'done', takes: [[1, 2], [3, 4]], kept: [2, 4] })

    a.send({ type: 'ready' })
    expect((await a.lastState()).participants.a?.ready).toBe(false)
  })

  it('one more take adds a third and is then refused', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'polaroid')
    await shootTake(a, b)
    await shootTake(a, b)

    a.send(act({ k: 'more' }))
    expect((await a.lastState()).plan).toMatchObject({ stage: 'shoot', cell: 0 })
    await b.settle()
    const plan = await shootTake(a, b)
    expect(plan).toMatchObject({ stage: 'pick', takes: [[1, 2, 3]], kept: [3] })

    a.send(act({ k: 'more' }))
    expect((await a.lastState()).plan.stage).toBe('pick')
  })

  it('retake drops one cell and comes back to done, not to the next cell', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    for (let i = 0; i < 2; i++) {
      await shootTake(a, b)
      await shootTake(a, b)
      await bothReady(a, b)
    }
    a.send(act({ k: 'retake', cell: 1 }))
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    expect(state.plan).toMatchObject({ stage: 'shoot', cell: 1, takes: [[1, 2], []], kept: [2, null] })

    await shootTake(a, b)
    await shootTake(a, b)
    expect(await bothReady(a, b)).toMatchObject({ stage: 'done', takes: [[1, 2], [5, 6]], kept: [2, 6] })
  })

  it('reset keeps the template and kinds but clears the takes', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    a.send(act({ k: 'kind', cell: 0, kind: 'a' }))
    await Promise.all([a.lastState(), b.lastState()])
    await shootTake(a, b)

    a.send(act({ k: 'reset' }))
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    expect(state.plan).toMatchObject({ stage: 'format', template: 'duo2', kinds: ['a', 'both'], takes: [[], []], kept: [null, null] })
  })

  it('a person alone can reset (their photos may be gone), but nothing else', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    await a.settle()

    a.send(act({ k: 'kind', cell: 0, kind: 'a' }))
    const refused = await a.lastState()
    expect(refused.phase).toBe('waiting')
    expect(refused.plan.v).toBe(1)

    a.send(act({ k: 'reset' }))
    expect((await a.lastState()).plan).toMatchObject({ v: 2, stage: 'format', template: 'duo2' })
  })

  it('the plan survives a partner leaving and reclaiming their slot', async () => {
    const { code, a, b } = await pair()
    await choose(a, b, 'grid4')
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const back = await openSocket(code)
    back.send({ type: 'join', participantId: pid(2) })
    expect((await back.take('room-state')).state.plan).toMatchObject({ template: 'grid4', stage: 'format' })
  })

  it('gives a room persisted before plans existed a default plan', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    await joinAs(code, 1)
    await runInDurableObject(stub, async (instance, state) => {
      const rec = peek(instance).rec as { plan?: unknown }
      delete rec.plan
      await state.storage.put('room', rec)
    })
    await evictDurableObject(stub)
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(1) })
    expect((await c.take('room-state')).state.plan).toEqual(defaultPlan())
  })

  it('closes a socket that sends a malformed plan action', async () => {
    const { a } = await pair()
    a.send({ type: 'plan', action: { k: 'template', template: 'nope' } })
    expect((await a.take('error')).code).toBe('invalid-message')
    expect(await a.waitClose()).toBe(4400)
  })
})
