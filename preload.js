const { contextBridge, ipcRenderer } = require('electron') // or `import` if you're writing it in ESM too

contextBridge.exposeInMainWorld('electronAPI', {
  submitQuest: (text) => ipcRenderer.invoke('quest:submit', text),
  cancelQuest: () => ipcRenderer.invoke('quest:cancel')
})