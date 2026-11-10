const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loom", {
  invoke: (cmd, args) => ipcRenderer.invoke("loom:invoke", cmd, args),
  onEvent: (name, cb) => {
    const handler = (_event, event, payload) => {
      if (event === name) cb(payload);
    };
    ipcRenderer.on("loom:event", handler);
    return () => ipcRenderer.removeListener("loom:event", handler);
  },
  openDialog: (opts) => ipcRenderer.invoke("loom:open-dialog", opts),
  openUrl: (url) => ipcRenderer.invoke("loom:open-url", url),
  homeDir: () => ipcRenderer.invoke("loom:home"),
  copyText: (text) => ipcRenderer.invoke("loom:copy", text),
});
