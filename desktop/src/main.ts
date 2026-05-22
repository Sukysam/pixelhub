import { app, BrowserWindow, Menu, Tray, nativeImage, shell, type Event } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";

function getAppUrl(): string {
  const raw = (process.env.APP_URL || "").trim();
  if (raw) return raw;
  return isDev ? "http://localhost:3000" : "https://example.com";
}

function getIconPath(): string {
  return path.resolve(__dirname, "..", "..", "frontend", "public", "favicon.ico");
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  const url = getAppUrl();
  win.loadURL(url);
  if (isDev) win.webContents.openDevTools({ mode: "detach" });

  win.on("close", (e: Event) => {
    if (process.platform !== "darwin") {
      e.preventDefault();
      win.hide();
    }
  });

  mainWindow = win;
}

function createTray() {
  const iconPath = getIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip("SukyAcc");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: "Reload",
      click: () => {
        mainWindow?.reload();
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function startAutoUpdates() {
  if (isDev) return;
  if (process.env.AUTO_UPDATE === "0") return;
  autoUpdater.checkForUpdatesAndNotify().catch(() => null);
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => null);
  }, 6 * 60 * 60 * 1000);
}

app.setAppUserModelId("com.sukyacc.app");

app.whenReady().then(() => {
  createWindow();
  createTray();
  startAutoUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    mainWindow?.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") return;
  app.quit();
});
