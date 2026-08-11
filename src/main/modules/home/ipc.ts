import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'

/** 注册首页聚合数据与豆瓣热门分页的只读 IPC 处理器 */
export function registerHomeIpc(context: ApplicationContext): void {
  const { home, douban } = context.services
  ipcMain.handle(IPC_CHANNELS.home.get, () => home.get())
  ipcMain.handle(IPC_CHANNELS.home.getHot, (_event, input: Parameters<AppApi['home']['getHot']>[0]) =>
    douban.getRecentHotPage(input),
  )
}
