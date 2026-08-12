import { DOMParser } from '@xmldom/xmldom'
import { randomUUID } from 'crypto'
import type { UpdateCheckResult } from '@shared/types'
import { formatHttpRequestForLog } from '../../infrastructure/logging/app-logger'
import type { ContentNetworkService } from '../../infrastructure/network/content-network.service'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const LATEST_RELEASE_API_PATH = 'https://api.github.com/repos/vfanlee/vfan-tv/releases/latest'
const RELEASES_FEED_PATH = `${REPOSITORY_URL}/releases.atom`
const LATEST_RELEASE_PATH = `${REPOSITORY_URL}/releases/latest`
const REQUEST_HEADERS = { 'User-Agent': 'vfan-tv-update-checker' }
const REQUEST_TIMEOUT_MS = 10_000

/** 描述 GitHub Release 的版本、说明、页面和安装包信息 */
export interface LatestRelease {
  assets?: DownloadAsset[]
  name: string
  notes: string
  tag: string
  url: string
}

interface DownloadAsset {
  name: string
  url: string
}

interface GitHubReleaseAssetPayload {
  browser_download_url?: unknown
  name?: unknown
}

interface GitHubReleasePayload {
  assets?: unknown
  body?: unknown
  html_url?: unknown
  name?: unknown
  tag_name?: unknown
}

function parseVersion(version: string): [number, number, number] {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) {
    throw new Error(`无法识别版本号：${version}`)
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 比较两个规范的三段式版本号，忽略可选的 `v` 前缀和预发布后缀 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseVersion(candidate)
  const currentParts = parseVersion(current)

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index]
    }
  }

  return false
}

function getTextContent(element: Element | undefined): string {
  return element?.textContent?.trim() ?? ''
}

function getReleaseNotes(content: Element | undefined): string {
  const html = getTextContent(content)
  if (!html) return '此版本暂无更新说明。'

  const document = new DOMParser().parseFromString(html, 'text/html')
  return document.documentElement.textContent?.trim() || '此版本暂无更新说明。'
}

function normalizeReleaseText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseReleaseAssets(assets: unknown): DownloadAsset[] {
  if (!Array.isArray(assets)) return []

  return assets.flatMap((asset: GitHubReleaseAssetPayload) => {
    const name = normalizeReleaseText(asset.name)
    const url = normalizeReleaseText(asset.browser_download_url)

    return name && url ? [{ name, url }] : []
  })
}

/** 校验并归一化 GitHub Latest Release API 响应 */
export function parseLatestReleasePayload(payload: GitHubReleasePayload): LatestRelease {
  const tag = normalizeReleaseText(payload.tag_name)

  if (!tag) {
    throw new Error('无法识别 GitHub Release API 中的版本号')
  }

  const releaseUrl = normalizeReleaseText(payload.html_url) || `${REPOSITORY_URL}/releases/tag/${tag}`
  const notes = normalizeReleaseText(payload.body)

  return {
    assets: parseReleaseAssets(payload.assets),
    name: normalizeReleaseText(payload.name) || `Vfan TV ${tag}`,
    notes: notes || '此版本暂无更新说明。',
    tag,
    url: releaseUrl,
  }
}

async function fetchLatestReleaseFromApi(network: ContentNetworkService): Promise<LatestRelease> {
  const response = await fetchUpdate(network, LATEST_RELEASE_API_PATH, {
    headers: {
      ...REQUEST_HEADERS,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`GitHub Release API 请求失败（HTTP ${response.status}）`)
  }

  return parseLatestReleasePayload((await response.json()) as GitHubReleasePayload)
}

function parseReleaseFeed(xml: string): LatestRelease {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const entry = document.getElementsByTagName('entry')[0]

  if (!entry) {
    throw new Error('Release Feed 中暂无公开版本')
  }

  const releaseLink = Array.from(entry.getElementsByTagName('link')).find(
    (link) => link.getAttribute('rel') === 'alternate',
  )
  const releaseUrl = releaseLink?.getAttribute('href') ?? ''
  const tag = releaseUrl.match(/\/tag\/([^/?#]+)/)?.[1]

  if (!releaseUrl || !tag) {
    throw new Error('无法识别 Release Feed 中的版本链接')
  }

  return {
    name: getTextContent(entry.getElementsByTagName('title')[0]) || `Vfan TV ${tag}`,
    notes: getReleaseNotes(entry.getElementsByTagName('content')[0]),
    tag,
    url: `${REPOSITORY_URL}/releases/tag/${tag}`,
  }
}

async function fetchLatestReleaseFromFeed(network: ContentNetworkService): Promise<LatestRelease> {
  const response = await fetchUpdate(network, RELEASES_FEED_PATH, {
    headers: {
      ...REQUEST_HEADERS,
      Accept: 'application/atom+xml',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`GitHub Release Feed 请求失败（HTTP ${response.status}）`)
  }

  return parseReleaseFeed(await response.text())
}

async function fetchLatestReleaseFromRedirect(network: ContentNetworkService): Promise<LatestRelease> {
  const response = await fetchUpdate(network, LATEST_RELEASE_PATH, {
    headers: REQUEST_HEADERS,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const releaseUrl = response.headers.get('location') ?? ''
  const tag = releaseUrl.match(/\/tag\/([^/?#]+)/)?.[1]

  if (!tag) {
    throw new Error(`GitHub Release 重定向请求失败（HTTP ${response.status}）`)
  }

  return {
    name: `Vfan TV ${tag}`,
    notes: '请前往 GitHub Release 页面查看更新说明。',
    tag,
    url: `${REPOSITORY_URL}/releases/tag/${tag}`,
  }
}

async function fetchLatestRelease(network: ContentNetworkService): Promise<LatestRelease> {
  try {
    return await fetchLatestReleaseFromApi(network)
  } catch (apiError) {
    try {
      return await fetchLatestReleaseFromFeed(network)
    } catch (feedError) {
      try {
        return await fetchLatestReleaseFromRedirect(network)
      } catch (redirectError) {
        throw new Error(formatReleaseFetchErrors([apiError, feedError, redirectError]))
      }
    }
  }
}

/** 返回当前发布命名约定下与平台、架构匹配的安装包文件名 */
export function getReleaseAssetNames(version: string, platform: NodeJS.Platform, arch: string): string[] {
  if (platform === 'win32') {
    return [`vfan-tv-v${version}-${arch}-setup.exe`]
  }

  if (platform === 'darwin') {
    return [`vfan-tv-v${version}-${arch}.dmg`]
  }

  return []
}

function formatReleaseFetchErrors(errors: unknown[]): string {
  return errors.map((error) => getErrorMessage(error)).join('\n')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function assetExists(network: ContentNetworkService, url: string): Promise<boolean> {
  try {
    const response = await fetchUpdate(network, url, {
      headers: {
        ...REQUEST_HEADERS,
        Range: 'bytes=0-0',
      },
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    await response.body?.cancel()

    return response.ok || (response.status >= 300 && response.status < 400)
  } catch {
    return false
  }
}

async function resolveDownloadAsset(
  tag: string,
  version: string,
  platform: NodeJS.Platform,
  arch: string,
  network: ContentNetworkService,
  releaseAssets: DownloadAsset[] = [],
): Promise<DownloadAsset | undefined> {
  const assetNames = getReleaseAssetNames(version, platform, arch)

  for (const name of assetNames) {
    const releaseAsset = releaseAssets.find((asset) => asset.name === name)
    if (releaseAsset) {
      return releaseAsset
    }

    const canonicalUrl = `${REPOSITORY_URL}/releases/download/${tag}/${name}`
    const exists = await assetExists(network, canonicalUrl)
    if (exists) {
      return { name, url: canonicalUrl }
    }
  }

  return undefined
}

/** 检查最新 GitHub Release 并生成更新检查结果 */
export async function checkLatestRelease(
  currentVersion: string,
  network: ContentNetworkService,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<UpdateCheckResult> {
  const release = await fetchLatestRelease(network)
  const latestVersion = release.tag.replace(/^v/, '')
  const downloadAsset = await resolveDownloadAsset(release.tag, latestVersion, platform, arch, network, release.assets)
  const updateAvailable = isNewerVersion(latestVersion, currentVersion)

  return {
    arch,
    canAutoUpdate: false,
    currentVersion,
    latestVersion,
    manualDownloadName: downloadAsset?.name,
    manualDownloadUrl: downloadAsset?.url,
    platform,
    releaseName: release.name,
    releaseNotes: release.notes,
    releaseUrl: release.url,
    status: updateAvailable ? 'available' : 'not-available',
    updateAvailable,
  }
}

async function fetchUpdate(network: ContentNetworkService, url: string, init: RequestInit): Promise<Response> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  const target = getSafeHost(url)
  const route = network.getRouteDescription('update')
  console.info(
    `[更新请求] 请求 | requestId=${requestId} | 网络=${route} | ${formatHttpRequestForLog(init.method, url, init.headers, init.body)}`,
  )
  try {
    const response = await network.withUpdateContext((context) => network.fetch(url, init, context))
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] || '未提供'
    const message = `requestId=${requestId} | 网络=${route} | 目标=${target} | 状态码=${response.status} | Content-Type=${contentType} | 耗时=${Date.now() - startedAt}ms`
    if (response.ok || (response.status >= 300 && response.status < 400)) console.info(`[更新请求] 响应 | ${message}`)
    else console.warn(`[更新请求] 响应失败 | ${message}`)
    return response
  } catch (error) {
    console.warn(
      `[更新请求] 请求失败 | requestId=${requestId} | 网络=${route} | 目标=${target} | 状态码=— | Content-Type=— | 原因=${getErrorMessage(
        error,
      )
        .replace(/https?:\/\/[^\s)]+/gi, '[已脱敏地址]')
        .slice(0, 160)} | 耗时=${Date.now() - startedAt}ms`,
    )
    throw error
  }
}

function getSafeHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return '无效地址'
  }
}
