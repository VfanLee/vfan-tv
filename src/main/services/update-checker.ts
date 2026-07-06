import { DOMParser } from '@xmldom/xmldom'
import { resolveGitHubUrl } from '@shared/constants'
import type { AppSettings, UpdateCheckResult } from '@shared/types'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const RELEASES_FEED_PATH = `${REPOSITORY_URL}/releases.atom`
const LATEST_RELEASE_PATH = `${REPOSITORY_URL}/releases/latest`
const REQUEST_HEADERS = { 'User-Agent': 'vfan-tv-update-checker' }
const REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_GITHUB_PROXY_SETTINGS: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'> = {
  githubProxyCustomPrefix: '',
  githubProxyRoute: 'direct',
}

interface LatestRelease {
  name: string
  notes: string
  tag: string
  url: string
}

interface DownloadAsset {
  name: string
  url: string
}

function parseVersion(version: string): [number, number, number] {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) {
    throw new Error(`无法识别版本号：${version}`)
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

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

async function fetchLatestReleaseFromFeed(
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): Promise<LatestRelease> {
  const response = await fetch(resolveGitHubUrl(RELEASES_FEED_PATH, settings), {
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

async function fetchLatestReleaseFromRedirect(
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): Promise<LatestRelease> {
  const response = await fetch(resolveGitHubUrl(LATEST_RELEASE_PATH, settings), {
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

async function fetchLatestReleaseViaRoute(
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): Promise<LatestRelease> {
  try {
    return await fetchLatestReleaseFromFeed(settings)
  } catch {
    return fetchLatestReleaseFromRedirect(settings)
  }
}

async function fetchLatestRelease(
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): Promise<LatestRelease> {
  return fetchLatestReleaseViaRoute(settings)
}

function getAssetNames(version: string, platform: NodeJS.Platform, arch: string): string[] {
  if (platform === 'win32') {
    return [`vfan-tv-v${version}-${arch}-setup.exe`]
  }

  if (platform === 'darwin') {
    return [`vfan-tv-v${version}-${arch}.dmg`]
  }

  return []
}

async function assetExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    return response.ok || response.status === 302
  } catch {
    return false
  }
}

async function resolveDownloadAsset(
  tag: string,
  version: string,
  platform: NodeJS.Platform,
  arch: string,
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'>,
): Promise<DownloadAsset | undefined> {
  const assetNames = getAssetNames(version, platform, arch)

  for (const name of assetNames) {
    const canonicalUrl = `${REPOSITORY_URL}/releases/download/${tag}/${name}`
    const exists = await assetExists(resolveGitHubUrl(canonicalUrl, settings))
    if (exists) {
      return { name, url: canonicalUrl }
    }
  }

  return undefined
}

export async function checkLatestRelease(
  currentVersion: string,
  settings: Pick<AppSettings, 'githubProxyCustomPrefix' | 'githubProxyRoute'> = DEFAULT_GITHUB_PROXY_SETTINGS,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<UpdateCheckResult> {
  const release = await fetchLatestRelease(settings)
  const latestVersion = release.tag.replace(/^v/, '')
  const downloadAsset = await resolveDownloadAsset(release.tag, latestVersion, platform, arch, settings)

  return {
    currentVersion,
    downloadName: downloadAsset?.name,
    downloadUrl: downloadAsset?.url,
    latestVersion,
    releaseName: release.name,
    releaseNotes: release.notes,
    releaseUrl: release.url,
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
  }
}
