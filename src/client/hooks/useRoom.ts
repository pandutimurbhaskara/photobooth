import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMessage, RoomState, ServerMessage } from '../../shared/protocol'
import { RoomSocket, type SocketStatus } from '../lib/room-socket'
import { useLatest } from './useLatest'

interface Options {
  code: string
  participantId: string
  enabled: boolean
  onMessage: (message: ServerMessage, isSnapshot: boolean) => void
}

export function useRoom({ code, participantId, enabled, onMessage }: Options) {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const [closeCode, setCloseCode] = useState<number | null>(null)
  const [state, setState] = useState<RoomState | null>(null)
  const socketRef = useRef<RoomSocket | null>(null)
  const latest = useLatest(onMessage)

  useEffect(() => {
    if (!enabled) return
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new RoomSocket({
      url: `${scheme}://${location.host}/api/rooms/${code}/ws`,
      participantId,
      onStatus: (s, c) => {
        setStatus(s)
        setCloseCode(c)
      },
      onMessage: (m, isSnapshot) => {
        if (m.type === 'room-state') setState(m.state)
        latest.current(m, isSnapshot)
      },
    })
    socketRef.current = socket
    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [enabled, code, participantId, latest])

  const send = useCallback((message: ClientMessage): boolean => socketRef.current?.send(message) ?? false, [])
  const reconnect = useCallback(() => socketRef.current?.reconnect(), [])
  return { status, closeCode, state, send, reconnect }
}
