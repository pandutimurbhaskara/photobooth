import { env } from 'cloudflare:workers'
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_WS_FRAME_BYTES, ROOM_IDLE_MS, SLOT_GRACE_MS } from '../shared/constants'
import { closeAll, joinAs, newRoom, openSocket, peek, pid } from './test-helpers'

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
