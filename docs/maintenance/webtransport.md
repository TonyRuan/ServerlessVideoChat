# 实验闪电模式（WebTransport）

网页版和支持 WebTransport 的安卓版提供第三种文件模式 `lightning`，界面名称为“实验闪电模式”。默认仍为加密模式；现有极速模式不变。闪电模式经独立 HTTP/3 WebTransport 中转转发 AES-GCM 密文，服务器不落盘保存文件，也没有浏览器聊天会话的解密密钥。音视频、文字、文件邀请、接受、信用窗口、完成确认和错误仍走现有 WebRTC 通道。

## 可用性与兼容性

- 必须配置 `VITE_WEBTRANSPORT_URL=https://<relay-host>/file`，使用安全上下文且浏览器提供 WebTransport。
- 网页版和 Android 按运行时能力开放；Android WebView 缺少 WebTransport 时提示更新系统 WebView。其他 Capacitor 原生平台暂不宣告闪电能力。
- 控件显示本地不可用原因或对方不支持的原因；发送时再次校验。配置了地址不代表服务一定在线，连接失败会显示错误。
- 先发送旧版两模式能力消息，再给支持扩展的新客户端发送三模式能力消息，保留旧版兼容性。
- 闪电 offer 使用 version 3，显式 `mode: lightning` 和 256-bit 随机 `lightningRoom`。接收与发送必须同意相同模式。房间凭据只在加密控制消息和 WT 握手中发送，不进入 URL、聊天历史或服务日志。
- 旧版客户端拒绝未知 offer 版本；新版不应向未宣告闪电能力的客户端发起闪电邀请。
- 文件 URL 来自本地构建配置，不能被对端消息指定。双方必须配置同一中转服务。

## 传输与生命周期

`src/lib/webTransportFile.ts` 为每个文件创建一个 WebTransport session 和可靠双向流。握手为 4 字节大端长度与 JSON `{version:1,room,role}`，配对成功后读取字节 82。发送端的数据帧是 4 字节长度、12 字节 IV 和 AES-GCM 密文；最大帧受限。接收按帧读取并等待当前解密与落盘完成，避免全文件缓存在 JS 内存。

文件仍用 256 KiB 应用分块，闪电模式的接收信用窗口为 8 MiB。信用只在数据写入后发布；发送泵等待可靠流背压，读取文件与加密也受信用窗口约束。接收端检查认证后的发送者、传输 ID、偏移和分块长度；拒绝明文闪电帧及跨 WebRTC/WT 的模式混用。磁盘保存关闭完成后才发送最终完成确认，发送到 100% 不等同于接收成功。

实验模式暂不自动续传，也不静默降级。WT 建连/配对约 20 秒超时，流读写约 30 秒超时；发送端信用或完成确认长期无进展约 45 秒后失败。控制连接重置、挂断、页面卸载、拒绝和错误会清理关联任务与流，失效异步回调不得覆盖失败状态。正常 WebRTC 模式继续使用原有重连续传策略。闪电失败后用户可重新发送，或选择原有模式。

文件大小与保存能力限制沿用原有策略：文件最大 2 GiB，网页支持文件选择器时流式保存；无直接磁盘保存能力的网页保留 10 MiB 内存限制。Android 使用已有原生 Filesystem 分块写入 Documents/SVC，不受该网页内存回退上限约束。

## 部署与本地验证

`relay/webtransport/` 包含 Go 服务、锁定依赖、测试、环境模板和 systemd 模板。Cloudflare Pages 继续承载 SPA；Pages Function 不承担 HTTP/3 UDP 文件中转。服务需要独立可达的 UDP 监听、有效 TLS 证书和精确 Origin 白名单。具体步骤见该目录 README，现有 TCP 443 服务和 TURN 配置不应因本功能被改动。

没有设置 `VITE_WEBTRANSPORT_URL` 的构建会显示“闪电中转服务尚未配置”，不会误用演示地址。生产构建只使用正常证书校验。

本地开发可在进程环境中设置 `VITE_WEBTRANSPORT_CERT_SHA256`，仅 DEV 且中转为 localhost 时允许短期 ECDSA 证书指纹。不要将本地证书私钥或生产密钥提交 Git。每次测试结束关闭测试服务。

## 验证重点

- 三种模式的 offer/accept/capability、非法房间、明文与跨通道降级拒绝。
- 分片拆分/合并、超大帧、截断、取消、超时及资源释放。
- 真实双浏览器从选择模式、发送、接受到保存，校验文件 SHA-256，并证明 WT 实际建立且 RTC bulk 未携带闪电文件字节。
- 中转不可达、传输中断、控制连接重置、保存对话框期间挂断不得永久卡住或假成功。
- 原有 encrypted/fast 模式回归；不支持的浏览器、未配置及旧对端保持清晰提示。

早期纯传输实验见 [transport-comparison-2026-11-06.md](transport-comparison-2026-11-06.md)；不能把 localhost 的倍率作为公网提速保证。

## 2026-11-06 本轮验证

- `npm test`：44 个文件、327 项通过；`npm run check`、`npm run lint`、`npm run build` 通过。构建版本 0.0.15。构建有既有 Browserslist 数据过期提示。
- Go 中转 `go test ./...`、`go vet ./...` 和编译通过。
- 两个独立 Edge 浏览器从实际页面发起 32 MiB 文件：lightning / encrypted / fast 三种模式均通过最终 SHA-256、发送端 sent 和接收端磁盘保存检查。OPFS 替代系统保存对话框，是真实写入，不代表所有用户磁盘目录。
- 闪电模式每端实际创建一个 WebTransport，RTC bulk 发送字节为 0。该轮含应用 AES 和 OPFS 的单次闪电传输约 50.67 MiB/s；仅是本机功能验证样本，不作为公网速度承诺。
- 不支持 WebTransport 时控件禁用并显示原因；真实传输中停止中转，双方进入失败状态，没有永久等待。无捕获到的页面运行时错误。
- 原始记录与夹具：本地忽略目录 `output/playwright/lightning-app-results.json`、`lightning-app.cjs`。截图为 `two-window-lightning-sender.png`、`two-window-lightning-receiver.png`。
- 公网中转已部署；两个 Edge WebTransport 会话使用正常 DNS 和公信 TLS 完成配对，1028 字节合法帧逐字节校验通过。
- 完整公网 UI 验收在 `https://serverlessvideochat.pages.dev` 通过：两个独立 Edge 窗口发送 8 MiB 随机文件，接收端 OPFS 保存关闭、SHA-256 和长度一致，发送端“已发送”、接收端“已保存到磁盘”。两端 WebTransport ready、URL 为生产 `/file`，RTC bulk 双向均 0 字节，无页面运行时错误。
- 接受到保存耗时 10.208 秒，包含连接建立、加密和 OPFS 写入；单次功能样本，不是公网 WebRTC 对比基准。生产主 JS 和 CallPage 资源与本地 dist 的 SHA-256 一致。原始记录：`output/playwright/lightning-public-results.json` 及 `lightning-public-*.png`。
- 本次公网 UI 使用已有本机 HTTP 代理访问页面，仅 `lightning.uavserver.cn` 绕过代理。自定义域名 `chat.uavserver.cn` 在本机网络下出现 document/JS 请求间歇超时，未完成该域名的完整文件验收；同一部署的 Pages 主域通过。没有修改系统代理、hosts 或绕过证书验证。`/api/turn-credentials` 仍为既有的 HTTP 503，静态 TURN fallback 保留。
- 本轮未构建或测试新版 APK。

## 公网运行配置（2026-11-06）

2026-11-07 Android `0.0.16`（versionCode 5）已在 API 35 / WebView 124 模拟器完成真实公网双向传输：网页向 Android 原生磁盘保存 16MiB、Android 经系统文件选择器向网页发送 8MiB，大小与 SHA-256 均一致；WT 真实建立、RTC bulk 零文件字节。接收部分文件后中断 WT，双方失败且原生临时文件删除。具体升级、兼容性和测试边界见 [android.md](android.md)。

- 中转地址：`https://lightning.uavserver.cn/file`。Cloudflare DNS-only A 记录指向 `39.108.122.44`，TTL 300；公网 UDP 443 已验证可达。不要开启普通 Cloudflare HTTP 代理。
- 独立服务：`svc-webtransport.service`，可执行文件 `/opt/svc-webtransport/svc-webtransport-relay`，配置 `/etc/svc-webtransport/relay.env`。允许 `https://chat.uavserver.cn`、`https://serverlessvideochat.pages.dev`；2026-11-07 为 Android 增加精确来源 `https://localhost`。随机 Pages 预览子域名不在白名单，Origin 不代表应用身份认证。
- TLS：Let's Encrypt 公信证书，初次有效期截至 2027-02-04。完整证书链和私钥保存在 `/etc/svc-webtransport/certs/`，权限 root:svc-webtransport 0640。ACME 私有状态位于 `/var/lib/svc-webtransport/acme`，不得提交或下载到公开构建产物。
- 续期：lego 5.6.0，`svc-webtransport-renew.timer` 每日两次检查；实际续期后安装 hook 重启中转。TCP 80 必须保持可达以完成 HTTP-01，验证时才临时监听；原 TCP 443 和 TURN 服务继续独立运行。
- 为消除 quic-go UDP 缓冲警告，`/etc/sysctl.d/90-svc-webtransport.conf` 设置 `net.core.rmem_max=7500000`、`net.core.wmem_max=7500000`，原值均为 212992。仅调整最大缓冲上限，未重启现有 DSH/coturn 服务。
- 本机默认代理路径下 Edge WebTransport 握手失败；隔离测试浏览器 `--no-proxy-server` 下通过。测试保留正常 DNS 和 TLS 校验，没有 hosts 映射或证书绕过。HTTP 页面可访问不代表代理支持 QUIC；使用闪电模式的网络必须允许到中转的直连 UDP。此次没有修改用户系统代理。

常用只读检查：

```sh
sudo systemctl status svc-webtransport.service --no-pager
sudo systemctl list-timers svc-webtransport-renew.timer
sudo openssl x509 -in /etc/svc-webtransport/certs/fullchain.pem -noout -subject -issuer -dates
sudo ss -ulnp 'sport = :443'
```

回滚仅停用新服务及续期 timer，并将前端恢复到上一部署；不改动既有 TURN 或 TCP 443 服务。若撤销 UDP 缓冲调优，移除上述独立 sysctl 文件并将两个值恢复为 212992。保留证书和 ACME 状态，避免意外丢失续期账户。
