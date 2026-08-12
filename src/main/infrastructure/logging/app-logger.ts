import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import type { Stats } from 'fs'
import { dirname, join } from 'path'
import { formatWithOptions } from 'util'
import type { AppLogInfo } from '@shared/types'

const LOG_DIRECTORY_NAME = 'logs'
const LOG_FILE_NAME = 'main.log'
const PREVIOUS_LOG_FILE_NAME = 'main.previous.log'
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_ENTRY_LENGTH = 64 * 1024
const INSPECT_OPTIONS = { colors: false, depth: 5, maxArrayLength: 50, maxStringLength: 16_384 }
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_?token|api_?key|auth(?:_?key)?|key|password|pwd|secret|sign(?:ature)?|token|wssecret)=)[^&\s]*/gi
const SENSITIVE_HEADER_PATTERN = /\b(authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)([^|\r\n]+)/gi
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi
const SENSITIVE_HEADER_NAME_PATTERN =
  /(?:^|[-_])(?:authorization|cookie|token|secret|wssecret|api[-_]?key|key|password|passwd|pwd|sign|signature)(?:$|[-_])/i
const MAX_LOGGED_HEADERS_LENGTH = 2_048
const MAX_LOGGED_PARAMETERS_LENGTH = 4_096

const originalConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
}

let logFilePath: string | undefined
let previousLogFilePath: string | undefined
let currentFileSize = 0
let loggingFailureReported = false

/** 初始化主进程文件日志并保留原控制台输出 */
export function configureAppLogger(userDataPath: string): void {
  if (logFilePath) return

  const directoryPath = join(userDataPath, LOG_DIRECTORY_NAME)
  mkdirSync(directoryPath, { recursive: true })
  logFilePath = join(directoryPath, LOG_FILE_NAME)
  previousLogFilePath = join(directoryPath, PREVIOUS_LOG_FILE_NAME)
  if (!existsSync(logFilePath)) writeFileSync(logFilePath, '', 'utf8')
  currentFileSize = statSync(logFilePath).size
  if (currentFileSize > MAX_FILE_SIZE_BYTES) rotateLogFiles()

  console.debug = (...args: unknown[]) => writeConsoleEntry('DEBUG', originalConsole.debug, args)
  console.error = (...args: unknown[]) => writeConsoleEntry('ERROR', originalConsole.error, args)
  console.info = (...args: unknown[]) => writeConsoleEntry('INFO', originalConsole.info, args)
  console.log = (...args: unknown[]) => writeConsoleEntry('INFO', originalConsole.log, args)
  console.warn = (...args: unknown[]) => writeConsoleEntry('WARN', originalConsole.warn, args)
}

/** 返回日志路径、占用空间和轮转上限 */
export function getAppLogInfo(): AppLogInfo {
  const filePath = requireLogFilePath()
  const archivePath = requirePreviousLogFilePath()
  const currentStat = getFileStat(filePath)
  const previousStat = getFileStat(archivePath)
  return {
    directoryPath: dirname(filePath),
    filePath,
    fileSizeBytes: currentStat?.size ?? 0,
    totalSizeBytes: (currentStat?.size ?? 0) + (previousStat?.size ?? 0),
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    maxTotalSizeBytes: MAX_FILE_SIZE_BYTES * 2,
    updatedAt: Math.max(currentStat?.mtimeMs ?? 0, previousStat?.mtimeMs ?? 0) || undefined,
  }
}

/** 清空当前日志和历史日志，并保留可继续写入的空文件 */
export function clearAppLogs(): AppLogInfo {
  const filePath = requireLogFilePath()
  rmSync(requirePreviousLogFilePath(), { force: true })
  writeFileSync(filePath, '', 'utf8')
  currentFileSize = 0
  return getAppLogInfo()
}

/** 将敏感字段替换为固定占位符 */
export function redactSensitiveLogText(value: string): string {
  return value
    .replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED]@')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]')
    .replace(SENSITIVE_HEADER_PATTERN, '$1$2[REDACTED]')
}

/** 格式化请求头，并隐藏认证、Cookie、密钥和签名类字段 */
export function formatRequestHeadersForLog(headers: HeadersInit | undefined): string {
  if (!headers) return '—'
  try {
    const entries = [...new Headers(headers).entries()].sort(([left], [right]) => left.localeCompare(right))
    if (entries.length === 0) return '—'
    const formatted = entries
      .map(([name, value]) => {
        const safeName =
          name
            .replace(/[\r\n|;=]+/g, ' ')
            .trim()
            .slice(0, 80) || 'unknown'
        const safeValue = SENSITIVE_HEADER_NAME_PATTERN.test(name)
          ? '[REDACTED]'
          : redactSensitiveLogText(value)
              .replace(/[\r\n|]+/g, ' ')
              .trim()
              .slice(0, 512) || '—'
        return `${safeName}=${safeValue}`
      })
      .join('; ')
    return formatted.length > MAX_LOGGED_HEADERS_LENGTH
      ? `${formatted.slice(0, MAX_LOGGED_HEADERS_LENGTH)} …[请求头已截断]`
      : formatted
  } catch {
    return '无法解析'
  }
}

/** 将请求拆分为固定的请求方法、URL、请求头、URL 参数和 Body 参数字段 */
export function formatHttpRequestForLog(
  method: string | undefined,
  url: string,
  headers?: HeadersInit,
  body?: BodyInit | null,
): string {
  const target = formatRequestUrlForLog(url)
  return [
    `请求方法=${sanitizeInlineLogValue(method?.toUpperCase() || 'GET', 16)}`,
    `请求URL=${target.url}`,
    `请求头=${formatRequestHeadersForLog(headers)}`,
    `URL参数=${target.parameters}`,
    `Body参数=${formatRequestBodyForLog(body, headers)}`,
  ].join(' | ')
}

function formatRequestUrlForLog(value: string): { parameters: string; url: string } {
  try {
    const url = new URL(value)
    return {
      url: redactSensitiveLogText(`${url.origin}${url.pathname}`),
      parameters: formatParameterEntries([...url.searchParams.entries()], '&'),
    }
  } catch {
    return { url: '无效地址', parameters: '—' }
  }
}

function formatRequestBodyForLog(body: BodyInit | null | undefined, headers: HeadersInit | undefined): string {
  if (body === undefined || body === null) return '—'
  if (body instanceof URLSearchParams) return formatParameterEntries([...body.entries()], '&')
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return formatParameterEntries(
      [...body.entries()].map(([name, value]) => [name, typeof value === 'string' ? value : '[二进制文件]']),
    )
  }
  if (typeof body !== 'string') return `[${body.constructor?.name || '二进制内容'}，不记录内容]`

  const contentType = new Headers(headers).get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return formatParameterEntries([...new URLSearchParams(body).entries()], '&')
  }
  if (contentType.includes('json') || looksLikeJson(body)) {
    try {
      return truncateLogParameters(JSON.stringify(redactStructuredLogValue(JSON.parse(body))))
    } catch {
      return '[无效 JSON，不记录原文]'
    }
  }
  return truncateLogParameters(
    redactSensitiveLogText(body)
      .replace(/[\r\n|]+/g, ' ')
      .trim() || '—',
  )
}

function formatParameterEntries(entries: Array<[string, string]>, separator = '; '): string {
  if (entries.length === 0) return '—'
  const formatted = entries
    .map(([name, value]) => {
      const safeName = sanitizeInlineLogValue(name, 120)
      const safeValue = SENSITIVE_HEADER_NAME_PATTERN.test(name)
        ? '[REDACTED]'
        : sanitizeInlineLogValue(redactSensitiveLogText(value), 1_024)
      return `${safeName}=${safeValue}`
    })
    .join(separator)
  return truncateLogParameters(formatted)
}

function redactStructuredLogValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_HEADER_NAME_PATTERN.test(key)) return '[REDACTED]'
  if (depth >= 8) return '[内容层级过深]'
  if (Array.isArray(value)) return value.map((item) => redactStructuredLogValue(item, '', depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactStructuredLogValue(childValue, childKey, depth + 1),
      ]),
    )
  }
  return typeof value === 'string' ? redactSensitiveLogText(value) : value
}

function sanitizeInlineLogValue(value: string, maxLength: number): string {
  return (
    value
      .replace(/[\r\n|;=]+/g, ' ')
      .trim()
      .slice(0, maxLength) || '—'
  )
}

function truncateLogParameters(value: string): string {
  return value.length > MAX_LOGGED_PARAMETERS_LENGTH
    ? `${value.slice(0, MAX_LOGGED_PARAMETERS_LENGTH)} …[参数已截断]`
    : value
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function writeConsoleEntry(
  level: 'DEBUG' | 'ERROR' | 'INFO' | 'WARN',
  output: (...args: unknown[]) => void,
  args: unknown[],
): void {
  output(...args)
  if (!logFilePath) return
  try {
    const formatted = formatWithOptions(INSPECT_OPTIONS, ...args).replace(/\r?\n/g, ' \\n ')
    const sanitized = redactSensitiveLogText(formatted)
    const parsed = extractLogScope(sanitized)
    const message =
      parsed.message.length > MAX_ENTRY_LENGTH
        ? `${parsed.message.slice(0, MAX_ENTRY_LENGTH)} …[日志内容已截断]`
        : parsed.message
    const entry = `${new Date().toISOString()} | ${level} | pid=${process.pid} | scope=${parsed.scope} | ${message}\n`
    const entrySize = Buffer.byteLength(entry)
    if (currentFileSize > 0 && currentFileSize + entrySize > MAX_FILE_SIZE_BYTES) rotateLogFiles()
    appendFileSync(logFilePath, entry, 'utf8')
    currentFileSize += entrySize
  } catch (error) {
    if (loggingFailureReported) return
    loggingFailureReported = true
    originalConsole.error('Failed to write application log:', error)
  }
}

function extractLogScope(value: string): { message: string; scope: string } {
  const match = /^\[([^\]\r\n]{1,40})\]\s*/.exec(value)
  if (!match) return { message: value, scope: 'main' }
  return {
    message: value.slice(match[0].length),
    scope: match[1].replaceAll('|', ' ').trim() || 'main',
  }
}

function rotateLogFiles(): void {
  const filePath = requireLogFilePath()
  const archivePath = requirePreviousLogFilePath()
  rmSync(archivePath, { force: true })
  if (currentFileSize > MAX_FILE_SIZE_BYTES) {
    const contents = readFileSync(filePath)
    writeFileSync(archivePath, contents.subarray(Math.max(0, contents.byteLength - MAX_FILE_SIZE_BYTES)))
    writeFileSync(filePath, '', 'utf8')
  } else if (currentFileSize > 0) {
    renameSync(filePath, archivePath)
    writeFileSync(filePath, '', 'utf8')
  }
  currentFileSize = 0
}

function getFileStat(filePath: string): Stats | undefined {
  try {
    return statSync(filePath)
  } catch {
    return undefined
  }
}

function requireLogFilePath(): string {
  if (!logFilePath) throw new Error('应用日志尚未初始化')
  return logFilePath
}

function requirePreviousLogFilePath(): string {
  if (!previousLogFilePath) throw new Error('应用日志尚未初始化')
  return previousLogFilePath
}
