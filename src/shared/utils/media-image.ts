const IMAGE_HOST_ALIASES: Readonly<Record<string, string>> = {
  'img.ffzy888.com': 'pps.vodfeiss.com',
  'img.image8899.net': 'pps.vodfeiss.com',
}

export function resolveImageTarget(url: string, baseUrl?: string): string | undefined {
  if (!url) return undefined
  const targetUrl = resolveTargetUrl(url, baseUrl)
  if (!targetUrl || !['http:', 'https:'].includes(targetUrl.protocol)) return undefined
  const replacementHost = IMAGE_HOST_ALIASES[targetUrl.hostname.toLowerCase()]
  if (replacementHost) targetUrl.hostname = replacementHost
  return targetUrl.toString()
}

function resolveTargetUrl(url: string, baseUrl: string | undefined): URL | undefined {
  try {
    const normalizedUrl = url.startsWith('//') ? `https:${url}` : url
    return baseUrl ? new URL(normalizedUrl, baseUrl) : new URL(normalizedUrl)
  } catch {
    return undefined
  }
}
