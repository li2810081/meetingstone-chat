"use strict";
// 集合石极简中继：按房间码分组，只做广播转发，不持久化、不解密。
// 用法：PORT=8787 npm start
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const MAX_ROOM = Number(process.env.MAX_ROOM || 32);
const MAX_PAYLOAD = 64 * 1024;
const rooms = new Map(); // roomCode -> Set<ws>

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  let room = "";
  try {
    room = (new URL(req.url, "http://relay").searchParams.get("room") || "").toUpperCase().slice(0, 24);
  } catch { /* ignore */ }
  if (!room) { ws.close(1008, "room required"); return; }

  let set = rooms.get(room);
  if (!set) { set = new Set(); rooms.set(room, set); }
  if (set.size >= MAX_ROOM) { ws.close(1008, "room full"); return; }
  set.add(ws);
  ws.send(JSON.stringify({ type: "hello", room, peers: set.size }));

  ws.on("message", (data) => {
    if (data.length > MAX_PAYLOAD) return;
    for (const peer of set) {
      if (peer !== ws && peer.readyState === 1) peer.send(data);
    }
  });
  ws.on("close", () => {
    set.delete(ws);
    if (!set.size) rooms.delete(room);
  });
});

console.log("[stone-relay] listening on port " + PORT);
