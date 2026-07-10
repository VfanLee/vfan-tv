import { getRuntimeApi } from './client'
import type { MediaStreamDetectionInput, MediaStreamDetectionResult } from '@shared/types'

export async function getMediaProxyBaseUrl(): Promise<string> {
  const api = getRuntimeApi()
  return api ? api.media.getProxyBaseUrl() : ''
}

export async function detectMediaStreamType(
  input: MediaStreamDetectionInput,
): Promise<MediaStreamDetectionResult | undefined> {
  const api = getRuntimeApi()
  return api?.media.detectStreamType(input)
}
