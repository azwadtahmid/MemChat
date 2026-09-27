// Inline SVG icons. All share a 20px grid, a single 1.6px round-capped
// stroke, no fills, and currentColor, in the landscape's loose ink language.

import { knot } from './scenery/paths'

type IconProps = { className?: string }

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * The MemChat mark: a knotted cord, the knot you tie to remember something.
 * One brush stroke in sumi, thin at the frayed ends. Monochrome; legible at
 * 16px and 64px.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d={knot} fill="currentColor" />
    </svg>
  )
}

// ---------- Note types: single-weight ink lines, no fills ----------

/** All: two pages, one resting on the other. */
export function AllIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.6 3.6c3.4-.1 6.8-.1 10.1.1.1 3.9.1 7.8-.1 11.7" />
      <path d="M3.4 6.6c3.4-.1 6.7-.1 10.1 0 .2 3.4.2 6.8 0 10.2-3.4.1-6.7.1-10.1-.1-.1-3.4-.1-6.7 0-10.1z" />
    </Icon>
  )
}

/** Notes (the view): a sheet with its corner folded down. */
export function NotesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.4 3.2c2.9-.1 5.9-.1 8.8 0l2.5 2.7c.1 3.6.1 7.2-.1 10.8-3.7.2-7.4.2-11.1 0-.2-4.5-.2-9 0-13.5z" />
      <path d="M13.1 3.3c-.1 1-.1 1.9 0 2.8.9.1 1.8.1 2.6-.1" />
    </Icon>
  )
}

/** Text: a page with lines of writing. */
export function TextIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 3.2c3.6-.1 7.3-.1 10.9.1.2 4.5.2 9 0 13.5-3.6.1-7.3.1-10.9-.1-.2-4.5-.2-9 0-13.5z" />
      <path d="M7.4 7.3c1.8-.1 3.6-.1 5.3.1M7.4 10.2c1.8-.1 3.6-.1 5.3 0M7.4 13.1c1.1 0 2.2 0 3.3.1" />
    </Icon>
  )
}

/** List: ticks beside lines. */
export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.9 5.7l1.3 1.4c.8-1.2 1.6-2.2 2.6-3" />
      <path d="M9.4 5.6c2.4-.1 4.8-.1 7.2.1" />
      <path d="M2.9 12.6l1.3 1.4c.8-1.2 1.6-2.2 2.6-3" />
      <path d="M9.4 12.5c2.4-.1 4.8 0 7.2.1" />
    </Icon>
  )
}

/** Diary: a bound book, its spine and binding rings, a day marked on the page. */
export function DiaryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.4 4.1c3.8-.1 7.6-.1 11.3.1.2 4.2.2 8.4 0 12.6-3.7.1-7.5.1-11.3-.1-.2-4.2-.2-8.4 0-12.6z" />
      <path d="M7.1 4.2c-.1 4.2-.1 8.4.1 12.6" />
      <path d="M9.8 2.6v3M13.2 2.6v3" />
      <path d="M10.4 10.2h3v3h-3z" />
    </Icon>
  )
}

/** Audio: a voice, drawn as a waveform. */
export function AudioIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.8 9.2v1.6M5.5 7v6M8.2 4.2v11.6M10.9 6.2v7.6M13.6 3.6v12.8M16.3 7.6v4.8" />
    </Icon>
  )
}

// ---------- Controls ----------

/** Opens the assistant: a speech line. */
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.2 4.5h11.6a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9.3l-3.6 2.9v-2.9H4.2A1.5 1.5 0 0 1 2.7 13V6a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M7 8.5h6M7 11h3.6" />
    </Icon>
  )
}

/** Brush plus: two strokes, very slightly curved. */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.1 3.6c-.2 4.3-.2 8.6.1 12.9" />
      <path d="M3.6 10.2c4.3-.3 8.6-.2 12.9.1" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.4 5.6c3 2.8 6 5.8 9 9M14.5 5.4c-3 3-6 6-9.1 9.1" />
    </Icon>
  )
}

export function SendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 15.5V4.5M5.5 9L10 4.5 14.5 9" />
    </Icon>
  )
}

export function BackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.5 5L6.5 10l5 5" />
    </Icon>
  )
}

export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5l5 5-5 5" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="9" r="4.8" />
      <path d="M12.6 12.6l3.6 3.6" />
    </Icon>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
      <path d="M5 10a5 5 0 0 0 10 0M10 15v2.5" />
    </Icon>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
    </Icon>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />
    </Icon>
  )
}

export function RestoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 8.5a5.5 5.5 0 1 1 .8 4.5M5 4.5v4h4" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 10.5l3.2 3.2L15 6.8" />
    </Icon>
  )
}
