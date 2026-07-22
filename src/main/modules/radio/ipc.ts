import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { ApplicationContext } from '../../app/composition-root'

export function registerRadioIpc(context: ApplicationContext): void {
  const { radio } = context.services
  ipcMain.handle(IPC_CHANNELS.radio.getCategories, () => radio.getCategories())
  ipcMain.handle(
    IPC_CHANNELS.radio.getCategoryChannels,
    (_event, categoryId: number, page?: number, pageSize?: number) =>
      radio.getCategoryChannels(categoryId, page, pageSize),
  )
  ipcMain.handle(IPC_CHANNELS.radio.getChannelDetail, (_event, channelId: number) => radio.getChannelDetail(channelId))
  ipcMain.handle(IPC_CHANNELS.radio.searchChannels, (_event, keyword: string, page?: number, pageSize?: number) =>
    radio.searchChannels(keyword, page, pageSize),
  )
  ipcMain.handle(IPC_CHANNELS.radio.getLivePrograms, (_event, channelIds: number[]) =>
    radio.getLivePrograms(channelIds),
  )
  ipcMain.handle(IPC_CHANNELS.radio.getRegions, () => radio.getRegions())
  ipcMain.handle(IPC_CHANNELS.radio.getBillboard, (_event, categoryId: number, regionId: number) =>
    radio.getBillboard(categoryId, regionId),
  )
}
