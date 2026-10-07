import { FILTERS, type FilterId } from '../lib/filters'
import { BrutalRadioGroup } from './BrutalRadioGroup'

export function FilterPicker({ value, onChange }: { value: FilterId; onChange: (id: FilterId) => void }) {
  return (
    <BrutalRadioGroup
      legend="Filter"
      name="filter"
      value={value}
      onChange={onChange}
      options={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
    />
  )
}
