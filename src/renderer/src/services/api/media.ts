import { getRuntimeApi } from './client'

export async function getMediaProxyBaseUrl(): Promise<string> {
  const api = getRuntimeApi()
  return api ? api.media.getProxyBaseUrl() : ''
}
