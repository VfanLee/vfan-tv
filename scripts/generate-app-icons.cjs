#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const logoToPngScript = path.join(__dirname, 'logo-to-png.cjs')

// macOS HIG: artwork fits ~824×824 in 1024×1024 (~80.5% safe area, ~50px inset at 512)
const MACOS_ICON_PADDING_512 = 50

const baseOptions = parseArgs(process.argv.slice(2))

function parseArgs(argv) {
  const options = {
    primary: '#0a84ff',
    secondary: '#5ac8fa',
    background: '#ffffff',
    padding: MACOS_ICON_PADDING_512,
    radius: 112,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const next = argv[index + 1]

    if (value === '--primary') {
      options.primary = next
      index += 1
      continue
    }

    if (value === '--secondary') {
      options.secondary = next
      index += 1
      continue
    }

    if (value === '--background') {
      options.background = next
      index += 1
      continue
    }

    if (value === '--padding') {
      options.padding = next
      index += 1
      continue
    }

    if (value === '--radius') {
      options.radius = next
      index += 1
      continue
    }

    if (value === '--transparent') {
      continue
    }

    if (value === '--help' || value === '-h') {
      console.log(`Usage:
  pnpm icons:generate -- --primary #0a84ff --secondary #5ac8fa --padding 50 --radius 112
`)
      process.exit(0)
    }

    throw new Error(`Unknown option: ${value}`)
  }

  return options
}

function renderPng(output, size) {
  const args = [
    logoToPngScript,
    '--output',
    output,
    '--size',
    String(size),
    '--primary',
    baseOptions.primary,
    '--secondary',
    baseOptions.secondary,
    '--padding',
    String(Math.round((Number(baseOptions.padding) / 512) * size)),
    '--radius',
    String(baseOptions.radius),
  ]

  if (baseOptions.background !== '#ffffff') {
    args.push('--background', baseOptions.background)
  }

  execFileSync(process.execPath, args, { stdio: 'inherit' })
}

function createIcoFromPng(pngPath, icoPath) {
  const png = fs.readFileSync(pngPath)
  const header = Buffer.alloc(6)
  const directory = Buffer.alloc(16)

  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  directory.writeUInt8(0, 0)
  directory.writeUInt8(0, 1)
  directory.writeUInt8(0, 2)
  directory.writeUInt8(0, 3)
  directory.writeUInt16LE(1, 4)
  directory.writeUInt16LE(32, 6)
  directory.writeUInt32LE(png.length, 8)
  directory.writeUInt32LE(header.length + directory.length, 12)

  fs.writeFileSync(icoPath, Buffer.concat([header, directory, png]))
}

function generateIcns(iconsetDir, icnsPath) {
  if (process.platform !== 'darwin') {
    console.warn('Skipped build/icon.icns: iconutil is only available on macOS.')
    return
  }

  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' })
}

function main() {
  const buildDir = path.join(rootDir, 'build')
  const resourcesDir = path.join(rootDir, 'resources')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfan-icons-'))
  const iconsetDir = path.join(tempDir, 'icon.iconset')
  const icoPngPath = path.join(tempDir, 'icon-256.png')

  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.mkdirSync(iconsetDir, { recursive: true })

  renderPng(path.join(resourcesDir, 'icon.png'), 512)
  renderPng(path.join(buildDir, 'icon.png'), 512)
  renderPng(icoPngPath, 256)

  const icnsSizes = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]

  for (const [fileName, size] of icnsSizes) {
    renderPng(path.join(iconsetDir, fileName), size)
  }

  generateIcns(iconsetDir, path.join(buildDir, 'icon.icns'))
  createIcoFromPng(icoPngPath, path.join(buildDir, 'icon.ico'))
  console.log('Generated application icons.')
}

main()
