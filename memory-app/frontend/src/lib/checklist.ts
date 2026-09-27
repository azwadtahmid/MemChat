// List notes are plain markdown: one "- [ ] item" or "- [x] item" per line.
// There is no separate items array; ticking a box rewrites that one line.

const ITEM = /^(\s*)- \[( |x|X)\] ?(.*)$/

export interface ChecklistItem {
  line: number // index into body.split('\n')
  checked: boolean
  text: string
}

export function parseChecklist(body: string): ChecklistItem[] {
  const items: ChecklistItem[] = []
  body.split('\n').forEach((raw, line) => {
    const m = ITEM.exec(raw)
    if (m) items.push({ line, checked: m[2] !== ' ', text: m[3] })
  })
  return items
}

/** Lines that are not checklist items, such as a heading or a note under the list. */
export function otherLines(body: string): string {
  return body
    .split('\n')
    .filter((raw) => raw.trim() && !ITEM.test(raw))
    .join('\n')
}

export function toggleLine(body: string, line: number): string {
  const lines = body.split('\n')
  const m = ITEM.exec(lines[line] ?? '')
  if (!m) return body
  lines[line] = `${m[1]}- [${m[2] === ' ' ? 'x' : ' '}] ${m[3]}`
  return lines.join('\n')
}

export function addItem(body: string, text: string): string {
  const item = `- [ ] ${text.trim()}`
  const trimmed = body.replace(/\n+$/, '')
  return trimmed ? `${trimmed}\n${item}` : item
}

export function progress(body: string): { done: number; total: number } {
  const items = parseChecklist(body)
  return { done: items.filter((i) => i.checked).length, total: items.length }
}
