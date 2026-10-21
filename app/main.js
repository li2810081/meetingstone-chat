"use strict";

// 集合石聊天悬浮窗 —— 窗口行为对齐 lolPing（darrenprx/lolPing）：
// 透明无边框悬浮窗、alwaysOnTop('screen-saver')、skipTaskbar、托盘常驻、全局热键冲突探测。
// 与 lolPing 的差异：聊天窗必须可交互（可输入、可点链接），因此不做永久 click-through。

const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, shell } = require("electron");

/** 聊天里的链接交给系统浏览器，绝不在应用内导航或弹 Electron 窗口。 */
function wireExternalLinks(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:")) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}
const { RoomClient } = require("./room-stack.cjs");
const path = require("path");
const fs = require("fs");

const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

let overlayWin = null;
let mainWin = null;
let tray = null;
let boundsFile = null;
let room = null;

const OVERLAY = { width: 600, height: 340 };

function readState() {
  try { return JSON.parse(fs.readFileSync(boundsFile, "utf8")); } catch { return {}; }
}
function writeState(patch) {
  try {
    const cur = readState();
    fs.writeFileSync(boundsFile, JSON.stringify(Object.assign(cur, patch)));
  } catch { /* ignore */ }
}

/** 与 lolPing 相同：注册前先探测快捷键是否被系统/其他应用占用。 */
function registerShortcut(accelerator, handler, label) {
  try {
    const free = globalShortcut.register(accelerator, () => undefined);
    if (!free) {
      console.warn(`[stone-chat] 快捷键 ${label} (${accelerator}) 已被占用，跳过注册`);
      return false;
    }
    globalShortcut.unregister(accelerator);
    globalShortcut.register(accelerator, handler);
    return true;
  } catch (err) {
    console.warn(`[stone-chat] 快捷键 ${accelerator} 注册失败：`, err);
    return false;
  }
}

function createOverlay() {
  const st = readState();
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = st.overlay || {
    x: wa.x + 18,
    y: wa.y + wa.height - OVERLAY.height - 24,
    width: OVERLAY.width,
    height: OVERLAY.height,
  };
  overlayWin = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width || OVERLAY.width, height: bounds.height || OVERLAY.height,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  // 与 lolPing overlay 相同：默认穿透 + 转发鼠标移动，悬停时再由渲染层打开交互
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  if (IS_LINUX) overlayWin.setVisibleOnAllWorkspaces(true);
  if (IS_MAC) overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  const testQuery = {};
  for (const arg of process.argv) {
    const m = arg.match(/^--(autoroom|autosend|autosenddelay|autotask|name|cls)=(.*)$/);
    if (m) testQuery[m[1]] = m[2];
  }
  wireExternalLinks(overlayWin);
  overlayWin.loadFile(path.join(__dirname, "renderer", "index.html"), { query: Object.assign({ mode: "overlay" }, testQuery) });
  overlayWin.once("ready-to-show", () => {
    overlayWin.setBackgroundColor("#00000000");
    overlayWin.showInactive();
  });
  overlayWin.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (overlayWin && !overlayWin.isVisible()) {
        console.log("[stone-chat] overlay not visible, force show");
        overlayWin.showInactive();
      }
    }, 600);
  });
  overlayWin.on("moved", () => {
    if (!overlayWin) return;
    const [x, y] = overlayWin.getPosition();
    const [w, h] = overlayWin.getSize();
    writeState({ overlay: { x, y, width: w, height: h } });
  });
  overlayWin.on("closed", () => { overlayWin = null; });
  overlayWin.webContents.on("did-finish-load", () => console.log("[stone-chat] overlay ready"));
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 980,
    height: 780,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    show: false,
    minWidth: 760,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  wireExternalLinks(mainWin);
  mainWin.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { mode: "main" } });
  mainWin.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.once("ready-to-show", () => {
    console.log("[stone-chat] main ready");
    if (!mainWin.isVisible()) mainWin.show();
  });
}

function openMain() {
  if (!mainWin) createMain();
  mainWin.show();
  mainWin.focus();
}
function toggleMain() {
  if (mainWin && mainWin.isVisible()) mainWin.hide();
  else openMain();
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, "renderer", "assets", "nf-portrait-badge.png"));
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip("集合石 · 聊天悬浮窗");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示聊天窗", click: () => { if (overlayWin) { overlayWin.show(); overlayWin.focus(); } } },
    { label: "打开集合石（Ctrl+Alt+M）", click: openMain },
    { type: "separator" },
    { label: "退出", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", openMain);
}

const MULTI = process.argv.includes("--multi");
const gotLock = MULTI ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (overlayWin) { overlayWin.show(); overlayWin.focus(); }
  });

  app.whenReady().then(() => {
    boundsFile = path.join(app.getPath("userData"), "stone-chat-state.json");
    createOverlay();
    createTray();

    registerShortcut("F10", () => {
      if (!overlayWin) return;
      overlayWin.show();
      overlayWin.webContents.send("focus-chat");
    }, "唤起聊天输入");

    registerShortcut("Control+Alt+M", toggleMain, "开关集合石窗口");

    ipcMain.on("open-main", openMain);
    ipcMain.on("hide-main", () => { if (mainWin) mainWin.hide(); });
    ipcMain.on("toggle-main", toggleMain);
    ipcMain.on("quit", () => { app.isQuitting = true; app.quit(); });
    ipcMain.on("overlay-interactive", (_e, on) => {
      if (!overlayWin) return;
      overlayWin.setIgnoreMouseEvents(!on, { forward: true });
    });
    ipcMain.on("overlay-repaint", () => {
      if (overlayWin) overlayWin.webContents.invalidate();
    });

    const broadcastToWindows = (channel, payload) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(channel, payload);
      }
    };

    ipcMain.on("room:join", async (_e, payload) => {
      try {
        const { code, profile } = payload || {};
        if (!code) return;
        if (room) { try { room.stop(); } catch {} room = null; }
        const client = new RoomClient();
        client.onPacket = (msg) => {
          if (msg) {
            console.log("[stone-chat] recv " + msg.type + " from " + (msg.from && msg.from.name) +
              (msg.text ? " text=" + msg.text : "") + (msg.decrypted ? " whisper=" + msg.decrypted : ""));
          }
          broadcastToWindows("room:packet", msg);
          if (msg && msg.type === "presence") broadcastToWindows("room:peers", client.peerList);
        };
        client.onStatus = (status) => broadcastToWindows("room:status", status);
        await client.start(code, profile || { name: "冒险者", cls: "none", role: "dps" });
        room = client;
        console.log("[stone-chat] room joined: " + code);
      } catch (err) {
        console.log("[stone-chat] room join failed: " + err.message);
        broadcastToWindows("room:status", { lan: "unavailable", internet: "unavailable" });
      }
    });

    ipcMain.on("room:leave", () => {
      try { if (room) room.stop(); } catch {}
      room = null;
      broadcastToWindows("room:status", { lan: "off", internet: "off" });
    });

    ipcMain.on("room:send", (_e, payload) => {
      if (!room || !payload) return;
      try {
        console.log("[stone-chat] send " + (payload.chan || "zong") + " text=" + payload.text);
        room.sendChat(payload.chan || "zong", String(payload.text || ""), payload.to);
      } catch {}
    });

    if (process.argv.includes("--selftest")) {
      setTimeout(async () => {
        try {
          if (overlayWin) {
            const b = overlayWin.getBounds();
            console.log("[selftest] overlay visible=" + overlayWin.isVisible() + " bounds=" + JSON.stringify(b));
            const img = await overlayWin.webContents.capturePage();
            fs.writeFileSync(path.join(app.getPath("temp"), "stone-overlay-selftest.png"), img.toPNG());
          }
          openMain();
          await new Promise(r => setTimeout(r, 1500));
          if (mainWin) {
            const b2 = mainWin.getBounds();
            console.log("[selftest] main visible=" + mainWin.isVisible() + " bounds=" + JSON.stringify(b2));
            const img2 = await mainWin.webContents.capturePage();
            fs.writeFileSync(path.join(app.getPath("temp"), "stone-main-selftest.png"), img2.toPNG());
          }
        } catch (e) {
          console.log("[selftest] error " + e.message);
        }
        app.isQuitting = true;
        app.quit();
      }, 3000);
    }
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    try { if (room) room.stop(); } catch {}
  });

  app.on("window-all-closed", () => {
    // 常驻托盘：不随窗口关闭退出
  });
}
