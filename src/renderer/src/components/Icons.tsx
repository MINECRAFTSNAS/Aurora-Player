import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

/** Win11 风格图标：21px 视觉尺寸，1.5px 描边，圆头圆角 */
const base = (p: P): P => ({
  width: 16,
  height: 16,
  viewBox: '0 0 21 21',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p
})

export const IconPlay = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 0 })} fill="currentColor">
    <path d="M6.5 4.2c0-.9 1-1.5 1.8-1L17 10.1c.8.5.8 1.6 0 2.1l-8.7 4.9c-.8.5-1.8-.1-1.8-1V4.2Z" />
  </svg>
)

export const IconPause = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 0 })} fill="currentColor">
    <rect x="5" y="3.6" width="4.2" height="14" rx="1.4" />
    <rect x="12" y="3.6" width="4.2" height="14" rx="1.4" />
  </svg>
)

export const IconStop = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 0 })} fill="currentColor">
    <rect x="4.5" y="4.5" width="12" height="12" rx="2.4" />
  </svg>
)

export const IconPrev = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 4.5v12" />
    <path d="M16 5.6v9.8c0 .8-.9 1.3-1.6.9l-7.3-4.9a1 1 0 0 1 0-1.7l7.3-4.9c.7-.5 1.6 0 1.6.8Z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconNext = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 4.5v12" />
    <path d="M5 5.6v9.8c0 .8.9 1.3 1.6.9l7.3-4.9a1 1 0 0 0 0-1.7L6.6 4.8C5.9 4.3 5 4.8 5 5.6Z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconShuffle = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h2.6c1.4 0 2.4.8 3.2 1.9l3.4 5.2c.8 1.1 1.8 1.9 3.2 1.9H18" />
    <path d="M3 15h2.6c1.4 0 2.4-.8 3.2-1.9l.9-1.4" />
    <path d="M12.1 7.9l.1-.1c.8-1.1 1.8-1.8 3.2-1.8H18" />
    <path d="M15.6 3.8 18 6l-2.4 2.2M15.6 12.8 18 15l-2.4 2.2" />
  </svg>
)

export const IconRepeatAll = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.5 7.5h10a3 3 0 0 1 3 3v.5" />
    <path d="M15.5 13.5h-10a3 3 0 0 1-3-3V10" />
    <path d="M13.4 5.2 15.7 7.5l-2.3 2.3M7.6 15.8 5.3 13.5l2.3-2.3" />
  </svg>
)

export const IconRepeatOne = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.5 7.5h10a3 3 0 0 1 3 3v.5" />
    <path d="M15.5 13.5h-10a3 3 0 0 1-3-3V10" />
    <path d="M13.4 5.2 15.7 7.5l-2.3 2.3M7.6 15.8 5.3 13.5l2.3-2.3" />
    <text x="10.5" y="12.1" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="600">
      1
    </text>
  </svg>
)

export const IconVolume = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8.4h2.7L10.6 5v11L6.7 12.6H4a1 1 0 0 1-1-1V9.4a1 1 0 0 1 1-1Z" fill="currentColor" stroke="none" />
    <path d="M13.6 7.6a5 5 0 0 1 0 5.8" />
    <path d="M15.9 5.3a8.4 8.4 0 0 1 0 10.4" />
  </svg>
)

export const IconVolumeMute = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8.4h2.7L10.6 5v11L6.7 12.6H4a1 1 0 0 1-1-1V9.4a1 1 0 0 1 1-1Z" fill="currentColor" stroke="none" />
    <path d="M14 8.5 18 12.5M18 8.5 14 12.5" />
  </svg>
)

export const IconSpeaker = IconVolume

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.5 4.5v12M4.5 10.5h12" />
  </svg>
)

export const IconFolderOpen = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6.2a1.7 1.7 0 0 1 1.7-1.7h3l1.6 1.8h6a1.7 1.7 0 0 1 1.7 1.7v.6" />
    <path d="M3 6.2v9.3a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.6-1.2l1.7-5.1a1 1 0 0 0-1-1.5H5.4a1.7 1.7 0 0 0-1.6 1.2L3 6.2Z" />
  </svg>
)

export const IconMusic = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 16.5V6.3l8-1.8v10.2" />
    <ellipse cx="6" cy="16.6" rx="2" ry="1.7" />
    <ellipse cx="14" cy="14.9" rx="2" ry="1.7" />
  </svg>
)

export const IconLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.4 11.6a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" />
    <path d="M12.6 9.4a3 3 0 0 0-4.2 0L5.8 12a3 3 0 0 0 4.2 4.2l1-1" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 6.5h12M8.5 6.5V4.9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.6" />
    <path d="M6.4 6.5l.7 9.2a1.4 1.4 0 0 0 1.4 1.3h4a1.4 1.4 0 0 0 1.4-1.3l.7-9.2" />
  </svg>
)

export const IconMinimize = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <path d="M4.5 10.5h12" />
  </svg>
)

export const IconMaximize = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <rect x="4.5" y="4.5" width="12" height="12" rx="1.6" />
  </svg>
)

export const IconRestore = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <rect x="4.2" y="7.2" width="9.6" height="9.6" rx="1.4" />
    <path d="M7.4 7.2V5.6a1.4 1.4 0 0 1 1.4-1.4h7.4a1.4 1.4 0 0 1 1.4 1.4V13a1.4 1.4 0 0 1-1.4 1.4h-1.6" />
  </svg>
)

export const IconClose = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <path d="M5.5 5.5l10 10M15.5 5.5l-10 10" />
  </svg>
)

export const IconPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.6 3.4 17.6 8.4l-1.8 1.1-.6 3.3-2.1-.5-3.7 3.7-1.2-1.2 3.7-3.7-.5-2.1 3.3-.6 1.1-1.8Z" />
    <path d="M8.5 13.5 4.5 17.5" />
  </svg>
)

export const IconMini = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5.5" width="14" height="10" rx="2" />
    <rect x="10.5" y="10.5" width="7" height="5" rx="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconWaves = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 11.5h1.6M7 7v8M10.5 4v12.5M14 8v6.5M17.5 10v2.5" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9.5" cy="9.5" r="4.8" />
    <path d="M13.2 13.2 17 17" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="2.6" />
    <path d="M10.5 2.8v2M10.5 16.2v2M2.8 10.5h2M16.2 10.5h2M5.1 5.1l1.5 1.5M14.4 14.4l1.5 1.5M5.1 15.9l1.5-1.5M14.4 6.6l1.5-1.5" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 11 8.5 15 16.5 6.5" />
  </svg>
)

export const IconLoading = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.5 3.5a7 7 0 1 0 7 7" strokeLinecap="round" />
  </svg>
)
