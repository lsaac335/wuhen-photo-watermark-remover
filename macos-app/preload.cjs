const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  saveImage: (payload) => ipcRenderer.invoke("save-image", payload),
});
