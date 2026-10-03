/** 按后端约定生成剧集标记键，不依赖地址或列表索引 */
export function getEpisodeUpdateKey(name: string): string {
  const normalized = name.replace(/\s+/g, '').toLowerCase()
  const number = /^(?:第|ep(?:isode)?)?0*(\d+)(?:集|期|话)?$/i.exec(normalized)?.[1]
  return number === undefined ? `name:${normalized}` : `episode:${Number(number)}`
}
