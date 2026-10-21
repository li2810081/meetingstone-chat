# 架构说明

## 进程模型

```
┌───────────────────────── Electron 主进程 (main.js) ─────────────────────────┐
│  悬浮窗 BrowserWindow (?mode=overlay, 600×340, transparent, alwaysOnTop)    │
│  主窗   BrowserWindow (?mode=main, 980×780, transparent)                    │
│  Tray / globalShortcut(F10, Ctrl+Alt+M) / 单实例锁 / 外部链接 → shell       │
│  RoomClient (room-stack.cjs) —— 加密、局域网、Nostr 中继                     │
└───────────────▲──────────────────────────────────────────▲─────────────────┘
                │ IPC: room:join / room:send / room:leave   │ room:packet/status/peers
┌───────────────┴──────────────────────────────────────────┴─────────────────┐
│                    Renderer（两个窗口共用同一个 index.html）                 │
│  ?mode=overlay → 透明聊天框；?mode=main → 集合石主窗                         │
│  状态存 localStorage，两个窗口经 storage 事件互相同步                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

两个窗口加载同一份渲染层；模式差异只由 `body.mode-overlay` / `body.mode-main` 的 CSS 与少量启动分支控制。

## 通信层

派生自 lolPing（MIT）：

- `roomCrypto.ts`
  - `deriveRoomKeys(code)`：`scrypt(code, 'lolping/room/v1')` → 32 字节主密钥 → HKDF 分出 `msgKey` 与 `relayTopic`
  - `seal/open`：AES-256-GCM（格式字节 + 12B nonce + 密文 + 16B tag，AAD = 格式字节），单包 ≤ 1200B
  - `makeIdentity(seed)`：Ed25519（签名身份）+ X25519（密语 ECDH）
  - `whisperKey(ours, theirs)` → HKDF；`sealWhisper/openWhisper` 以 `sender:recipient` 作 AAD
- `lanTransport.ts`：UDP 广播，按网络接口计算定向广播地址
- `relayTransport.ts` / `relayPool.ts` / `relayConnection.ts` / `nostrEvent.ts`：公共 Nostr 中继（kind 24747，topic 为 `relayTopic`），每个包一个事件，重连/退避/去重/限流
- `relays.ts`：lolPing 精选的 6 个公共中继

`RoomClient`（`src/roomStack.ts`）把上述组件组装成房间客户端：

- `start(code, profile)`：派生密钥、创建身份、同时启动 LAN 与中继
- presence 每 10 秒广播（携带 X25519 公钥 `xpk`）
- `sendChat(chan, text, to)`：普通消息用房间密钥封包；密语若已拿到对方 `xpk` 则走 whisper 密钥
- 收到包后先 `open` 房间密钥，再按类型分发；密语消息附带 `decrypted` 字段

## 消息类型（房间包明文 JSON）

| type | 说明 | chan |
|---|---|---|
| `presence` | 成员资料 + X25519 公钥 | — |
| `chat` | 普通聊天 | `zong` / `party` / `whisper` |
| `whisper` | 密语（box + fromXpk） | — |
| `chat` (chan=`task`) | 任务 JSON（LWW 合并） | `task` |
| `chat` (chan=`img`) | 图片分片（id/idx/total/data） | `img` |
| `chat` (chan=`muster` / `muster-answer`) | 就位确认广播与应答 | — |

任务合并规则：按 `updatedAt` 新者覆盖；没有服务端权威状态。

## 素材管线

`tools/prepare-assets.py` 从公开上游下载原始贴图，按 `SharedUIPanelTemplates.xml` 的 UV 坐标裁切：

- FrameGeneral：主窗体外壳（岩石底、标题轨、左右边条、四角、内嵌边框）
- DialogFrame：对话框 9-slice（256×32 的 8 个 32×32 子块拼接）、Header 横幅
- CHATFRAME：页签（注意 Selected 贴图是整块黑，需用 BG 半透明版）、图标、输入框边框
- AUCTIONFRAME / HELPFRAME / PaperDollInfoFrame：列表行与页签
- ElvUI：职责图标

注意：`ChatFrameTab-Selected*` 是不可用的整块黑贴图；`UI-DialogBox-Corner` 是空心方括号，不能当角块。
