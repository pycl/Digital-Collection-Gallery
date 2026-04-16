const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('galleryApp', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  getState: () => ipcRenderer.invoke('gallery:get-state'),
  scanCollections: () => ipcRenderer.invoke('gallery:scan'),
  addImportPath: () => ipcRenderer.invoke('gallery:add-import-path'),
  removeImportPath: (importPath) => ipcRenderer.invoke('gallery:remove-import-path', importPath),
  updateConfig: (updates) => ipcRenderer.invoke('gallery:update-config', updates),
  updateCollection: (collectionId, updates) =>
    ipcRenderer.invoke('gallery:update-collection', collectionId, updates),
})
