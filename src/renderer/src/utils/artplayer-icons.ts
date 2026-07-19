import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PictureInPicture2, Repeat, SkipForward, type LucideIcon } from 'lucide-react'

const ARTPLAYER_ICON_PROPS = {
  'size': 22,
  'strokeWidth': 1.75,
  'aria-hidden': true,
} as const

function createArtplayerLucideIcon(Icon: LucideIcon): string {
  return renderToStaticMarkup(createElement(Icon, ARTPLAYER_ICON_PROPS))
}

export const artplayerSettingIcons = {
  loop: createArtplayerLucideIcon(Repeat),
  autoNext: createArtplayerLucideIcon(SkipForward),
} as const

export const artplayerControlIcons = {
  miniWindow: createArtplayerLucideIcon(PictureInPicture2),
} as const

// 自定义开关图标（覆盖 ArtPlayer 默认 switchOn/switchOff）
// 开启：纯白实心轨道 + 深色滑块靠右；关闭：暗色镂空轨道 + 半透明滑块靠左
// 两者形态差异明显，避免开/关同色无法区分
export const artplayerSwitchIcons = {
  on: `<svg class="icon" width="26" height="26" viewBox="0 0 1664 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="1664" height="1024" rx="512" fill="#ffffff" />
    <circle cx="1152" cy="512" r="400" fill="#101010" />
  </svg>`,
  off: `<svg class="icon" width="26" height="26" viewBox="0 0 1664 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
    <rect x="44" y="44" width="1576" height="936" rx="468" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.55)" stroke-width="80" />
    <circle cx="512" cy="512" r="356" fill="rgba(255,255,255,0.7)" />
  </svg>`,
} as const
