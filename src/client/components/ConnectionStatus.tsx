import { BrutalBadge, type BadgeTone } from './BrutalBadge'

export type ConnKind = 'connected' | 'camera-ready' | 'waiting' | 'connecting' | 'reconnecting' | 'lost'

const MAP: Record<ConnKind, { glyph: string; text: string; tone: BadgeTone }> = {
  connected: { glyph: '●', text: 'CONNECTED', tone: 'lime' },
  'camera-ready': { glyph: '●', text: 'CAMERA READY', tone: 'yellow' },
  waiting: { glyph: '●', text: 'WAITING FOR THEM', tone: 'blue' },
  connecting: { glyph: '●', text: 'CONNECTING', tone: 'paper' },
  reconnecting: { glyph: '●', text: 'RECONNECTING', tone: 'orange' },
  lost: { glyph: '!', text: 'CONNECTION LOST', tone: 'orange' },
}

export function ConnectionStatus({ kind }: { kind: ConnKind }) {
  const m = MAP[kind]
  return (
    <BrutalBadge tone={m.tone} role="status">
      <span aria-hidden="true">{m.glyph}</span> {m.text}
    </BrutalBadge>
  )
}
