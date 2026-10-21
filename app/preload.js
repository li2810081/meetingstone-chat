"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  openMain: () => ipcRenderer.send("open-main"),
  hideMain: () => ipcRenderer.send("hide-main"),
  toggleMain: () => ipcRenderer.send("toggle-main"),
  quit: () => ipcRenderer.send("quit"),
  onFocusChat: (cb) => ipcRenderer.on("focus-chat", () => cb()),
  setOverlayInteractive: (on) => ipcRenderer.send("overlay-interactive", !!on),
  repaint: () => ipcRenderer.send("overlay-repaint"),
  roomJoin: (code, profile) => ipcRenderer.send("room:join", { code, profile }),
  roomLeave: () => ipcRenderer.send("room:leave"),
  roomSend: (chan, text, to) => ipcRenderer.send("room:send", { chan, text, to }),
  onRoomPacket: (cb) => ipcRenderer.on("room:packet", (_e, msg) => cb(msg)),
  onRoomStatus: (cb) => ipcRenderer.on("room:status", (_e, st) => cb(st)),
  onRoomPeers: (cb) => ipcRenderer.on("room:peers", (_e, peers) => cb(peers)),
});
