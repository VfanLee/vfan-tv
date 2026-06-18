export interface MediaProxyRequest {
  url: string
  referer?: string
  headers?: Record<string, string>
}
