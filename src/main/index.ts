import { app, BrowserWindow, Menu, nativeImage, dialog } from 'electron'
import type { MenuItemConstructorOptions, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers, setMainWindow } from './ipc/register-handlers'
import { isAllowedExternalUrl, openExternalUrl } from './services/external-link'
import { checkLatestRelease } from './services/update-checker'
import { APP_DISPLAY_NAME, APP_ID, USER_DATA_DIR_NAME } from '@shared/constants'
import { createDatabase } from './db/client'
import { SettingsRepository } from './repositories/settings.repository'

let aboutWindow: BrowserWindow | null = null
let updateCheckPromise: Promise<void> | null = null
let hasRunStartupUpdateCheck = false

configureAppIdentityAndPaths()

app.on('will-finish-launching', () => {
  configureAppIdentityAndPaths()
})

function configureAppIdentityAndPaths(): void {
  app.setName(APP_DISPLAY_NAME)
  process.title = APP_DISPLAY_NAME
  app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR_NAME))
}

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
      <p class="version">v${app.getVersion()}</p>
      <p class="description">免费开源、开箱即用、跨平台的桌面端影视聚合播放器。</p>
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

function formatReleaseNotes(notes: string): string {
  const maxLength = 1_200
  return notes.length > maxLength ? `${notes.slice(0, maxLength).trim()}\n\n……` : notes
}

function showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const parent = BrowserWindow.getFocusedWindow()
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

async function runUpdateCheck(interactive: boolean): Promise<void> {
  try {
    const settings = new SettingsRepository(createDatabase()).get()
    const currentVersion = app.getVersion()
    const result = await checkLatestRelease(currentVersion, settings)

    if (!result.updateAvailable) {
      if (interactive) {
        await showMessageBox({
          type: 'info',
          title: '检查更新',
          message: '当前已是最新版本',
          detail: `当前版本：v${currentVersion}`,
          buttons: ['好'],
        })
      }
      return
    }

    const response = await showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `${result.releaseName} 已发布`,
      detail: `当前版本：v${result.currentVersion}\n最新版本：v${result.latestVersion}\n\n${formatReleaseNotes(result.releaseNotes)}`,
      buttons: ['前往下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })

    if (response.response === 0) {
      await openExternalUrl(result.manualDownloadUrl ?? result.downloadUrl ?? result.releaseUrl, settings)
    }
  } catch (error) {
    if (!interactive) return

    const message = error instanceof Error ? error.message : '未知错误'
    await showMessageBox({
      type: 'warning',
      title: '检查更新失败',
      message: '暂时无法检查更新',
      detail: `${message}\n\n请检查网络连接后重试。`,
      buttons: ['好'],
    })
  }
}

function checkForUpdates(interactive: boolean): void {
  if (updateCheckPromise) return

  updateCheckPromise = runUpdateCheck(interactive).finally(() => {
    updateCheckPromise = null
  })
}

function scheduleStartupUpdateCheck(): void {
  if (hasRunStartupUpdateCheck) return
  hasRunStartupUpdateCheck = true
  setTimeout(() => checkForUpdates(false), 3_000)
}

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
    { role: 'toggleDevTools', label: '开发者工具' },
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
    { label: `${APP_DISPLAY_NAME} v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: '检查更新…', click: () => checkForUpdates(true) },
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void openExternalUrl(url).catch((error: unknown) => {
        console.error('Failed to open external URL:', url, error)
      })
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isSameAppOrigin(mainWindow, url)) {
      return
    }

    if (isAllowedExternalUrl(url)) {
      event.preventDefault()
      void openExternalUrl(url).catch((error: unknown) => {
        console.error('Failed to open external URL:', url, error)
      })
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isSameAppOrigin(window: BrowserWindow, url: string): boolean {
  try {
    const currentUrl = window.webContents.getURL()
    if (!currentUrl) {
      return false
    }

    return new URL(url).origin === new URL(currentUrl).origin
  } catch {
    return false
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  configureAppIdentityAndPaths()
  app.dock?.setIcon(icon)
  electronApp.setAppUserModelId(APP_ID)
  createApplicationMenu()
  registerIpcHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  scheduleStartupUpdateCheck()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
