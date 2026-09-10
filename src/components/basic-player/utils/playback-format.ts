/** 格式化带宽估计值并处理尚未检测的状态 */
export function formatBandwidthEstimate(bitsPerSecond: number | undefined): string {
  if (!bitsPerSecond || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) {
    return '检测中'
  }

  if (bitsPerSecond >= 1_000_000) {
    return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`
  }

  return `${Math.round(bitsPerSecond / 1000)} Kbps`
}

/** 将比特率转换为可读单位 */
export function formatBitsPerSecond(bitsPerSecond: number): string {
  return bitsPerSecond >= 1_000_000
    ? `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`
    : `${Math.round(bitsPerSecond / 1_000)} Kbps`
}

/** 将媒体时间区间整理为调试文本 */
export function formatTimeRanges(ranges: TimeRanges): string {
  if (!ranges.length) {
    return '无'
  }

  return Array.from({ length: ranges.length }, (_, index) => {
    const start = ranges.start(index)
    const end = ranges.end(index)
    return `${formatDebugTime(start)}-${formatDebugTime(end)}`
  }).join(', ')
}

/** 格式化调试时间及无效值 */
export function formatDebugTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '-'
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remain = Math.floor(seconds % 60)
    const fraction = Math.round((seconds % 1) * 10)
    return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}.${fraction}`
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remain = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`
}
