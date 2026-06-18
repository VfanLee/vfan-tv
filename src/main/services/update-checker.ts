import type { UpdateCheckResult } from '@shared/types'

const LATEST_RELEASE_URL = 'https://api.github.com/repos/vfanlee/VfanTV/releases/latest'

interface GitHubRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
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

export async function checkLatestRelease(currentVersion: string): Promise<UpdateCheckResult> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'VfanTV-Update-Checker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('暂未找到公开发布版本')
    }
    throw new Error(`GitHub 请求失败（HTTP ${response.status}）`)
  }

  const release = (await response.json()) as GitHubRelease
  const latestVersion = release.tag_name.replace(/^v/, '')

  return {
    currentVersion,
    latestVersion,
    releaseName: release.name?.trim() || `VfanTV v${latestVersion}`,
    releaseNotes: release.body?.trim() || '此版本暂无更新说明。',
    releaseUrl: release.html_url,
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
  }
}
