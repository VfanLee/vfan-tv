import bs58 from 'bs58'

export function decodeBase58String(input: string): string {
  const value = input.trim()

  if (!value) {
    throw new Error('订阅响应为空')
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bs58.decode(value))
  } catch {
    throw new Error('订阅响应不是有效的 Base58 数据')
  }
}
