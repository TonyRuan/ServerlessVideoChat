# ServerlessVideoChat 项目说明

> 后续项目有代码、配置、部署方式或核心交互变化时，必须同步更新本文档。

## 项目定位

`ServerlessVideoChat` 是一个纯前端静态 SPA 视频通话项目，基于 React 18、TypeScript、Vite、PeerJS 和 WebRTC 实现点对点音视频通话。

这里的 serverless 指没有自建媒体服务器；音视频媒体面走浏览器 WebRTC P2P。信令层仍依赖 PeerJS 服务，当前代码未显式配置自建 PeerServer。

## 主要技术栈

- React 18 + TypeScript + Vite
- React Router DOM v7
- PeerJS + WebRTC
- Zustand，用于爱心互动事件状态和本地聊天状态
- Tailwind CSS + `clsx` / `tailwind-merge`
- Lucide React 图标

## 运行脚本

- `npm run dev`：启动 Vite 开发服务器
- `npm run check`：执行 TypeScript 检查
- `npm run lint`：执行 ESLint
- `npm run build`：先执行 `tsc -b`，再执行 `vite build`
- `npm run build:github`：为 GitHub Pages 构建，显式使用 `/ServerlessVideoChat/` base path
- `npm run preview`：预览构建产物
- `npm run deploy`：先执行 GitHub Pages 专用构建，再通过 `gh-pages -d dist` 发布到 GitHub Pages
- `npx wrangler pages deploy dist --project-name serverlessvideochat`：将 `dist` 发布到 Cloudflare Pages，需要本机已登录 Wrangler 或通过本地未跟踪环境文件提供 Cloudflare API token

## 路由和页面

入口文件：

- `src/main.tsx`：React 挂载入口
- `src/App.tsx`：`BrowserRouter` 和页面路由配置

页面路由：

- `/`：首页，显示本地摄像头预览，可新建会议或输入会议 ID/链接加入
- `/call`：通话等待页，创建本端 Peer ID 并等待对方呼入
- `/call/:remotePeerId`：主动呼叫指定 Peer ID

`ClickHeart` 在 `App` 中全局挂载，因此首页和通话页都会响应双击爱心动画。

## 核心运行链

### 本地媒体

`src/hooks/useMediaStream.ts` 负责：

- 调用 `navigator.mediaDevices.getUserMedia`
- 默认请求 720p 音视频流
- 支持 360p、480p、720p、1080p、4K 画质选择
- 切换麦克风和摄像头 track enabled 状态
- 切换画质时重新采集媒体流
- cleanup 时停止所有 tracks

注意：当前 `initializeStream` 会先停止旧 stream 再请求新 stream。如果新请求失败，页面状态可能仍引用已停止的旧 stream，后续改动要重点留意这个边界。

### PeerJS / WebRTC

`src/hooks/usePeer.ts` 负责：

- 创建 PeerJS 实例
- 注入 STUN / TURN 配置
- 暴露 `callPeer`、`connectToPeer`
- 注册 incoming media call 和 data connection 回调

默认 STUN 包括 Google、Cloudflare、Twilio 等公开服务。TURN 通过以下环境变量注入：

- `VITE_TURN_URLS`
- `VITE_TURN_USERNAME`
- `VITE_TURN_CREDENTIAL`

纯 STUN 不保证复杂 NAT 下连通。跨网络、跨运营商稳定通话通常需要 TURN。

2026-06-22 已在阿里云 ECS `39.108.122.44` 上安装 coturn：

- 系统：Debian 11
- 服务：`coturn.service`
- TURN URL：`turn:39.108.122.44:3478?transport=udp`、`turn:39.108.122.44:3478?transport=tcp`
- coturn realm：`chat.uavserver.cn`
- relay 端口范围：`49160-49200`
- TURN 用户名和密码保存在未跟踪的 `.env.local`，构建时通过 `VITE_TURN_*` 注入前端

服务器内 `turnutils_uclient` 自测已通过，认证和收发正常。阿里云安全组放行后，本机公网 TCP 3478 已可达；浏览器 `RTCPeerConnection` 强制 `iceTransportPolicy: "relay"` 且只配置该 TURN 时，已拿到 `relay` candidate，`errorCount=0`。阿里云安全组入方向需保持放行：

- TCP `3478`
- UDP `3478`
- UDP `49160-49200`

当前接入方式是静态前端凭据，TURN 用户名和密码会进入前端构建产物，不能视为服务端秘密。若后续公开访问量变大或担心滥用，应改为服务端签发短期 TURN 凭据。

### 通话页面

`src/pages/CallPage.tsx` 目前集中承担：

- caller / callee 角色判断
- PeerJS 媒体呼叫和应答
- DataConnection 建立
- 本地视频 PIP 和远端视频全屏渲染
- 远端自动播放失败后的静音重试
- ICE / PeerConnection / inbound stats 诊断展示
- 左上角网络环境诊断入口，通过浏览器 ICE 候选采集估算当前网络是否可能需要 TURN
- 音频、视频、画质、显示模式、挂断等控制
- 爱心和画质消息的数据通道同步
- 加密图文聊天的数据通道同步与本地历史展示

该文件复杂度较高。后续大改时优先考虑拆分为更小的 hook 或组件，但不要在无明确目标时做大范围重构。

## 数据通道消息

DataConnection 当前承载两类消息：

```ts
{ type: 'HEART', heart: HeartData }
{ type: 'QUALITY_CHANGE', quality: VideoQuality }
{ type: 'CHAT_CRYPTO_KEY', version: 1, publicKey: JsonWebKey }
{ type: 'CHAT_CIPHER', version: 1, iv: string, data: string }
```

爱心状态在 `src/stores/heartStore.ts` 中保存为最后一次 incoming/outgoing 事件，不是队列。极高频事件存在被覆盖的风险，连接未 open 前触发的 outgoing heart 也不会补发。

聊天消息先在 DataConnection 上交换临时 ECDH P-256 公钥，再用派生出的 AES-GCM key 加密 `{ type: 'CHAT_MESSAGE', message }` payload 后发送。WebRTC DataChannel 自身已有 DTLS 传输加密；聊天层额外做应用层加密。当前没有独立身份认证，密钥握手建立在既有 PeerJS/WebRTC 连接之上。

聊天记录默认存浏览器本地 `localStorage`，key 命名空间为 `serverlessVideoChat:chat:v1:<conversationId>`，会话 ID 由双方 Peer ID 排序后拼接。每个会话最多保留 200 条消息，序列化体积目标上限为 1MB；图片按 data URL 存储，单张发送限制为 512KB，接收端也会校验图片 MIME、原始大小和 data URL 长度，支持 JPG、PNG、WebP。

聊天输入支持从剪贴板粘贴 JPG、PNG、WebP 图片，粘贴图片会复用上传图片的大小和类型校验。聊天消息图片和待发送图片可单击打开大图预览，支持点击遮罩、关闭按钮或 `Esc` 关闭。桌面端聊天框可通过顶部标题栏拖动换位置，位置保存到 `serverlessVideoChat:chatPanelPosition:v1`；移动端仍使用底部面板布局，不套用桌面拖拽位置。

## 组件职责

- `src/components/Button.tsx`：基础按钮
- `src/components/Input.tsx`：基础输入框
- `src/components/SettingsMenu.tsx`：画质和视频填充模式菜单
- `src/components/ClickHeart.tsx`：全局双击爱心动画层
- `src/components/ChatPanel.tsx`：通话页图文聊天覆盖层，包含本地历史、图片预览、加密状态和发送输入
- `src/components/NetworkDiagnosticsPanel.tsx`：通话页左上角连接状态和网络环境诊断面板，运行 ICE candidate 采集并展示穿透等级估算
- `src/stores/chatStore.ts`：聊天会话、草稿、未读数、发送状态和 localStorage 持久化
- `src/lib/chatCrypto.ts`：聊天应用层 ECDH + AES-GCM 加密
- `src/lib/chatProtocol.ts`：聊天 wire payload 转换和校验
- `src/lib/chatStorage.ts`：聊天记录本地存储、会话 ID、历史裁剪
- `src/lib/chatAttachments.ts`：聊天图片 MIME 白名单和剪贴板图片提取
- `src/lib/chatPanelPosition.ts`：桌面聊天框位置裁剪和本地持久化
- `src/lib/networkDiagnostics.ts`：WebRTC ICE candidate 解析、无 STUN / 多 STUN 探测和 TURN 需求风险汇总

## 部署边界

`vite.config.ts` 中默认 `base` 为 `/`，服务于 Cloudflare Pages 和自定义域根路径部署。

GitHub Pages 需要仓库子路径时，不依赖默认生产构建，而是通过 `npm run build:github` / `vite build --base=/ServerlessVideoChat/` 显式生成。

静态托管兜底：

- Cloudflare Pages：`public/_redirects`
- GitHub Pages：`public/404.html`

Cloudflare Pages 项目：

- Project name：`serverlessvideochat`
- Pages preview domain：`serverlessvideochat.pages.dev`
- Custom domain：`chat.uavserver.cn`

当前构建配置不再启用 `vite-plugin-trae-solo-badge`，生产页面不应再显示右下角 Trae Solo 标识。

2026-06-22 通过本地未跟踪 `.env.local` 注入 `VITE_TURN_URLS`、`VITE_TURN_USERNAME`、`VITE_TURN_CREDENTIAL` 后重新构建并部署到 Cloudflare Pages。Cloudflare Pages 项目 API 中 production / preview 环境变量仍为空；如果改为 Cloudflare 自动构建，需要在 Pages 环境变量中补齐 TURN 配置，否则自动构建产物不会包含 TURN。

如果仓库名、Pages 子路径、自定义域根路径或部署平台变化，必须同步检查：

- `vite.config.ts`
- `public/404.html`
- `public/_redirects`
- `README.md`
- 本文档

## 当前质量状态

最近一次功能验证结果（2026-06-22）：

- `npm test -- --run`：通过
- `npm run check`：通过
- `npm run build`：通过
- `npm run lint`：通过
- `git diff --check`：通过
- 系统 Edge + fake camera/mic 交互检查：通话页聊天按钮、剪贴板图片粘贴、图片放大/Esc 关闭、桌面拖动通过
- 拖动后聊天框高度回归检查：拖动后外框高度保持 464px，追加大量内容后仍保持 464px，消息列表 `overflow-y: auto`
- 连接失败状态检查：当 `PC: failed` 或 ICE failed/closed 时，状态不再显示绿色 Connected；远端 track 存在但传输失败时提示 TURN 中继要求
- 网络环境诊断单元测试：覆盖 ICE candidate 解析、仅 host 候选、稳定 srflx 映射、srflx 端口漂移和 TURN 风险估算
- `npx --yes wrangler pages deploy dist --project-name serverlessvideochat --branch main`：通过，部署地址 `https://b0b8cd1e.serverlessvideochat.pages.dev`
- `https://b0b8cd1e.serverlessvideochat.pages.dev`：HTTP 200，加载 `/assets/index-CoTtNvtq.js` / `/assets/index-Da96yU29.css`
- `https://chat.uavserver.cn`：HTTP 200，加载同一套 `/assets/index-CoTtNvtq.js` / `/assets/index-Da96yU29.css`，未发现 `/ServerlessVideoChat/` 错误资源路径
- Playwright 打开 `https://chat.uavserver.cn`：首页 DOM 正常渲染；自动化浏览器未授权摄像头时显示“摄像头访问被拒绝”业务提示，不再白屏
- `https://chat.uavserver.cn` 已部署包含阿里云 TURN 配置的 `assets/index-B213MKBd.js`；公网 TCP 3478 可达，浏览器 TURN relay candidate 采集通过

当前测试重点覆盖聊天本地存储裁剪、聊天 wire payload 校验、ECDH + AES-GCM 加密往返、剪贴板图片提取、聊天框位置裁剪/持久化，以及 WebRTC failed 状态下的连接状态派生。

## 已知不一致和风险

- `package.json` 项目名仍是 `trae-project`，与仓库/README 名称不一致。
- `index.html` 标题仍是 `My Trae Project`，与项目名称不一致。
- `SettingsMenu` 和部分按钮 title 仍是英文，整体 UI 文案未完全统一。
- `CallPage` 左上角诊断信息常驻，偏调试 UI。
- 通话页本地 PIP 在摄像头关闭时没有像首页一样显示 `VideoOff` 占位。
- DataConnection 没有 close/error/reconnect 状态处理，爱心和画质同步可能静默失效。
- 如果重新构建时没有注入有效 TURN，复杂 NAT 下会出现 PeerJS signaling 已收到 stream track、但 `RTCPeerConnection` 失败导致无视频帧和无 DataChannel 的情况。
- 左上角网络环境诊断基于浏览器 ICE candidate 做启发式估算，不能精确读取真实 NAT 层数；“无需 STUN”只适合同局域网或公网可路由主机场景，跨网络仍建议至少保留 STUN。
- 聊天图片通过同一条 DataConnection 发送；虽然有 512KB 限制，但弱网或连续图片仍可能延迟 HEART/QUALITY_CHANGE 这类控制消息。
- 聊天本地历史存储在浏览器 localStorage 中，不是跨设备同步，也不是本地加密数据库。
- 剪贴板截图通常体积较大，超过 512KB 时会提示失败；当前没有做客户端压缩。
- 桌面聊天框位置是本机浏览器偏好，换设备或清理站点数据后不会保留。
- TURN 相关 `VITE_*` 变量会进入前端构建产物，不能当作服务端秘密，只能作为客户端可见凭证管理。

## 维护要求

后续任何改动如果影响以下内容，必须同步更新本文档：

- 技术栈、依赖、脚本命令
- 路由、页面职责、主要用户流程
- WebRTC、PeerJS、STUN/TURN、DataConnection 行为
- 媒体采集、track 替换、cleanup 逻辑
- 部署平台、base path、SPA fallback
- 验证命令和当前质量状态
- 已知风险、限制或调试说明

如果只做纯样式微调，也至少检查本文档是否有 UI 说明需要同步。
