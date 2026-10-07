interface Option<T extends string> {
  value: T
  label: string
  disabled?: boolean
}
interface Props<T extends string> {
  legend: string
  name: string
  value: T
  options: ReadonlyArray<Option<T>>
  onChange: (value: T) => void
}

/** Native radios, so arrow keys, grouping and screen-reader semantics come for free. The input covers the label, so clicks and taps land on it. */
export function BrutalRadioGroup<T extends string>({ legend, name, value, options, onChange }: Props<T>) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 text-xs font-black uppercase tracking-[0.2em]">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
            <span className="block min-h-12 border-[3px] border-ink bg-paper px-3 py-3 text-sm font-black uppercase leading-none text-ink shadow-brutal-sm peer-checked:bg-ink peer-checked:text-white peer-disabled:opacity-50 peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-ink peer-focus-visible:shadow-[0_0_0_6px_#ffe600]">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
