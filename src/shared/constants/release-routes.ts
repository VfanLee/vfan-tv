import { GITHUB_PROXY_ROUTES } from './github-proxy'

export interface ReleaseRoute {
  label: string
  prefix: string
}

export const RELEASE_ROUTE_PREFIXES: readonly ReleaseRoute[] = GITHUB_PROXY_ROUTES.map(({ label, prefix }) => ({
  label,
  prefix,
}))

export function applyReleaseRoutePrefix(url: string, prefix: string): string {
  return prefix ? `${prefix}${url}` : url
}
