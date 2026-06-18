#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const defaultInput = path.join(rootDir, 'src/renderer/src/assets/logo-mark.svg')
const defaultOutput = path.join(rootDir, 'resources/logo-preview.png')

function parseArgs(argv) {
  const options = {
    input: defaultInput,
    output: defaultOutput,
    size: 512,
    primary: '#0a84ff',
    secondary: '#5ac8fa',
    background: '#ffffff',
    padding: 0,
    radius: 116,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const next = argv[index + 1]

    if (value === '--input' || value === '-i') {
      options.input = path.resolve(next)
      index += 1
      continue
    }

    if (value === '--output' || value === '--out' || value === '-o') {
      options.output = path.resolve(next)
      index += 1
      continue
    }

    if (value === '--size' || value === '-s') {
      options.size = Number.parseInt(next, 10)
      index += 1
      continue
    }

    if (value === '--primary') {
      options.primary = normalizeColor(next)
      index += 1
      continue
    }

    if (value === '--secondary') {
      options.secondary = normalizeColor(next)
      index += 1
      continue
    }

    if (value === '--background') {
      options.background = normalizeColor(next)
      index += 1
      continue
    }

    if (value === '--padding') {
      options.padding = Number.parseInt(next, 10)
      index += 1
      continue
    }

    if (value === '--radius') {
      options.radius = Number.parseInt(next, 10)
      index += 1
      continue
    }

    if (value === '--transparent') {
      continue
    }

    if (value === '--help' || value === '-h') {
      printHelp()
      process.exit(0)
    }

    throw new Error(`Unknown option: ${value}`)
  }

  if (!Number.isInteger(options.size) || options.size < 16) {
    throw new Error('--size must be an integer greater than or equal to 16')
  }

  if (!Number.isInteger(options.padding) || options.padding < 0 || options.padding >= options.size / 2) {
    throw new Error('--padding must be an integer greater than or equal to 0 and smaller than half of --size')
  }

  if (!Number.isInteger(options.radius) || options.radius < 0) {
    throw new Error('--radius must be an integer greater than or equal to 0')
  }

  return options
}

function normalizeColor(value) {
  if (!value) {
    throw new Error('Color option requires a value')
  }

  if (value === 'transparent') {
    return value
  }

  const color = value.startsWith('#') ? value : `#${value}`

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`Invalid color: ${value}. Use hex color like #0284c7.`)
  }

  return color.toLowerCase()
}

function printHelp() {
  console.log(`Usage:
  pnpm logo:png -- --output resources/logo-preview.png --size 512 --primary #0a84ff

Options:
  -i, --input <path>       Source SVG. Defaults to src/renderer/src/assets/logo-mark.svg
  -o, --output <path>      Output PNG. Defaults to resources/logo-preview.png
  -s, --size <number>      Output width and height. Defaults to 512
      --primary <hex>      Main theme color. Defaults to #0a84ff
      --secondary <hex>    Secondary theme color. Defaults to #5ac8fa
      --background <hex>   Rounded tile color. Defaults to #ffffff
      --transparent        Deprecated, kept for compatibility (no effect)
      --padding <number>   Transparent outer padding. Defaults to 0
      --radius <number>    Inner icon corner radius before scaling. Defaults to 116
`)
}

function themedSvg(svg, options) {
  const tileFill = options.background
  const iconSize = options.size - options.padding * 2
  const scale = iconSize / 512
  const radius = options.radius

  let themed = svg
    .replace(/#0284c7/gi, options.primary)
    .replace(/#0a84ff/gi, options.primary)
    .replace(/#38bdf8/gi, options.secondary)
    .replace(/#5ac8fa/gi, options.secondary)
    .replace(/#eff8ff/gi, tileFill)
    .replace(
      /<rect width="512" height="512" rx="[^"]+" fill="url\(#bg\)" \/>/,
      `<rect width="512" height="512" rx="${radius}" fill="url(#bg)" />`,
    )
    .replace(
      /<rect width="512" height="512" rx="[^"]+" fill="([^"]+)" \/>/,
      `<rect width="512" height="512" rx="${radius}" fill="${tileFill}" />`,
    )

  if (options.padding === 0) {
    return themed
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" width="${options.size}" height="${options.size}" viewBox="0 0 ${options.size} ${options.size}">
  <g transform="translate(${options.padding} ${options.padding}) scale(${scale})">
    ${themed.replace(/<\?xml[^>]*>/, '').replace(/<svg[^>]*>|<\/svg>/g, '')}
  </g>
</svg>`
}

function renderWithSharp(svg, options) {
  try {
    const sharp = require('sharp')
    return sharp(Buffer.from(svg), { density: 288 })
      .resize(options.size, options.size)
      .png({ compressionLevel: 9 })
      .toBuffer()
  } catch {
    return null
  }
}

function renderWithQuickLook(svg, options) {
  if (process.platform !== 'darwin') {
    return null
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfan-logo-'))
  const svgPath = path.join(tempDir, 'logo.svg')

  fs.writeFileSync(svgPath, svg)
  execFileSync('qlmanage', ['-t', '-s', String(options.size), '-o', tempDir, svgPath], {
    stdio: 'ignore',
  })

  const quickLookOutput = path.join(tempDir, 'logo.svg.png')
  if (!fs.existsSync(quickLookOutput)) {
    return null
  }

  return fs.readFileSync(quickLookOutput)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const svg = themedSvg(fs.readFileSync(options.input, 'utf8'), options)
  const png = (await renderWithSharp(svg, options)) ?? renderWithQuickLook(svg, options)

  if (!png) {
    throw new Error('Unable to render SVG. Install sharp or run this script on macOS with Quick Look available.')
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true })
  fs.writeFileSync(options.output, png)
  console.log(`Generated ${path.relative(rootDir, options.output)} (${options.size}x${options.size})`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
