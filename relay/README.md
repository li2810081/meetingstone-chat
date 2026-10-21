# stone-relay（可选）

极简 WebSocket 房间中继：按 `?room=CODE` 分组广播，只转发、不持久化、不解密。

> 应用默认使用公共 Nostr 中继，无需自建。此中继适合在内网/自控服务器上做备用通道。

```bash
npm install
PORT=8787 npm start
```

客户端连接：`ws://<host>:8787/?room=<房间码>`。注意当前应用内置的 `RoomClient` 使用 lolPing 的
Nostr 中继协议；如需改接此中继，需要把 `relayTransport` 替换为普通 WebSocket 客户端。
