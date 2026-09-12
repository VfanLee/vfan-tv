#!/usr/bin/env bash
# 同步升级 package.json、Cargo.toml、tauri.conf.json 与 Cargo.lock 中的应用版本。
# 只改文件，不 commit / tag / push。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 打印用法
print_usage() {
  cat <<'EOF'
Usage:
  ./scripts/bump-version.sh <major|minor|patch>
  ./scripts/bump-version.sh set <X.Y.Z>

Examples:
  ./scripts/bump-version.sh patch
  ./scripts/bump-version.sh set 1.2.3
EOF
}

if [[ $# -lt 1 ]]; then
  print_usage >&2
  exit 1
fi

MODE="$1"
TARGET="${2:-}"

case "$MODE" in
  major | minor | patch)
    if [[ $# -ne 1 ]]; then
      echo "error: ${MODE} 不接受额外参数" >&2
      print_usage >&2
      exit 1
    fi
    ;;
  set)
    if [[ $# -ne 2 ]]; then
      echo "error: set 需要一个 X.Y.Z 版本号" >&2
      print_usage >&2
      exit 1
    fi
    ;;
  -h | --help | help)
    print_usage
    exit 0
    ;;
  *)
    echo "error: 未知命令：${MODE}" >&2
    print_usage >&2
    exit 1
    ;;
esac

CURRENT="$(node -p "require('./package.json').version")"
node config/check-versions.ts

NEW_VERSION="$(
  MODE="$MODE" TARGET="$TARGET" CURRENT="$CURRENT" node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'

const mode = process.env.MODE ?? ''
const target = process.env.TARGET ?? ''
const current = process.env.CURRENT ?? ''

/** 解析并校验 X.Y.Z 版本号 */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) {
    throw new Error(`版本格式必须是 X.Y.Z：${value}`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 比较两个 X.Y.Z 版本号 */
function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index]
    }
  }
  return 0
}

/** 按 SemVer 规则计算下一个版本 */
function bumpVersion(version, bump) {
  const [major, minor, patch] = parseVersion(version)
  if (bump === 'major') {
    return `${major + 1}.0.0`
  }
  if (bump === 'minor') {
    return `${major}.${minor + 1}.0`
  }
  return `${major}.${minor}.${patch + 1}`
}

/** 只替换匹配到的文本，未命中则失败 */
function replaceOnce(source, pattern, next, label) {
  const updated = source.replace(pattern, next)
  if (updated === source) {
    throw new Error(`未找到可更新的 ${label}`)
  }
  return updated
}

try {
  parseVersion(current)
  const nextVersion = mode === 'set' ? target : bumpVersion(current, mode)
  parseVersion(nextVersion)
  if (compareVersions(nextVersion, current) <= 0) {
    throw new Error(`新版本必须大于当前版本：${current} -> ${nextVersion}`)
  }

  writeFileSync(
    'package.json',
    replaceOnce(
      readFileSync('package.json', 'utf8'),
      /^(\s*"version":\s*")[^"]+(")/m,
      `$1${nextVersion}$2`,
      'package.json version',
    ),
  )
  writeFileSync(
    'src-tauri/tauri.conf.json',
    replaceOnce(
      readFileSync('src-tauri/tauri.conf.json', 'utf8'),
      /^(\s*"version":\s*")[^"]+(")/m,
      `$1${nextVersion}$2`,
      'tauri.conf.json version',
    ),
  )
  writeFileSync(
    'src-tauri/Cargo.toml',
    replaceOnce(
      readFileSync('src-tauri/Cargo.toml', 'utf8'),
      /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
      `$1${nextVersion}$2`,
      'Cargo.toml [package].version',
    ),
  )
  writeFileSync(
    'src-tauri/Cargo.lock',
    replaceOnce(
      readFileSync('src-tauri/Cargo.lock', 'utf8'),
      /(\[\[package\]\]\nname = "vfan-tv"\nversion = ")[^"]+(")/,
      `$1${nextVersion}$2`,
      'Cargo.lock vfan-tv version',
    ),
  )

  process.stdout.write(nextVersion)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`error: ${message}`)
  process.exit(1)
}
EOF
)"

node config/check-versions.ts
echo "${CURRENT} -> ${NEW_VERSION}"
