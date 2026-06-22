# ServerlessVideoChat

基于 WebRTC 和 PeerJS 的无服务器端点对点（P2P）视频通话应用。支持跨设备视频通话、媒体流控制、画质切换以及趣味互动（同步点击爱心动画）。

## ✨ 核心特性

- **纯前端 P2P 架构**：无需中心化媒体服务器，使用 PeerJS 进行信令交换，WebRTC 直接传输音视频流。
- **设备与网络适配**：
  - 支持多分辨率画质切换（360p ~ 4K）。
  - 内置完整的 WebRTC 诊断面板（ICE 状态、轨道数、收发字节数），方便排查 NAT 穿透问题。
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
│   ├── ClickHeart.tsx    # 连点爱心动画组件（带防误触、Zustand 状态分发）
│   ├── Button.tsx        # 基础 UI 组件
│   └── SettingsMenu.tsx  # 画质和画面自适应设置菜单
├── hooks/
│   ├── useMediaStream.ts # 本地摄像头/麦克风流管理、画质切换
│   └── usePeer.ts        # PeerJS 实例管理、ICE Server (STUN/TURN) 配置、信令交互
├── pages/
│   ├── Home.tsx          # 首页，加入/创建房间入口
│   └── CallPage.tsx      # 通话主页面，包含视频渲染、状态展示、WebRTC 连接逻辑、数据通道通信
├── stores/
│   └── heartStore.ts     # Zustand Store，管理本地和远端的爱心数据同步
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
   *为了保证跨网络/跨运营商设备能够成功建立视频流，强烈建议配置 TURN 服务器。*
   - `VITE_TURN_URLS`：TURN 服务器地址，多个用逗号分隔（例：`turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp`）
   - `VITE_TURN_USERNAME`：TURN 用户名
   - `VITE_TURN_CREDENTIAL`：TURN 密码
5. 点击 **Save and Deploy**。

> **⚠️ 注意（Token 与安全）**：
> 绝对不要把 Cloudflare 的 API Token 或 TURN 服务的明文账号密码硬编码提交到 Git 仓库代码中。
> 所有的 Key 和 Token 都应该通过 Cloudflare Dashboard 的 **Environment variables** 注入，或者在使用 CLI 部署时作为本地环境变量提供。

### 方式二：部署到 GitHub Pages

1. 确保 `vite.config.ts` 中的 `base` 路径配置正确（当前代码已做自动兼容，非 Cloudflare 环境默认保留子路径 `base`）。
2. 运行部署脚本：
   ```bash
   npm run deploy
   ```
   *该脚本会自动执行构建，并将 `dist` 目录推送到 `gh-pages` 分支。*

---

## 🔧 常见问题与排查 (Troubleshooting)

### 1. 通话已接通，但看不到对方画面（或一直显示 Waiting）
请查看页面左上角的 **诊断面板**：
- **`ICE: failed` 或 `disconnected`**：说明 WebRTC NAT 打洞失败，底层媒体连接未建立。这是跨设备/跨网络最常见的问题。
  - **解决办法**：必须在环境变量中配置有效的 `VITE_TURN_URLS` 及对应凭证。纯 STUN 服务器无法穿透所有复杂的 NAT 网络。
- **`V: 1 / A: 1 · Size: 0x0` 且 `In: video -`**：对方没有成功发送视频流数据（可能是网络阻断，同样需要 TURN）。
- **`V: 0`**：对端没有发送视频轨道（对方可能未授权摄像头权限或手动关闭了摄像头）。
- **`Play: NotAllowedError...`**：浏览器自动播放策略拦截了带有音频的视频。
  - **解决办法**：系统会自动尝试将对方静音后重新播放，画面出来后，用户可以手动点击底部控制栏的“喇叭”按钮开启声音。

### 2. 邀请链接打开后不断重定向刷新
- **原因**：SPA 路由在静态托管服务上的 404 兜底策略配置冲突。
- **已解决**：`App.tsx` 已处理 `basename` 避免根路径嵌套；`public/404.html` 已针对 Cloudflare Pages 根域名环境进行了 `pathSegmentsToKeep` 的动态判断适配；Cloudflare 的 `_redirects` 已确保直达 `index.html` 不报 404。

---

## 🤖 供 AI 助手参考的上下文 (AI Context)
- **WebRTC 连接流**：发端在 `CallPage.tsx` 的 `useEffect` 中调用 `usePeer` 的 `callPeer`，接收端在监听到 `onIncomingCall` 时调用 `call.answer(stream)`。
- **数据同步**：连点爱心的坐标和颜色通过 `dataConnRef.current.send()` 以 `{ type: 'HEART', heart: HeartData }` 格式发送，对端在 `conn.on('data')` 中接收并更新 `useHeartStore` 触发渲染。
- **环境隔离**：本项目同时兼顾了根域名部署（Cloudflare Pages）和子路径部署（GitHub Pages），在修改路由或构建配置时需同时考虑这两种情况。
