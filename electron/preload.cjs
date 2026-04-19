const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('galleryApp', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  minimizeWindow: () => ipcRenderer.invoke('app:minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('app:toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('app:close-window'),
  getWindowBounds: () => ipcRenderer.invoke('app:get-window-bounds'),
  startWindowDrag: () => ipcRenderer.invoke('app:start-window-drag'),
  stopWindowDrag: () => ipcRenderer.send('app:stop-window-drag'),
  setWindowPosition: (x, y) => ipcRenderer.send('app:set-window-position', x, y),
  getState: () => ipcRenderer.invoke('gallery:get-state'),
  scanCollections: () => ipcRenderer.invoke('gallery:scan'),
  addImportPath: () => ipcRenderer.invoke('gallery:add-import-path'),
  removeImportPath: (importPath) => ipcRenderer.invoke('gallery:remove-import-path', importPath),
  updateConfig: (updates) => ipcRenderer.invoke('gallery:update-config', updates),
  updateCollection: (collectionId, updates) =>
    ipcRenderer.invoke('gallery:update-collection', collectionId, updates),
})
