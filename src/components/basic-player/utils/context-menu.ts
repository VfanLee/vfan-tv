import type Artplayer from 'artplayer'
import type { Option } from 'artplayer'
import { buildDebugInfoText, type DebugInfoParams } from './playback-debug'
import { reloadPlayback } from './playback-engine'

/** 构建播放器右键菜单，点击时读取最新播放设置 */
export function createPlayerContextMenu(
  getDebugInfo: () => DebugInfoParams,
  displayPlaybackUrl: string,
  onAudioMenuMounted: (element: HTMLElement) => void,
): Option['contextmenu'] {
  return [
    {
      name: 'vfan-copy-url',
      html: '复制视频地址',
      /** 执行当前菜单项并更新播放器界面 */
      click(contextmenu) {
        void navigator.clipboard.writeText(displayPlaybackUrl)
        this.notice.show = '视频地址已复制'
        contextmenu.show = false
      },
      /** 设置菜单项的提示内容 */
      mounted(element) {
        element.title = displayPlaybackUrl
      },
    },
    {
      name: 'vfan-audio',
      html: '音效调节',
      style: { display: 'none' },
      /** 执行当前菜单项并更新播放器界面 */
      click(this: Artplayer, contextmenu) {
        this.setting.show = true
        contextmenu.show = false
      },
      mounted: onAudioMenuMounted,
    },
    {
      name: 'vfan-copy-debug',
      html: '复制调试信息',
      /** 执行当前菜单项并更新播放器界面 */
      click(contextmenu) {
        void navigator.clipboard.writeText(buildDebugInfoText(getDebugInfo()))
        this.notice.show = '调试信息已复制'
        contextmenu.show = false
      },
    },
    {
      name: 'vfan-stats',
      html: '统计信息',
      /** 执行当前菜单项并更新播放器界面 */
      click(contextmenu) {
        this.info.show = true
        contextmenu.show = false
      },
    },
    {
      name: 'vfan-refresh',
      html: '刷新',
      /** 执行当前菜单项并更新播放器界面 */
      click(contextmenu) {
        reloadPlayback(this)
        contextmenu.show = false
      },
    },
  ]
}
