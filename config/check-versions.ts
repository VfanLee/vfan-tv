import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 读取相对于项目根目录的 UTF-8 配置文件 */
function readProjectFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
}

/** 校验前端、Rust 包与桌面安装包使用同一版本号 */
function checkVersions(): void {
  const packageVersion = JSON.parse(readProjectFile('package.json')).version
  const desktopVersion = JSON.parse(readProjectFile('src-tauri/tauri.conf.json')).version
  const cargoPackage = readProjectFile('src-tauri/Cargo.toml').match(
    /^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m,
  )?.[1]
  const rustVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  if (!packageVersion || !rustVersion || packageVersion !== desktopVersion || packageVersion !== rustVersion) {
    throw new Error(
      `版本不一致：package.json=${packageVersion}, Cargo.toml=${rustVersion}, tauri.conf.json=${desktopVersion}`,
    )
  }
  console.info(`版本一致：${packageVersion}`)
}

checkVersions()
