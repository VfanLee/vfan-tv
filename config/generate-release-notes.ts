import { execFileSync } from 'node:child_process'

/** 按用户可见的变更类型组织发布说明 */
const categories = new Map([
  ['breaking', '不兼容变更'],
  ['feat', '新增功能'],
  ['fix', '问题修复'],
  ['perf', '性能优化'],
  ['revert', '回退变更'],
])

/** 执行只读 Git 命令并返回 UTF-8 输出 */
function readGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trimEnd()
}

/** 解析 vX.Y.Z 格式的发布标签 */
function parseTag(tag: string): bigint[] | undefined {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag)
  return match?.slice(1).map((part) => BigInt(part))
}

/** 判断候选标签的版本是否低于当前发布版本 */
function isEarlierTag(candidate: string, current: bigint[]): boolean {
  const version = parseTag(candidate)
  if (!version) return false
  for (let index = 0; index < current.length; index += 1) {
    if (version[index] !== current[index]) return version[index] < current[index]
  }
  return false
}

/** 从当前标签可达的历史中选取最高的较低版本标签 */
function findPreviousTag(tag: string, version: bigint[]): string | undefined {
  return readGit(['tag', '--merged', tag, '--sort=-version:refname'])
    .split('\n')
    .find((candidate) => isEarlierTag(candidate, version))
}

/** 从发布标签间的提交生成分类说明与完整更新记录链接 */
function generateReleaseNotes(tag: string, repository: string): string {
  const version = parseTag(tag)
  if (!version) throw new Error('发布标签必须使用 vX.Y.Z 格式')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('仓库必须使用 OWNER/REPO 格式')

  const previousTag = findPreviousTag(tag, version)
  const range = previousTag ? `${previousTag}..${tag}` : tag
  const commits = readGit(['log', '--no-merges', '--reverse', '--format=%s%x00%b%x00', range]).split('\0')
  const entries = new Map([...categories.keys()].map((category) => [category, new Set<string>()]))

  for (let index = 0; index + 1 < commits.length; index += 2) {
    const subject = commits[index].trim()
    const body = commits[index + 1]
    const match = /^([a-z]+)(?:\([^)]+\))?(!)?:\s+(.+)$/i.exec(subject)
    if (!match) continue

    const breakingDescription = body.match(/^BREAKING[ -]CHANGE:\s*(.+)$/m)?.[1]
    const category = match[2] || breakingDescription ? 'breaking' : match[1].toLowerCase()
    const description = breakingDescription ? `${match[3]}：${breakingDescription}` : match[3]
    entries.get(category)?.add(description)
  }

  const sections: string[] = []
  for (const [category, title] of categories) {
    const items = entries.get(category)!
    if (items.size > 0) sections.push(`## ${title}\n\n${[...items].map((item) => `- ${item}`).join('\n')}`)
  }
  if (sections.length === 0) sections.push('本次更新包含维护调整，详情见完整更新记录。')

  const baseUrl = `https://github.com/${repository}`
  const changelogUrl = previousTag
    ? `${baseUrl}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(tag)}`
    : `${baseUrl}/commits/${encodeURIComponent(tag)}`
  sections.push(`**完整更新记录**：[${previousTag ? `${previousTag}...${tag}` : tag}](${changelogUrl})`)
  return `${sections.join('\n\n')}\n`
}

try {
  const [tag, repository, ...extra] = process.argv.slice(2)
  if (!tag || !repository || extra.length > 0) {
    throw new Error('用法：node config/generate-release-notes.ts <vX.Y.Z> <OWNER/REPO>')
  }
  process.stdout.write(generateReleaseNotes(tag, repository))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
