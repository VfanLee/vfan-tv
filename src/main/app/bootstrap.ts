import { app, BrowserWindow, Menu, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join, resolve } from 'path'
import { electronApp } from '@electron-toolkit/utils'
import iconAsset from '../../../resources/icon.png'
import { registerIpcHandlers } from '../ipc/register-handlers'
import { createApplicationContext, type ApplicationContext } from './composition-root'
import { createMainWindow } from '../windows/main-window'
import { showActiveMiniWindow } from '../windows/mini-window-mode'
import { closeSettingsWindow, configureSettingsWindowManager } from '../windows/settings-window'
import { APP_DISPLAY_NAME, APP_ID, USER_DATA_DIR_NAME } from '@shared/constants'
import packageJson from '../../../package.json'
import { configureAppLogger, getAppLogInfo } from '../infrastructure/logging/app-logger'

const icon = resolve(__dirname, iconAsset)

let aboutWindow: BrowserWindow | null = null
let applicationContext: ApplicationContext | null = null

configureAppIdentityAndPaths()
configureAppLogger(app.getPath('userData'))
registerProcessErrorLogging()
console.info(
  `[应用] 启动 | version=${getCurrentVersion()} | packaged=${app.isPackaged} | platform=${process.platform} | arch=${process.arch} | logs=${getAppLogInfo().filePath}`,
)

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showOrCreateApplicationWindow()
  })
}

app.on('will-finish-launching', () => {
  configureAppIdentityAndPaths()
})

function getCurrentVersion(): string {
  return packageJson.version || app.getVersion()
}

function getApplicationContext(): ApplicationContext {
  if (!applicationContext) throw new Error('Application context is not initialized')
  return applicationContext
}

/** 记录未被业务代码处理的主进程异常 */
function registerProcessErrorLogging(): void {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    console.error(`[主进程异常] 未捕获异常 | origin=${origin}`, error)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[主进程异常] 未处理 Promise 拒绝', reason)
  })
}

/** 配置应用名称、进程标题和 userData 路径 */
function configureAppIdentityAndPaths(): void {
  app.setName(APP_DISPLAY_NAME)
  process.title = APP_DISPLAY_NAME
  app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR_NAME))
}

/** 创建单例“关于”窗口；重复调用时聚焦已有窗口 */
function showAboutWindow(): void {
  if (aboutWindow) {
    aboutWindow.focus()
    return
  }

  const parent = BrowserWindow.getFocusedWindow() ?? undefined
  const iconDataUrl = nativeImage.createFromPath(icon).toDataURL()
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #242424;
        background: #f6f6f6;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-user-select: none;
      }
      main { width: 100%; padding: 42px 28px 28px; text-align: center; }
      img { width: 76px; height: 76px; border-radius: 18px; }
      h1 { margin: 16px 0 5px; font-size: 24px; line-height: 1.2; }
      .version { margin: 0; color: #666; font-size: 13px; }
      .description { margin: 18px auto 0; color: #444; font-size: 14px; line-height: 1.6; }
      .copyright { margin: 24px 0 0; color: #888; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <img src="${iconDataUrl}" alt="${APP_DISPLAY_NAME}" />
      <h1>${APP_DISPLAY_NAME}</h1>
      <p class="version">v${getCurrentVersion()}</p>
      <p class="description">Vfan TV 是一款免费开源、跨平台的桌面端影视聚合客户端（空壳）。</p>
      <p class="copyright">Copyright © 2026 VfanLee</p>
    </main>
  </body>
</html>`

  aboutWindow = new BrowserWindow({
    parent,
    title: `关于 ${APP_DISPLAY_NAME}`,
    width: 380,
    height: 340,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: '#f6f6f6',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  aboutWindow.once('ready-to-show', () => aboutWindow?.show())
  aboutWindow.once('closed', () => {
    aboutWindow = null
  })
  void aboutWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
}

/** 根据当前平台构建原生应用菜单 */
function createApplicationMenu(): void {
  const isMac = process.platform === 'darwin'
  const appMenu: MenuItemConstructorOptions[] = [
    { label: `关于${APP_DISPLAY_NAME}`, click: showAboutWindow },
    { type: 'separator' },
    { role: 'services', label: '服务' },
    { type: 'separator' },
    { role: 'hide', label: `隐藏${APP_DISPLAY_NAME}` },
    { role: 'hideOthers', label: '隐藏其他' },
    { role: 'unhide', label: '全部显示' },
    { type: 'separator' },
    { role: 'quit', label: `退出${APP_DISPLAY_NAME}` },
  ]
  const fileMenu: MenuItemConstructorOptions[] = [
    isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
  ]
  const editMenu: MenuItemConstructorOptions[] = [
    { role: 'undo', label: '撤销' },
    { role: 'redo', label: '重做' },
    { type: 'separator' },
    { role: 'cut', label: '剪切' },
    { role: 'copy', label: '复制' },
    { role: 'paste', label: '粘贴' },
    { role: 'selectAll', label: '全选' },
  ]
  const viewMenu: MenuItemConstructorOptions[] = [
    { role: 'reload', label: '重新加载' },
    { role: 'forceReload', label: '强制重新加载' },
    { type: 'separator' },
    { role: 'resetZoom', label: '实际大小' },
    { role: 'zoomIn', label: '放大' },
    { role: 'zoomOut', label: '缩小' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: '进入全屏' },
  ]
  const windowMenu: MenuItemConstructorOptions[] = [
    { role: 'minimize', label: '最小化' },
    { role: 'zoom', label: '缩放' },
    ...(isMac
      ? ([{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] satisfies MenuItemConstructorOptions[])
      : ([{ role: 'close', label: '关闭窗口' }] satisfies MenuItemConstructorOptions[])),
  ]
  const helpMenu: MenuItemConstructorOptions[] = [
    { label: '切换开发者工具', click: toggleFocusedWindowDevTools },
    { type: 'separator' },
    { label: `${APP_DISPLAY_NAME} v${getCurrentVersion()}`, enabled: false },
  ]
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ label: APP_DISPLAY_NAME, submenu: appMenu }] satisfies MenuItemConstructorOptions[]) : []),
    {
      label: '文件',
      submenu: fileMenu,
    },
    {
      label: '编辑',
      submenu: editMenu,
    },
    {
      label: '视图',
      submenu: viewMenu,
    },
    {
      label: '窗口',
      submenu: windowMenu,
    },
    {
      label: '帮助',
      submenu: helpMenu,
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return

  configureAppIdentityAndPaths()
  app.dock?.setIcon(icon)
  electronApp.setAppUserModelId(APP_ID)
  createApplicationMenu()
  applicationContext = await createApplicationContext()
  configureSettingsWindowManager({ icon, getMainWindow: applicationContext.getMainWindow })
  registerIpcHandlers(applicationContext)

  // 所有环境只通过帮助菜单打开开发者工具，并保护刷新与缩放快捷键。
  app.on('browser-window-created', (_, window) => {
    configureWindowShortcutGuards(window)
  })

  createWindow()

  app.on('activate', function () {
    showOrCreateApplicationWindow()
  })
})

/** 切换当前聚焦应用窗口的开发者工具 */
function toggleFocusedWindowDevTools(): void {
  const window = BrowserWindow.getFocusedWindow() ?? applicationContext?.getMainWindow()
  if (!window || window.isDestroyed()) return
  if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools()
  else window.webContents.openDevTools({ mode: 'detach' })
}

/** 禁用开发者工具快捷键，并保留生产环境的误刷新和页面缩放保护 */
function configureWindowShortcutGuards(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isDevToolsShortcut =
      input.code === 'F12' || (input.code === 'KeyI' && ((input.alt && input.meta) || (input.control && input.shift)))
    const isReloadShortcut = app.isPackaged && input.code === 'KeyR' && (input.control || input.meta)
    const isZoomShortcut =
      (input.code === 'Minus' && (input.control || input.meta)) ||
      (input.code === 'Equal' && input.shift && (input.control || input.meta))
    if (isDevToolsShortcut || isReloadShortcut || isZoomShortcut) event.preventDefault()
  })
}

/** 显示应用窗口，窗口不存在时创建主窗口 */
function showOrCreateApplicationWindow(): void {
  if (!app.isReady() || !applicationContext) return

  const mainWindow = applicationContext.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (showActiveMiniWindow(mainWindow)) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 创建主窗口并登记到应用上下文 */
function createWindow(): void {
  const context = getApplicationContext()
  createMainWindow({
    icon,
    onCreated: (window) => {
      context.setMainWindow(window)
      window.once('closed', () => {
        closeSettingsWindow()
        if (context.getMainWindow() === window) context.setMainWindow(null)
      })
    },
  })
}

// 非 macOS 平台关闭全部窗口后退出应用。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
