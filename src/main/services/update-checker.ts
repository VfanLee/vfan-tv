import { DOMParser } from '@xmldom/xmldom'
import { applyReleaseRoutePrefix, RELEASE_ROUTE_PREFIXES } from '@shared/constants'
import type { UpdateCheckResult } from '@shared/types'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const RELEASES_FEED_PATH = `${REPOSITORY_URL}/releases.atom`
const LATEST_RELEASE_PATH = `${REPOSITORY_URL}/releases/latest`
const REQUEST_HEADERS = { 'User-Agent': 'vfan-tv-update-checker' }
const REQUEST_TIMEOUT_MS = 10_000

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

async function fetchLatestReleaseFromFeed(routePrefix: string): Promise<LatestRelease> {
  const response = await fetch(applyReleaseRoutePrefix(RELEASES_FEED_PATH, routePrefix), {
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

async function fetchLatestReleaseFromRedirect(routePrefix: string): Promise<LatestRelease> {
  const response = await fetch(applyReleaseRoutePrefix(LATEST_RELEASE_PATH, routePrefix), {
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

async function fetchLatestReleaseViaRoute(routePrefix: string): Promise<LatestRelease> {
  try {
    return await fetchLatestReleaseFromFeed(routePrefix)
  } catch {
    return fetchLatestReleaseFromRedirect(routePrefix)
  }
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const errors: string[] = []

  for (const route of RELEASE_ROUTE_PREFIXES) {
    try {
      return await fetchLatestReleaseViaRoute(route.prefix)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${route.label}：${message}`)
    }
  }

  throw new Error(errors.join('；') || '所有更新检查线路均不可用')
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
): Promise<DownloadAsset | undefined> {
  const assetNames = getAssetNames(version, platform, arch)

  for (const name of assetNames) {
    const canonicalUrl = `${REPOSITORY_URL}/releases/download/${tag}/${name}`

    for (const route of RELEASE_ROUTE_PREFIXES) {
      const exists = await assetExists(applyReleaseRoutePrefix(canonicalUrl, route.prefix))
      if (exists) {
        return { name, url: canonicalUrl }
      }
    }
  }

  return undefined
}

export async function checkLatestRelease(
  currentVersion: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<UpdateCheckResult> {
  const release = await fetchLatestRelease()
  const latestVersion = release.tag.replace(/^v/, '')
  const downloadAsset = await resolveDownloadAsset(release.tag, latestVersion, platform, arch)

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
