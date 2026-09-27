import type { RangeChoice } from '../lib/dateRange'

interface Props {
  value: RangeChoice
  onChange: (next: RangeChoice) => void
}

const PRESETS: { kind: RangeChoice['kind']; label: string }[] = [
  { kind: 'any', label: 'Any time' },
  { kind: 'week', label: 'Past 7 days' },
  { kind: 'thisMonth', label: 'This month' },
  { kind: 'lastMonth', label: 'Last month' },
  { kind: 'thisYear', label: 'This year' },
  { kind: 'month', label: 'A month' },
  { kind: 'custom', label: 'Between dates' },
]

const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** When a note was created: a preset, one month, or a range of days. */
export default function DateRange({ value, onChange }: Props) {
  function pick(kind: RangeChoice['kind']) {
    if (kind === 'month') onChange({ kind, month: thisMonth() })
    else if (kind === 'custom') onChange({ kind, from: '', to: '' })
    else onChange({ kind } as RangeChoice)
  }

  return (
    <div className="date-range" role="group" aria-label="Created">
      <label className="date-range-field">
        <span className="date-range-label">Created</span>
        <select value={value.kind} onChange={(e) => pick(e.target.value as RangeChoice['kind'])}>
          {PRESETS.map((p) => (
            <option key={p.kind} value={p.kind}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {value.kind === 'month' && (
        <label className="date-range-field">
          <span className="sr-only">Month</span>
          <input
            type="month"
            value={value.month}
            max={thisMonth()}
            onChange={(e) => onChange({ kind: 'month', month: e.target.value })}
          />
        </label>
      )}
      {value.kind === 'custom' && (
        <>
          <label className="date-range-field">
            <span className="date-range-label">From</span>
            <input
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </label>
          <label className="date-range-field">
            <span className="date-range-label">To</span>
            <input
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  )
}
