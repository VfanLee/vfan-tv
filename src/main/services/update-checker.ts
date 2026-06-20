import { DOMParser } from '@xmldom/xmldom'
import type { UpdateCheckResult } from '@shared/types'

const REPOSITORY_URL = 'https://github.com/VfanLee/VfanTV'
const RELEASES_FEED_URL = `${REPOSITORY_URL}/releases.atom`
const LATEST_RELEASE_URL = `${REPOSITORY_URL}/releases/latest`
const REQUEST_HEADERS = { 'User-Agent': 'VfanTV-Update-Checker' }

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
    name: getTextContent(entry.getElementsByTagName('title')[0]) || `VfanTV ${tag}`,
    notes: getReleaseNotes(entry.getElementsByTagName('content')[0]),
    tag,
    url: releaseUrl,
  }
}

async function fetchLatestReleaseFromFeed(): Promise<LatestRelease> {
  const response = await fetch(RELEASES_FEED_URL, {
    headers: {
      ...REQUEST_HEADERS,
      Accept: 'application/atom+xml',
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`GitHub Release Feed 请求失败（HTTP ${response.status}）`)
  }

  return parseReleaseFeed(await response.text())
}

async function fetchLatestReleaseFromRedirect(): Promise<LatestRelease> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: REQUEST_HEADERS,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  const releaseUrl = response.headers.get('location') ?? ''
  const tag = releaseUrl.match(/\/tag\/([^/?#]+)/)?.[1]

  if (!tag) {
    throw new Error(`GitHub Release 重定向请求失败（HTTP ${response.status}）`)
  }

  return {
    name: `VfanTV ${tag}`,
    notes: '请前往 GitHub Release 页面查看更新说明。',
    tag,
    url: releaseUrl,
  }
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  try {
    return await fetchLatestReleaseFromFeed()
  } catch {
    return fetchLatestReleaseFromRedirect()
  }
}

function getAssetNames(version: string, platform: NodeJS.Platform, arch: string): string[] {
  if (platform === 'win32') {
    return [`VfanTV-v${version}-${arch}-portable.exe`, `VfanTV-v${version}-${arch}-setup.exe`]
  }

  if (platform === 'darwin') {
    return [`VfanTV-v${version}-${arch}.dmg`]
  }

  return []
}

async function resolveDownloadAsset(
  tag: string,
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<DownloadAsset | undefined> {
  const candidates = getAssetNames(version, platform, arch).map((name) => ({
    name,
    url: `${REPOSITORY_URL}/releases/download/${tag}/${name}`,
  }))

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const response = await fetch(candidate.url, {
          headers: REQUEST_HEADERS,
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        })
        return response.ok || response.status === 302 ? candidate : undefined
      } catch {
        return undefined
      }
    }),
  )

  return results.find((candidate) => candidate !== undefined)
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
