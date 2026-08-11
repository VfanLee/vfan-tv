import type { ApplicationContext } from '../app/composition-root'
import { registerAppDataIpc } from '../modules/app-data/ipc'
import { registerHomeIpc } from '../modules/home/ipc'
import { registerLibraryIpc } from '../modules/library/ipc'
import { registerIptvSourcesIpc } from '../modules/iptv-sources/ipc'
import { registerMediaIpc } from '../modules/media/ipc'
import { registerNetworkIpc } from '../modules/network/ipc'
import { registerSettingsIpc } from '../modules/settings/ipc'
import { registerSourcesIpc } from '../modules/sources/ipc'
import { registerUpdatesIpc } from '../modules/updates/ipc'
import { registerRadioIpc } from '../modules/radio/ipc'
import { registerShellIpc } from './shell'
import { registerWindowIpc } from './window'

// 聚合注册各领域 IPC 处理器。
export function registerIpcHandlers(context: ApplicationContext): void {
  registerSourcesIpc(context)
  registerIptvSourcesIpc(context)
  registerHomeIpc(context)
  registerLibraryIpc(context)
  registerMediaIpc(context)
  registerRadioIpc(context)
  registerSettingsIpc(context)
  registerNetworkIpc(context)
  registerAppDataIpc(context)
  registerUpdatesIpc(context)
  registerWindowIpc(context)
  registerShellIpc()
}
