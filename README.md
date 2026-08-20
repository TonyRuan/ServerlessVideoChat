# ServerlessVideoChat

基于 WebRTC 和 PeerJS 的端点对点（P2P）视频通话应用。Cloudflare Pages 承载静态页面和同源短期 TURN 凭据接口；音视频、聊天和文件内容始终走浏览器 WebRTC，不经过该接口。

## ✨ 核心特性

- **P2P 媒体架构**：无需中心化媒体服务器，使用 PeerJS 进行信令交换，WebRTC 直接传输音视频流；Pages Function 只签发短期 TURN 凭据。
- **设备与网络适配**：
  - 支持多分辨率画质切换（360p ~ 4K）。
  - 默认加入 STUN 和 TURN 候选，优先使用同源接口签发的短期凭据，完整静态凭据只作为迁移和本地回退。
  - 媒体、聊天控制和文件通道均有连接 watchdog；guest 最多六次抖动退避重连，持续失败时可自动升级为强制 TURN 中继。
  - 新建会议和邀请链接会携带 URL hash session；页面刷新后可用同一 session 自动重连，不需要 localStorage 存恢复信息。
  - 内置 WebRTC 诊断面板，折叠时只显示连接状态；展开后分别展示媒体、聊天控制和文件通道的 ICE/PC、选中链路 TURN 状态，以及凭据来源和有效期。
  - 提供网络环境诊断入口，可通过 ICE candidate 采集估算当前网络穿透风险。
- **加密图文聊天**：
  - 聊天消息通过 DataChannel 传输，并在应用层使用 ECDH + AES-GCM 加密。
  - 聊天记录和输入草稿默认只保存在当前页面内存，刷新或关闭页面后清空，不长期写入浏览器存储。
  - 支持文字、JPG、PNG、WebP、GIF，单张图片上限 10MiB。
  - 支持点击选择、从剪贴板粘贴、拖拽上传图片，单击图片可放大查看，桌面端可拖动聊天窗口位置。
  - 非图片文件最大 2GiB；接收端确认并选择保存位置后才开始传输，不支持直接写盘的浏览器使用最多 10MiB 的内存下载回退。
  - 文件数据使用独立可靠 DataConnection、256KiB 二进制 AES-GCM 分片和 1MiB 接收端信用窗口；断线后按接收端已写入偏移恢复，收到最终保存确认后才标记发送完成。
- **视频带宽控制**：
  - SDP 协商优先级为 `AV1 > VP9 > H265 > 其他`。
  - 页面左上角会显示当前协商到的视频 codec 和上下行带宽估算。
- **互动体验**：
  - 屏幕连点触发漂浮 🐶 emoji 动画。
  - 通过 WebRTC DataChannel 实现 🐶 emoji 动画跨端实时同步。
- **现代化 UI**：基于 Tailwind CSS 和 Lucide-React，响应式设计，完美适配移动端和桌面端。

## 🛠 技术栈

- **框架**：React 18 + TypeScript + Vite
- **WebRTC**：PeerJS
- **状态管理**：Zustand (用于跨组件状态，如 `HeartStore`)
- **路由**：React Router DOM v7
- **样式**：Tailwind CSS + `clsx`/`tailwind-merge`

## 📁 核心目录结构 (供 AI 和开发者阅读)

```text
src/
├── components/
│   ├── Button.tsx        # 基础 UI 组件
│   ├── CallControls.tsx  # 桌面/移动通话控制条和无障碍隐藏状态
│   ├── ChatPanel.tsx     # 图文聊天、文件接收、图片预览、焦点管理和加密状态
│   ├── ClickHeart.tsx    # 连点 🐶 emoji 动画组件（带防误触、Zustand 状态分发）
│   ├── NetworkDiagnosticsPanel.tsx # WebRTC 状态、带宽、TURN 和网络环境诊断
│   └── SettingsMenu.tsx  # 画质和画面自适应设置菜单
├── hooks/
│   ├── useMediaStream.ts # 本地摄像头/麦克风流管理、画质切换
│   ├── useAutoHideControls.ts # 通话控件活动检测和自动隐藏
│   └── usePeer.ts        # PeerJS 实例管理、ICE Server (STUN/TURN) 配置、信令交互
├── pages/
│   ├── Home.tsx          # 首页，加入/创建房间入口
│   └── CallPage.tsx      # 通话主页面，包含视频渲染、状态展示、WebRTC 连接逻辑、数据通道通信
├── stores/
│   ├── chatStore.ts      # 当前页面内存态聊天记录、草稿、未读数和发送状态
│   └── heartStore.ts     # Zustand Store，管理本地和远端的爱心数据同步
├── lib/
│   ├── chatCrypto.ts     # 聊天 ECDH + AES-GCM 应用层加密
│   ├── chatProtocol.ts   # 聊天和 session resume wire payload 转换和校验
│   ├── fileTransferBinary.ts # 无 base64 的版本化文件二进制帧
│   ├── fileTransferFlow.ts # 接收端信用窗口、ACK 和恢复偏移规则
│   ├── realtimeProtocol.ts # 画质和爱心控制消息严格校验
│   ├── callSession.ts    # URL hash session 解析、生成和邀请链接构造
│   ├── buildInfo.ts      # 构建版本和编译时间格式化
│   ├── iceConfig.ts      # STUN/TURN RTCConfiguration 生成和 TURN mode 解析
│   ├── turnCredentials.ts # 短期 TURN 凭据校验、刷新和静态回退
│   ├── connectionRecovery.ts # watchdog 时限、退避和 TURN 升级策略
│   ├── transportWatchdog.ts # 数据通道连接 watchdog
│   ├── mediaStats.ts     # WebRTC stats 中的 codec、码率、上下行和 TURN 使用解析
│   ├── networkDiagnostics.ts # ICE candidate 网络环境诊断
│   └── turnFallback.ts   # 连接恢复阶段的 UI 状态文案
├── App.tsx               # 路由配置及 Base URL 处理
└── main.tsx              # 应用入口
functions/
└── api/turn-credentials.ts # Cloudflare Pages 短期 coturn REST 凭据接口
public/
├── _redirects            # Cloudflare Pages 的 SPA 路由重定向配置
├── _routes.json          # 仅将 /api/* 路由到 Pages Functions
├── 404.html              # GitHub Pages 的 SPA 路由兜底重定向逻辑
├── apple-touch-icon.png  # iOS 主屏幕图标
└── favicon.png           # 浏览器标签页图标
```

---

## 🚀 本地开发

1. **安装依赖**
   ```bash
   npm install
   ```

2. **启动开发服务器**
   ```bash
   npm run dev
   ```

3. **构建产物**
   ```bash
   npm run build
   ```

---

## 🌐 部署指南

### 方式一：部署到 Cloudflare Pages（推荐）

本项目已针对 Cloudflare Pages 的 SPA 路由和 Pages Function 进行了适配（包含 `public/_redirects`、`public/_routes.json` 和根目录 `functions/`）。

**通过 Dashboard 部署步骤：**
1. 登录 Cloudflare Dashboard，进入 **Workers & Pages** -> **Create** -> **Pages** -> **Connect to Git**。
2. 选择本项目的 GitHub 仓库。
3. **构建设置 (Build settings)**：
   - **Framework preset**: `None` 或 `Vite` (如果没有 Vite 选 None 即可)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. **Pages Function 绑定和前端环境变量**：
   - `TURN_SHARED_SECRET`：加密 Secret，必须与 coturn `static-auth-secret` 一致，禁止使用 `VITE_` 前缀。
   - `TURN_URLS`：服务端返回的逗号分隔 TURN 地址；生产建议同时提供 UDP 3478 和 TLS 443。
   - `TURN_CREDENTIAL_TTL_SECONDS`：可选，默认 1200 秒，范围 300-3600。
   - `VITE_TURN_CREDENTIALS_URL`：可选，默认 `/api/turn-credentials`。
   - `VITE_TURN_URLS` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL`：完整的静态回退配置，仅用于迁移、本地开发或不支持 Function 的托管环境。
   - `VITE_TURN_MODE`：可选。默认 `on` 表示初始连接即加入 TURN 候选；`off` 表示直连优先、失败后自动 fallback；`force` 表示强制 relay，仅建议排障使用。
5. 点击 **Save and Deploy**。

> **⚠️ 注意（Token 与安全）**：
> 绝对不要把 Cloudflare 的 API Token 或 TURN 服务的明文账号密码硬编码提交到 Git 仓库代码中。
> `TURN_SHARED_SECRET` 必须使用 Cloudflare Pages Secret；所有 `VITE_*` 值都会进入浏览器构建产物，不能承载共享密钥。

### 方式二：部署到 GitHub Pages

1. GitHub Pages 需要仓库子路径构建；项目已通过 `npm run build:github` 显式使用 `/ServerlessVideoChat/` base path。
2. GitHub Pages 不运行 `functions/`，因此需要完整静态 TURN 回退配置，或显式配置等价的外部短期凭据服务。
3. 运行部署脚本：
   ```bash
   npm run deploy
   ```
   *该脚本会先执行 GitHub Pages 专用构建，并将 `dist` 目录推送到 `gh-pages` 分支。*

---

## 🔧 常见问题与排查 (Troubleshooting)

首页加入框只接受创建者分享的完整邀请链接。裸 Peer ID 不含 session，无法安全关联同一会议，因此会被拒绝；手机可直接扫描等待页二维码加入。

### 1. 通话已接通，但看不到对方画面（或一直显示 Waiting）
请查看页面左上角的 **诊断面板**：
- **`ICE: failed` 或长时间 `disconnected`**：说明对应 WebRTC 传输没有可用链路。展开诊断面板确认失败的是媒体、聊天控制还是文件通道。
  - **解决办法**：确认 `/api/turn-credentials` 可用且页面显示“动态短期凭据”，再检查 TURN UDP/TLS 监听、防火墙和 relay 端口范围。恢复逻辑会先重建连接，重复媒体失败后才升级为强制中继。
- **轨道数存在但画面仍是黑屏或尺寸为 `0x0`**：可能已收到媒体轨道但没有实际视频帧，优先看 `ICE` / `PC` 状态、`Codec`、`Video`、`Up/Down`、`TURN` 和 `Bytes` 诊断项。
- **`V: 0`**：对端没有发送视频轨道（对方可能未授权摄像头权限或手动关闭了摄像头）。
- **`Play: NotAllowedError...`**：浏览器自动播放策略拦截了带有音频的视频。
  - **解决办法**：系统会自动尝试将对方静音后重新播放，画面出来后，用户可以手动点击底部控制栏的“喇叭”按钮开启声音。

### 2. 邀请链接打开后不断重定向刷新
- **原因**：SPA 路由在静态托管服务上的 404 兜底策略配置冲突。
- **已解决**：`App.tsx` 已处理 `basename` 避免根路径嵌套；`public/404.html` 已针对 Cloudflare Pages 根域名环境进行了 `pathSegmentsToKeep` 的动态判断适配；Cloudflare 的 `_redirects` 已确保直达 `index.html` 不报 404。

---

## 🤖 供 AI 助手参考的上下文 (AI Context)
- **WebRTC 连接流**：guest 是唯一拨号方，host 只接受连接。连接元数据必须同时匹配 session、相反角色和实际 `connection.peer`；连接建立上限 15 秒、`disconnected` 宽限 5 秒，guest 使用六次带抖动退避重拨，host 回到等待状态。
- **数据同步**：连点爱心、画质切换、session、聊天和文件控制走 `control` DataConnection；加密文件字节走独立 `bulk` DataConnection。聊天层先交换临时 ECDH 公钥，再发送 AES-GCM 密文。
- **TURN 策略**：默认初始 PeerJS 配置包含两组 STUN 和完整 TURN 候选，动态短期凭据优先、静态配置回退。第一次媒体恢复保持 `on`，重复建立失败且 TURN 可用时，后续连接升级为 relay-only `force`。诊断中的“TURN 已启用”不等于选中链路正在中继。
- **环境隔离**：本项目同时兼顾了根域名部署（Cloudflare Pages）和子路径部署（GitHub Pages），在修改路由或构建配置时需同时考虑这两种情况。
