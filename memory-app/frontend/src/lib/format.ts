const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "26 September 2026", in the viewer's local time. Matches the chat's citation format. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "26 September 2026, 14:05" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${formatDate(iso)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "September 2026", from a diary entry date like "2026-09-26". */
export function monthLabel(entryDate: string): string {
  const [year, month] = entryDate.split('-').map(Number)
  return `${MONTHS[month - 1]} ${year}`
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export const TYPE_LABEL = { text: 'Text', list: 'List', diary: 'Diary', audio: 'Audio' } as const
