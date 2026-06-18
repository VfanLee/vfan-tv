import type { AppApi } from '@shared/types'

const RUNTIME_UNAVAILABLE_MESSAGE = '当前运行环境不支持此操作'

export function getRuntimeApi(): AppApi | undefined {
  return window.api
}

export function isApiAvailable(): boolean {
  return Boolean(getRuntimeApi())
}

export function requireRuntimeApi(): AppApi {
  const api = getRuntimeApi()

  if (!api) {
    throw new Error(RUNTIME_UNAVAILABLE_MESSAGE)
  }

  return api
}
