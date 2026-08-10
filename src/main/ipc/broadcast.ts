import { BrowserWindow, type WebContents } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppDataChangeDomain, UpdateEvent } from '@shared/types'

let latestUpdateEvent: UpdateEvent | undefined
let latestUpdateResultEvent: UpdateEvent | undefined

export function broadcastRendererEvent(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export function broadcastAppDataChange(domain: AppDataChangeDomain): void {
  broadcastRendererEvent(IPC_CHANNELS.window.appDataChanged, domain)
}

export function broadcastUpdateEvent(event: UpdateEvent): void {
  latestUpdateEvent = event
  if ('result' in event && event.result) latestUpdateResultEvent = event
  broadcastRendererEvent(IPC_CHANNELS.updates.event, event)
}

export function replayUpdateEvents(webContents: WebContents): void {
  if (webContents.isDestroyed()) return
  if (latestUpdateResultEvent && latestUpdateResultEvent !== latestUpdateEvent) {
    webContents.send(IPC_CHANNELS.updates.event, latestUpdateResultEvent)
  }
  if (latestUpdateEvent) webContents.send(IPC_CHANNELS.updates.event, latestUpdateEvent)
}
