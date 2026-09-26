// Inline SVG icons. All share a 20px grid, 1.5px stroke and currentColor,
// so they take their colour from the surrounding text.

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
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Three stacked lines of decreasing length: stored memories. Matches the favicon. */
export function MemoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5h12M4 10h9M4 14.5h6" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
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
