import { AudioIcon, DiaryIcon, ListIcon, TextIcon } from './icons'

/** The icon for each note type, shared by the filters, picker and badges. */
export const TYPE_ICON = {
  text: TextIcon,
  list: ListIcon,
  diary: DiaryIcon,
  audio: AudioIcon,
} as const
