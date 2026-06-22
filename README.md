# ServerlessVideoChat

基于 WebRTC 和 PeerJS 的无服务器端点对点（P2P）视频通话应用。支持跨设备视频通话、媒体流控制、画质切换、加密图文聊天、网络诊断和直连失败后的 TURN 自动 fallback。

## ✨ 核心特性

- **纯前端 P2P 架构**：无需中心化媒体服务器，使用 PeerJS 进行信令交换，WebRTC 直接传输音视频流。
- **设备与网络适配**：
  - 支持多分辨率画质切换（360p ~ 4K）。
  - 默认 STUN 直连优先；当 ICE / PeerConnection 失败时自动启用 TURN 并重建媒体与聊天数据通道。
  - 内置 WebRTC 诊断面板，展示 ICE/PC 状态、轨道数、视频 codec、视频码率、连接上下行带宽和当前是否使用 TURN。
  - 提供网络环境诊断入口，可通过 ICE candidate 采集估算当前网络穿透风险。
- **加密图文聊天**：
  - 聊天消息通过 DataChannel 传输，并在应用层使用 ECDH + AES-GCM 加密。
  - 聊天记录默认保存在浏览器本地 `localStorage`。
  - 支持文字、JPG、PNG、WebP、GIF，单张图片上限 10MiB。
  - 支持从剪贴板粘贴图片、单击图片放大查看、桌面端拖动聊天窗口位置。
- **视频带宽控制**：
  - SDP 协商优先级为 `AV1 > VP9 > H265 > 其他`。
  - 页面左上角会显示当前协商到的视频 codec 和上下行带宽估算。
- **互动体验**：
  - 屏幕连点触发漂浮爱心动画。
  - 通过 WebRTC DataChannel 实现爱心动画跨端实时同步。
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
│   ├── ChatPanel.tsx     # 图文聊天、图片预览、拖动位置和加密状态
│   ├── ClickHeart.tsx    # 连点爱心动画组件（带防误触、Zustand 状态分发）
│   ├── NetworkDiagnosticsPanel.tsx # WebRTC 状态、带宽、TURN 和网络环境诊断
│   └── SettingsMenu.tsx  # 画质和画面自适应设置菜单
├── hooks/
│   ├── useMediaStream.ts # 本地摄像头/麦克风流管理、画质切换
│   └── usePeer.ts        # PeerJS 实例管理、ICE Server (STUN/TURN) 配置、信令交互
├── pages/
│   ├── Home.tsx          # 首页，加入/创建房间入口
│   └── CallPage.tsx      # 通话主页面，包含视频渲染、状态展示、WebRTC 连接逻辑、数据通道通信
├── stores/
│   ├── chatStore.ts      # 本地聊天记录、草稿、未读数和 localStorage 持久化
│   └── heartStore.ts     # Zustand Store，管理本地和远端的爱心数据同步
├── lib/
│   ├── chatCrypto.ts     # 聊天 ECDH + AES-GCM 应用层加密
│   ├── chatProtocol.ts   # 聊天 wire payload 转换和校验
│   ├── iceConfig.ts      # STUN/TURN RTCConfiguration 生成和 TURN mode 解析
│   ├── mediaStats.ts     # WebRTC stats 中的 codec、码率、上下行和 TURN 使用解析
│   ├── networkDiagnostics.ts # ICE candidate 网络环境诊断
│   └── turnFallback.ts   # 直连失败后的 TURN fallback 动作派生
├── App.tsx               # 路由配置及 Base URL 处理
└── main.tsx              # 应用入口
public/
├── _redirects            # Cloudflare Pages 的 SPA 路由重定向配置
└── 404.html              # GitHub Pages 的 SPA 路由兜底重定向逻辑
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

本项目已针对 Cloudflare Pages 的 SPA 路由进行了完全适配（包含 `public/_redirects`）。

**通过 Dashboard 部署步骤：**
1. 登录 Cloudflare Dashboard，进入 **Workers & Pages** -> **Create** -> **Pages** -> **Connect to Git**。
2. 选择本项目的 GitHub 仓库。
3. **构建设置 (Build settings)**：
   - **Framework preset**: `None` 或 `Vite` (如果没有 Vite 选 None 即可)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. **环境变量配置 (Environment variables)**：
   *为了保证跨网络/跨运营商设备能够成功建立视频流，建议配置 TURN 服务器。初次连接仍会优先 STUN 直连；检测到直连失败后，页面会自动启用 TURN 并重连。*
   - `VITE_TURN_URLS`：TURN 服务器地址，多个用逗号分隔（例：`turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp`）
   - `VITE_TURN_USERNAME`：TURN 用户名
   - `VITE_TURN_CREDENTIAL`：TURN 密码
   - `VITE_TURN_MODE`：可选。默认 `off` 表示直连优先、失败后自动 fallback；`on` 表示初始连接即加入 TURN 候选；`force` 表示强制 relay，仅建议排障使用。
5. 点击 **Save and Deploy**。

> **⚠️ 注意（Token 与安全）**：
> 绝对不要把 Cloudflare 的 API Token 或 TURN 服务的明文账号密码硬编码提交到 Git 仓库代码中。
> 所有的 Key 和 Token 都应该通过 Cloudflare Dashboard 的 **Environment variables** 注入，或者在使用 CLI 部署时作为本地环境变量提供。

### 方式二：部署到 GitHub Pages

1. GitHub Pages 需要仓库子路径构建；项目已通过 `npm run build:github` 显式使用 `/ServerlessVideoChat/` base path。
2. 运行部署脚本：
   ```bash
   npm run deploy
   ```
   *该脚本会先执行 GitHub Pages 专用构建，并将 `dist` 目录推送到 `gh-pages` 分支。*

---

## 🔧 常见问题与排查 (Troubleshooting)

### 1. 通话已接通，但看不到对方画面（或一直显示 Waiting）
请查看页面左上角的 **诊断面板**：
- **`ICE: failed` 或 `disconnected`**：说明 WebRTC NAT 打洞失败，底层媒体连接未建立。这是跨设备/跨网络最常见的问题。
  - **解决办法**：确认构建产物里注入了有效的 `VITE_TURN_URLS` 及对应凭证。当前页面会在直连失败后自动启用 TURN；如果仍失败，检查 TURN 服务器地址、账号密码、防火墙和 relay 端口范围。
- **轨道数存在但画面仍是黑屏或尺寸为 `0x0`**：可能已收到媒体轨道但没有实际视频帧，优先看 `ICE` / `PC` 状态、`Codec`、`Video`、`Up/Down`、`TURN` 和 `Bytes` 诊断项。
- **`V: 0`**：对端没有发送视频轨道（对方可能未授权摄像头权限或手动关闭了摄像头）。
- **`Play: NotAllowedError...`**：浏览器自动播放策略拦截了带有音频的视频。
  - **解决办法**：系统会自动尝试将对方静音后重新播放，画面出来后，用户可以手动点击底部控制栏的“喇叭”按钮开启声音。

### 2. 邀请链接打开后不断重定向刷新
- **原因**：SPA 路由在静态托管服务上的 404 兜底策略配置冲突。
- **已解决**：`App.tsx` 已处理 `basename` 避免根路径嵌套；`public/404.html` 已针对 Cloudflare Pages 根域名环境进行了 `pathSegmentsToKeep` 的动态判断适配；Cloudflare 的 `_redirects` 已确保直达 `index.html` 不报 404。

---

## 🤖 供 AI 助手参考的上下文 (AI Context)
- **WebRTC 连接流**：发端在 `CallPage.tsx` 的 `useEffect` 中调用 `usePeer` 的 `callPeer`，接收端在监听到 `onIncomingCall` 时调用 `call.answer(stream)`。
- **数据同步**：连点爱心、画质切换和加密聊天都走 PeerJS DataConnection。聊天层先交换临时 ECDH 公钥，再发送 AES-GCM 密文。
- **TURN 策略**：默认初始 PeerJS 配置只含 STUN。`CallPage.tsx` 检测到底层传输失败后调用 `usePeer.enableTurnFallback()`，在保留 Peer ID 的前提下切换后续连接配置；caller 会重拨，callee 会等待重连。
- **环境隔离**：本项目同时兼顾了根域名部署（Cloudflare Pages）和子路径部署（GitHub Pages），在修改路由或构建配置时需同时考虑这两种情况。
