# 集合石 · 聊天悬浮窗（MeetingStone Chat）

魔兽世界风格的桌面聊天悬浮窗。常驻在桌面左下角，平时几乎全透明，用 F10 唤起；房间消息走**端到端加密**，支持局域网与公共中继。

> 非商业粉丝项目。界面贴图版权归 Blizzard Entertainment，详见 [NOTICE.md](NOTICE.md)。代码为 MIT。

## 功能

- **透明悬浮窗**：无边框、置顶、可拖动（位置持久化）、托盘常驻
- **两阶段隐现**：鼠标移开只剩聊天文字；2 分钟无新消息连文字一起淡出；新消息恢复
- **原版聊天框结构**：三段式页签、左侧气泡/滚动按钮、说/队/团/战/公/喊/密频道栏、原版输入框边框
- **斜杠命令**：`/help` 列出全部；`/join 房间码`、`/leave`、`/jhs stone|log|party|settings|close`、`/w 名字 内容`、`/r`、`/p`、`/1`、`/who`、`/dance`、`/wave`、`/bow`、`/小鸡`、`/quit`
- **右键昵称**：密语 / 邀请组队 / 发起决斗 / 查看玩家信息 / 复制名字
- **个人信息**：昵称、13 职业、职责；聊天名字按魔兽职业色显示
- **链接与图片**：URL 可点（系统浏览器打开）；拖拽/粘贴图片（≤48KB，加密分片传输，gif 保留动画）
- **集合石主窗**（Ctrl+Alt+M）：招募 / 任务日志 / 小队 / 设置，原版 NetEasePanel 框体
- **房间通信**：房间码 → scrypt 派生密钥 → AES-256-GCM 封包；局域网 UDP 广播 + 公共 Nostr 中继
- **密语**：X25519 ECDH + HKDF + AES-256-GCM，点对点
- **任务同步 / 就位确认**：经加密房间通道广播

## 快速开始

要求：Node.js ≥ 20（开发环境为 Node 22 / Electron 40）。

```bash
cd app
npm install
npm start          # 自动 esbuild 打包通信层并启动
```

素材已随仓库提供。如需重新生成（或仓库被剥离素材后），运行：

```bash
pip install pillow
python tools/prepare-assets.py
```

自检（截图两个窗口后退出）：

```bash
cd app
npm run selftest
```

## 使用

- **F10**：唤起聊天输入（全局快捷键，注册前会探测冲突）
- **Ctrl+Alt+M**：开关集合石主窗口
- 点击左上角气泡：弹出全部斜杠命令
- 拖拽图片到聊天框 / 输入框内 Ctrl+V 粘贴图片
- 托盘菜单：显示聊天 / 打开集合石 / 退出

### 创建与加入房间

1. 主窗顶栏「创建房间」生成房间码，或「加入房间」输入别人的房间码
2. 两个实例（两台机器）使用同一房间码即可互通：
   - 局域网：同网段自动发现（UDP 广播）
   - 互联网：通过公共 Nostr 中继（`app/src/main/relays.ts` 内置 6 个）
3. 状态点：顶栏「局域网 / 互联网」显示真实连接状态

### 双实例本机测试

```bash
cd app
npx electron . --multi --user-data-dir=%TEMP%/stone-a --autoroom=TEST123 --name=A-warrior --cls=warrior
npx electron . --multi --user-data-dir=%TEMP%/stone-b --autoroom=TEST123 --name=B-mage --cls=mage
```

## 目录结构

```
app/                  Electron 应用
  main.js             主进程：两个窗口、托盘、热键、房间 IPC
  preload.js          contextBridge API
  src/main/           通信与加密（派生自 lolPing，MIT）
  src/roomStack.ts    RoomClient：封装加入/发送/成员
  renderer/index.html 全部界面（悬浮窗 + 主窗 + 弹窗）
  renderer/assets/    UI 贴图（版权见 NOTICE.md）
relay/                可选的极简 WebSocket 中继（Node + ws）
tools/prepare-assets.py  从公开上游下载并裁切贴图
docs/ARCHITECTURE.md  架构与协议说明
```

## 已知限制

- 图片单张 ≤ 48KB（房间包上限 1200 字节，需分片）；大图会被拒绝
- 任务同步为 LWW（按 `updatedAt` 合并），无离线队列/断线重发
- 密语需要双方 presence 已交换（约 10 秒一次），对方离线则失败
- 就位确认的广播链路已实现，跨实例完整流程仍在打磨
- 本地文件路径（`C:\...`）不会变成可点链接
- UDP 广播在部分沙箱/受限网络不可用，此时自动只走中继（状态点会显示）

## 版本

v0.1.0 — 见 [CHANGELOG.md](CHANGELOG.md)

## 许可

- 代码：[MIT](LICENSE)
- 第三方代码：[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)
- UI 素材：见 [NOTICE.md](NOTICE.md)（© Blizzard Entertainment / Tukui / MeetingStone 作者）
