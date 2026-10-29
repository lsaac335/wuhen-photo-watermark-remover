const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { createReadStream, promises: fs } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const webRoot = path.join(__dirname, "wwwroot");
let mainWindow = null;
let localServer = null;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
};

function startServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url || "/", "http://127.0.0.1");
        const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
        const filePath = path.resolve(webRoot, `.${requestedPath}`);
        if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${path.sep}`)) {
          response.writeHead(404).end("Not found");
          return;
        }
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) throw new Error("Not a file");
        response.writeHead(200, {
          "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "Cache-Control": requestedPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
          "Content-Length": stat.size,
        });
        createReadStream(filePath).pipe(response);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
      }
    });
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", () => {
      const address = localServer.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "无痕修图",
      submenu: [
        { role: "about", label: "关于无痕修图" },
        { type: "separator" },
        { role: "hide", label: "隐藏无痕修图" },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出无痕修图" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "全部置于顶层" },
      ],
    },
  ]));
}

async function createWindow() {
  const url = await startServer();
  mainWindow = new BrowserWindow({
    title: "无痕修图 · 本地照片去水印",
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#f9f8f3",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) event.preventDefault();
  });
  await mainWindow.loadURL(url);
}

ipcMain.handle("save-image", async (_event, payload) => {
  if (!payload || typeof payload.dataUrl !== "string" || typeof payload.fileName !== "string") return false;
  if (!/^data:image\/(png|jpeg);base64,/i.test(payload.dataUrl)) return false;
  const pictures = app.getPath("pictures");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "保存修复后的照片",
    defaultPath: path.join(pictures, path.basename(payload.fileName)),
    filters: [
      { name: "图片", extensions: payload.fileName.toLowerCase().endsWith(".png") ? ["png"] : ["jpg", "jpeg"] },
    ],
  });
  if (result.canceled || !result.filePath) return false;
  const base64 = payload.dataUrl.slice(payload.dataUrl.indexOf(",") + 1);
  await fs.writeFile(result.filePath, Buffer.from(base64, "base64"));
  return true;
});

if (!app.requestSingleInstanceLock()) app.quit();
app.setName("无痕修图");
app.whenReady().then(async () => {
  installMenu();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => localServer?.close());
