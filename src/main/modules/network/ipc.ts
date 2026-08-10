import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { networkSettingsSchema } from '@shared/schemas'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'
import { broadcastAppDataChange } from '../../ipc/broadcast'

export function registerNetworkIpc(context: ApplicationContext): void {
  const { network, settings } = context.services
  ipcMain.handle(IPC_CHANNELS.network.getStatus, () => network.getStatus())
  ipcMain.handle(IPC_CHANNELS.network.test, (_event, input: Parameters<AppApi['network']['test']>[0]) =>
    network.test({ ...input, settings: networkSettingsSchema.parse(input.settings) }),
  )
  ipcMain.handle(IPC_CHANNELS.network.save, async (_event, input: Parameters<AppApi['network']['save']>[0]) => {
    const parsed = networkSettingsSchema.parse(input)
    await network.applySettings(parsed)
    const updated = settings.update({ network: parsed }).network
    broadcastAppDataChange('settings')
    return updated
  })
}
