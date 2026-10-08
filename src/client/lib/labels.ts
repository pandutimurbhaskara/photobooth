import type { CellKind, Stage, TemplateId } from '../../shared/plan'
import type { SlotName } from '../../shared/protocol'

export const STEPS = ['FORMAT', 'SHOOT', 'PICK', 'STYLE'] as const

/** `done` is the STYLE chip: the finished strip, where background, filter and retake live. */
export function stepIndex(stage: Stage): number {
  switch (stage) {
    case 'format':
      return 0
    case 'shoot':
      return 1
    case 'pick':
      return 2
    case 'done':
      return 3
  }
}

export const TEMPLATE_LABEL: Record<TemplateId, { title: string; sub: string }> = {
  strip4: { title: '4 CUT', sub: 'THE CLASSIC STRIP' },
  grid4: { title: '2 × 2', sub: 'FOUR, ON A CARD' },
  duo2: { title: '2 CUT', sub: 'TWO BIG PHOTOS' },
  polaroid: { title: 'POLAROID', sub: 'ONE SHOT' },
}

const KIND_LABEL: Record<CellKind, string> = { a: 'USER 1', b: 'USER 2', both: 'TOGETHER' }

/** USER 1 is slot a (the booth's creator), USER 2 is slot b. Your own side is marked so nobody has to count. */
export function kindLabel(kind: CellKind, mySlot: SlotName | null): string {
  return kind !== 'both' && kind === mySlot ? `${KIND_LABEL[kind]} (YOU)` : KIND_LABEL[kind]
}
