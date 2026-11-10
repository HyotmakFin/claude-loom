const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

if (process.env.XDG_SESSION_TYPE === "wayland") {
  app.commandLine.appendSwitch("ozone-platform", "wayland");
}

let win = null;
let backend = null;
let nextId = 1;
const pending = new Map();

function backendPath() {
  if (process.env.LOOM_BACKEND) return process.env.LOOM_BACKEND;
  const name = process.platform === "win32" ? "loom-backend.exe" : "loom-backend";
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  return path.join(__dirname, "..", "sidecar", "target", "debug", name);
}

function startBackend() {
  const file = backendPath();
  backend = spawn(file, [], {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      LOOM_CONFIG_DIR: path.join(app.getPath("appData"), "dev.loom.app"),
      LOOM_VERSION: app.getVersion(),
    },
  });
  backend.on("error", (err) => {
    console.error("[loom] backend failed:", err);
    dialog.showErrorBox("Loom 后端启动失败", `${file}\n${err.message}`);
    app.quit();
  });
  const rl = readline.createInterface({ input: backend.stdout });
  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event) {
      win?.webContents.send("loom:event", msg.event, msg.payload);
      return;
    }
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.data);
    else waiter.reject(new Error(msg.error || "backend error"));
  });
  backend.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`backend exited (${code})`));
    pending.clear();
    if (!app.isQuitting) console.error("[loom] backend exited", code);
  });
}

function invoke(cmd, args) {
  return new Promise((resolve, reject) => {
    if (!backend || !backend.stdin.writable) {
      reject(new Error("backend not running"));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    backend.stdin.write(JSON.stringify({ id, cmd, args: args || {} }) + "\n");
  });
}

app.whenReady().then(() => {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  startBackend();
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Loom",
    backgroundColor: "#f5f3ee",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.on("console-message", (_e, _level, message) => {
    if (process.env.LOOM_DEBUG) console.log("[renderer]", message);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[loom] load failed", code, desc, url);
  });
  if (process.env.LOOM_FPS_OVERLAY) {
    win.webContents.on("did-finish-load", () => {
      const script = `(() => {
        if (window.__loomFpsOverlay) return;
        window.__loomFpsOverlay = true;
        const el = document.createElement("div");
        el.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#0f0;font:12px monospace;padding:4px 6px;border-radius:4px;pointer-events:none";
        document.body.appendChild(el);
        let n = 0, t0 = performance.now();
        const loop = (t) => {
          n++;
          if (t - t0 >= 1000) {
            el.textContent = (n * 1000 / (t - t0)).toFixed(1) + " fps";
            n = 0; t0 = t;
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      })();`;
      win.webContents.executeJavaScript(script).catch(() => {});
    });
  }
  const devUrl = process.env.LOOM_DEV_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
});

ipcMain.handle("loom:invoke", (_e, cmd, args) => invoke(cmd, args));

ipcMain.handle("loom:open-dialog", async (_e, opts = {}) => {
  const properties = [];
  if (opts.directory) properties.push("openDirectory");
  else properties.push("openFile");
  if (opts.multiple) properties.push("multiSelections");
  const result = await dialog.showOpenDialog(win, {
    properties,
    defaultPath: opts.defaultPath,
    title: opts.title,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return opts.multiple ? result.filePaths : result.filePaths[0];
});

ipcMain.handle("loom:open-url", async (_e, url) => {
  if (typeof url !== "string") return;
  await shell.openExternal(url);
});

ipcMain.handle("loom:home", () => app.getPath("home"));

ipcMain.handle("loom:copy", (_e, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  app.isQuitting = true;
  try {
    backend?.stdin.end();
  } catch {}
  setTimeout(() => backend?.kill(), 500).unref();
});
