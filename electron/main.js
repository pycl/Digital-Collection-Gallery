import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  getGalleryState,
  readConfig,
  scanCollections,
  serializeCollections,
  updateAppConfig,
  updateCollectionPreferences,
  writeConfig,
} from './data-store.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rendererUrl = process.env.ELECTRON_RENDERER_URL
const distIndexPath = path.join(__dirname, '..', 'dist', 'index.html')
const galleryProtocol = 'gallery-file'
const activeWindowDrags = new Map()

function stopWindowDrag(windowId) {
  const activeDrag = activeWindowDrags.get(windowId)
  if (!activeDrag) {
    return
  }

  clearInterval(activeDrag.intervalId)
  activeWindowDrags.delete(windowId)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: galleryProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

function decodeGalleryFileUrl(requestUrl) {
  const url = new URL(requestUrl)

  if (url.hostname) {
    if (/^[A-Za-z]$/.test(url.hostname)) {
      return `${url.hostname}:${decodeURIComponent(url.pathname)}`
    }

    return `//${url.hostname}${decodeURIComponent(url.pathname)}`
  }

  let filePath = decodeURIComponent(url.pathname)

  if (/^\/[A-Za-z]:\//.test(filePath)) {
    filePath = filePath.slice(1)
  }

  return filePath
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 420,
    minHeight: 560,
    title: 'Digital Collection Gallery',
    backgroundColor: '#08111f',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Renderer failed to load (${code}): ${description} -> ${url}`)
  })

  void readConfig().then((config) => {
    mainWindow.webContents.setZoomFactor(config.uiScale ?? 1)
  })

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(distIndexPath)
  }
}

app.whenReady().then(() => {
  protocol.handle(galleryProtocol, (request) => {
    const filePath = decodeGalleryFileUrl(request.url)
    return net.fetch(pathToFileURL(filePath).toString())
  })

  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:open-external', async (_event, url) => shell.openExternal(url))
  ipcMain.handle('app:minimize-window', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('app:toggle-maximize-window', (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) {
      return
    }

    if (browserWindow.isMaximized()) {
      browserWindow.unmaximize()
      return
    }

    browserWindow.maximize()
  })
  ipcMain.handle('app:close-window', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('app:get-window-bounds', (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) {
      return null
    }

    const bounds = browserWindow.getBounds()
    return {
      ...bounds,
      isMaximized: browserWindow.isMaximized(),
    }
  })
  ipcMain.handle('app:start-window-drag', (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow || browserWindow.isDestroyed() || browserWindow.isMaximized()) {
      return false
    }

    const windowId = browserWindow.id
    stopWindowDrag(windowId)

    const startBounds = browserWindow.getBounds()
    const startCursorPoint = screen.getCursorScreenPoint()
    const intervalId = setInterval(() => {
      if (browserWindow.isDestroyed() || browserWindow.isMaximized()) {
        stopWindowDrag(windowId)
        return
      }

      const cursorPoint = screen.getCursorScreenPoint()
      const targetX = startBounds.x + (cursorPoint.x - startCursorPoint.x)
      const targetY = startBounds.y + (cursorPoint.y - startCursorPoint.y)
      const nextBounds = browserWindow.getBounds()
      const workArea = screen.getDisplayNearestPoint(cursorPoint).workArea
      const visibleMarginX = Math.min(140, Math.max(80, Math.round(nextBounds.width * 0.2)))
      const minVisibleHeight = 72
      const nextX = Math.round(
        Math.min(
          workArea.x + workArea.width - visibleMarginX,
          Math.max(workArea.x - nextBounds.width + visibleMarginX, targetX),
        ),
      )
      const nextY = Math.round(
        Math.min(
          workArea.y + workArea.height - minVisibleHeight,
          Math.max(workArea.y + 12, targetY),
        ),
      )

      browserWindow.setBounds(
        {
          x: nextX,
          y: nextY,
          width: nextBounds.width,
          height: nextBounds.height,
        },
        false,
      )
    }, 8)

    activeWindowDrags.set(windowId, { intervalId })
    return true
  })
  ipcMain.on('app:stop-window-drag', (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) {
      return
    }

    stopWindowDrag(browserWindow.id)
  })
  ipcMain.on('app:set-window-position', (event, x, y) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow || browserWindow.isDestroyed() || browserWindow.isMaximized()) {
      return
    }

    const bounds = browserWindow.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const visibleMarginX = Math.min(140, Math.max(80, Math.round(bounds.width * 0.2)))
    const minVisibleHeight = 72
    const nextX = Math.round(
      Math.min(
        workArea.x + workArea.width - visibleMarginX,
        Math.max(workArea.x - bounds.width + visibleMarginX, x),
      ),
    )
    const nextY = Math.round(
      Math.min(
        workArea.y + workArea.height - minVisibleHeight,
        Math.max(workArea.y + 12, y),
      ),
    )

    browserWindow.setBounds(
      {
        x: nextX,
        y: nextY,
        width: bounds.width,
        height: bounds.height,
      },
      false,
    )
  })
  ipcMain.handle('gallery:get-state', async () => getGalleryState())
  ipcMain.handle('gallery:scan', async () => {
    const config = await readConfig()
    const collectionMap = await scanCollections(config.importPaths)
    return {
      config,
      collections: serializeCollections(collectionMap, config.collectionsSort),
    }
  })
  ipcMain.handle('gallery:add-import-path', async () => {
    const browserWindow = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(browserWindow ?? undefined, {
      properties: ['openDirectory'],
      title: 'Import Collection Root Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return getGalleryState()
    }

    const config = await readConfig()
    const nextImportPaths = Array.from(new Set([...config.importPaths, result.filePaths[0]]))
    const nextConfig = {
      ...config,
      importPaths: nextImportPaths,
    }

    await writeConfig(nextConfig)
    const collectionMap = await scanCollections(nextImportPaths)

    return {
      config: nextConfig,
      collections: serializeCollections(collectionMap, nextConfig.collectionsSort),
    }
  })
  ipcMain.handle('gallery:remove-import-path', async (_event, importPath) => {
    const config = await readConfig()
    const nextConfig = {
      ...config,
      importPaths: config.importPaths.filter((value) => value !== importPath),
    }

    await writeConfig(nextConfig)
    const collectionMap = await scanCollections(nextConfig.importPaths)

    return {
      config: nextConfig,
      collections: serializeCollections(collectionMap, nextConfig.collectionsSort),
    }
  })
  ipcMain.handle('gallery:update-collection', async (_event, collectionId, updates) => {
    const config = await readConfig()
    const collectionMap = await updateCollectionPreferences(collectionId, updates)
    return {
      config,
      collections: serializeCollections(collectionMap, config.collectionsSort),
    }
  })
  ipcMain.handle('gallery:update-config', async (_event, updates) => {
    const config = await updateAppConfig(updates)
    BrowserWindow.fromWebContents(_event.sender)?.webContents.setZoomFactor(config.uiScale ?? 1)
    const collectionMap = await scanCollections(config.importPaths)
    return {
      config,
      collections: serializeCollections(collectionMap, config.collectionsSort),
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  activeWindowDrags.forEach((activeDrag) => {
    clearInterval(activeDrag.intervalId)
  })
  activeWindowDrags.clear()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
