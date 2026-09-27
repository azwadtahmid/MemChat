// The date range on the notes view. Every choice is turned into local-time
// bounds, sent as ISO instants, so "August" means the user's own August.

export type RangeChoice =
  | { kind: 'any' }
  | { kind: 'week' }
  | { kind: 'thisMonth' }
  | { kind: 'lastMonth' }
  | { kind: 'thisYear' }
  | { kind: 'month'; month: string } // YYYY-MM
  | { kind: 'custom'; from: string; to: string } // YYYY-MM-DD, both inclusive; either may be empty

export const ANY_TIME: RangeChoice = { kind: 'any' }

export interface Bounds {
  created_from?: string // inclusive
  created_to?: string // exclusive
}

const day = (value: string): Date | null => {
  const [y, m, d] = value.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : null
}

const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)

export function bounds(choice: RangeChoice, now = new Date()): Bounds {
  const y = now.getFullYear()
  const m = now.getMonth()
  const iso = (from: Date | null, to: Date | null): Bounds => ({
    ...(from && { created_from: from.toISOString() }),
    ...(to && { created_to: to.toISOString() }),
  })
  switch (choice.kind) {
    case 'any':
      return {}
    case 'week':
      return iso(new Date(y, m, now.getDate() - 6), null)
    case 'thisMonth':
      return iso(new Date(y, m, 1), null)
    case 'lastMonth':
      return iso(new Date(y, m - 1, 1), new Date(y, m, 1))
    case 'thisYear':
      return iso(new Date(y, 0, 1), null)
    case 'month': {
      const [my, mm] = choice.month.split('-').map(Number)
      return my && mm ? iso(new Date(my, mm - 1, 1), new Date(my, mm, 1)) : {}
    }
    case 'custom': {
      const to = day(choice.to)
      return iso(day(choice.from), to && nextDay(to))
    }
  }
}

export function isActive(choice: RangeChoice): boolean {
  return Object.keys(bounds(choice)).length > 0
}
