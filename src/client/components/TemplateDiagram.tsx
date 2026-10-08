import { TEMPLATES, type TemplateId } from '../../shared/plan'

/** A small picture of a template: white cells in a black frame, in the proportions of the real strip. */
export function TemplateDiagram({ template, size = 80 }: { template: TemplateId; size?: number }) {
  const { cols, rows } = TEMPLATES[template]
  const width = (size * (cols * 4)) / (rows * 3) // cells are 4:3
  return (
    <div
      aria-hidden="true"
      className="grid gap-1 border-[3px] border-ink bg-ink p-1"
      style={{ width, height: size, gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <span key={i} className="bg-white" />
      ))}
    </div>
  )
}
