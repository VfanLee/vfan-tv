const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_INDEX = new Map([...BASE58].map((character, index) => [character, index]))

export function decodeBase58String(input: string): string {
  const value = input.trim()

  if (!value) {
    throw new Error('订阅响应为空')
  }

  const bytes: number[] = [0]

  for (const character of value) {
    const digit = BASE58_INDEX.get(character)

    if (digit === undefined) {
      throw new Error('订阅响应不是有效的 Base58 数据')
    }

    let carry = digit
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58
      bytes[index] = carry & 0xff
      carry >>= 8
    }

    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (let index = 0; index < value.length - 1 && value[index] === '1'; index += 1) {
    bytes.push(0)
  }

  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes.reverse()))
}
