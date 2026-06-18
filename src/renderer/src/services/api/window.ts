import { getRuntimeApi } from './client'

export async function isWindowMaximized(): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.isMaximized() : false
}

export async function toggleWindowMaximize(): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.toggleMaximize() : false
}
