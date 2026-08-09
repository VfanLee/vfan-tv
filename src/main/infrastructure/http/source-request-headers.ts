import type { SourceHeaders } from '@shared/types'

const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'range'])
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])

export function resolveSourceRequestHeaders(
  sourceUrl: string,
  targetUrl: string,
  headers: SourceHeaders | Record<string, string>,
): Record<string, string> {
  const sameOrigin = isSameOrigin(sourceUrl, targetUrl)
  const resolved = new Map<string, { name: string; value: string }>()
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (typeof rawValue !== 'string') continue
    const name = rawName.trim()
    const normalized = name.toLowerCase()
    const value = rawValue.trim()
    if (!name || !value || BLOCKED_HEADERS.has(normalized)) continue
    if (SENSITIVE_HEADERS.has(normalized) && !sameOrigin) continue
    resolved.set(normalized, { name, value })
  }
  return Object.fromEntries([...resolved.values()].map(({ name, value }) => [name, value]))
}

export function mergeSourceRequestHeaders(
  sourceHeaders: Record<string, string>,
  overrideHeaders: Record<string, string>,
): Record<string, string> {
  const merged = new Map<string, { name: string; value: string }>()
  for (const [name, value] of [...Object.entries(sourceHeaders), ...Object.entries(overrideHeaders)]) {
    const normalized = name.trim().toLowerCase()
    if (!normalized || !value.trim() || BLOCKED_HEADERS.has(normalized)) continue
    merged.set(normalized, { name: name.trim(), value: value.trim() })
  }
  return Object.fromEntries([...merged.values()].map(({ name, value }) => [name, value]))
}

export function filterSensitiveRequestHeaders(
  headerOriginUrl: string,
  targetUrl: string,
  headers: Record<string, string>,
): Record<string, string> {
  if (isSameOrigin(headerOriginUrl, targetUrl)) return headers
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_HEADERS.has(name.trim().toLowerCase())),
  )
}

function isSameOrigin(sourceUrl: string, targetUrl: string): boolean {
  try {
    return new URL(sourceUrl).origin === new URL(targetUrl).origin
  } catch {
    return false
  }
}
