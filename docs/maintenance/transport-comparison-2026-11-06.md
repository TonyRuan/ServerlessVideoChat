# WebRTC、WebTransport、MoQ、原生 QUIC 对照实测

日期：2026-11-06。测试发生在同一台 Windows 电脑，不是公网、两台物理设备、Android 或线上网站的测速。未修改或部署产品传输逻辑。

## 结论

本机 Edge 的 WebRTC DataChannel 仍约 8 MiB/s；WebTransport 和 MoQ 的浏览器到本机中转再到另一浏览器路径约 58–60 MiB/s；原生 quic-go 单跳约 101–103 MiB/s。替换传输实现确实能绕开本机现有的 DataChannel 吞吐限制，但不能由此承诺公网网站提速相同倍数。

MoQ 与直接使用 WebTransport 的结果区间重叠，未显示额外吞吐收益。两者中转实现、缓存策略不同，不能将两者差值解释为 MoQ 协议开销。若继续网页版原型，优先 WebTransport 可靠流；原生 QUIC 保留为客户端方向。

## 环境和计时

- Windows 11 Pro 10.0.26200 x64，Intel Core i7-12700，12 核、20 线程。
- 浏览器为当前 Edge 155.0.4283.45，Playwright 1.62.1；每个浏览器场景有两个独立、可见的浏览器进程，没有相机或麦克风访问。
- WebRTC：原生可靠有序 DataChannel，无 PeerJS；16 KiB 消息，发送队列高/低水位 256/128 KiB，事件唤醒，250 ms 检查兜底。每次确认双方选择 host 候选。
- WebTransport：浏览器 HTTP/3 WebTransport，两段 localhost 连接；Go 1.27.3、quic-go 0.62.0、webtransport-go 0.13.0 中转。64 KiB 应用写入，等待 writer.write；中转使用 256 KiB 拷贝缓冲，保留 QUIC 流控。
- MoQ：官方 Windows moq-relay 0.17.13、@moq/net 0.4.7；实际协商 moq-transport-22 over WebTransport，禁用 WebSocket 回退。512 个 64 KiB frame，单个 32 MiB group，缓存 maxAge 120 秒；反向 MoQ track 传完成 ACK。
- 原生 QUIC：独立发送和接收进程，quic-go 0.62.0，一跳 127.0.0.1；64 KiB 写入。不是 iroh，没有测试打洞或 NAT 穿透。
- 所有吞吐测试串行进行，没有并发测速或编译负载；正常桌面后台应用未强制关闭。
- 32 MiB 文件由随机数据生成，所有方案使用同一份内容。128 MiB 文件由该 32 MiB 文件重复四次组成；测试协议没有启用内容压缩。
- 来源先加载至内存，连接、订阅和接收缓冲准备完成后才开始计时。起点为发送文件字节，终点为发送端收到接收完成 ACK；不能用发送队列排空代替接收完成。
- 每轮完整接收后验证字节数和 SHA-256；哈希不计入传输计时。MoQ 在发送端收到 ACK 后再显式计算哈希；WebTransport/native 在发送完成标志后返回哈希。磁盘测试计时包含 OPFS 写入及 close。
- WebRTC/WebTransport 在同一对进程内交替顺序：RTC/WT、WT/RTC、RTC/WT……，每次建立新连接；MoQ 每轮使用新浏览器进程，另行串行运行。原生 QUIC 每轮使用新客户端进程和连接。不是随机化、同一服务端实现的协议隔离实验。
- 均保留传输层加密。没有额外应用层 AES；WT/MoQ 中转能访问明文文件数据，与 WebRTC 直连的信任边界不同。生产接入应保留项目的应用层端到端加密。

## 32 MiB 内存传输，正式各 5 轮

| 实现及路径 | 吞吐中位数 MiB/s | 最小–最大 MiB/s | 耗时中位数 | 完整性 |
| --- | ---: | ---: | ---: | --- |
| WebRTC，浏览器直连 | 7.91 | 7.68–8.07 | 4.044 s | 5/5 通过 |
| WebTransport，浏览器→Go 中转→浏览器 | 57.56 | 53.23–64.83 | 0.556 s | 5/5 通过 |
| MoQ，浏览器→Rust 中转→浏览器 | 58.29 | 54.49–60.28 | 0.549 s | 5/5 通过 |
| 原生 quic-go，进程直连 | 101.24 | 99.80–103.82 | 0.316 s | 5/5 通过 |

本机这组架构对照中，WT/RTC 吞吐中位数比约 7.27；MoQ/RTC 约 7.37；原生 QUIC/RTC 约 12.79。这是测试结果比值，不是对真实网络的提速承诺，也不是各瓶颈占比。

## 128 MiB 内存复测，正式各 3 轮

| 实现 | 吞吐中位数 MiB/s | 最小–最大 MiB/s | 耗时中位数 | 完整性 |
| --- | ---: | ---: | ---: | --- |
| WebRTC | 8.05 | 7.98–8.05 | 15.904 s | 3/3 通过 |
| WebTransport | 59.68 | 59.15–60.43 | 2.145 s | 3/3 通过 |
| 原生 quic-go | 102.73 | 102.42–103.23 | 1.246 s | 3/3 通过 |

扩大文件后差距仍然存在。没有将单次不足一秒的 32 MiB 数字当成全部持续吞吐证据。MoQ 当前夹具采用库的单 group 32 MiB 缓存上限，未修改第三方库来运行 128 MiB，也未验证多 group 大文件流程。

## 32 MiB 接收写 OPFS，正式各 3 轮

| 实现 | 吞吐中位数 MiB/s | 最小–最大 MiB/s | 完整性 |
| --- | ---: | ---: | --- |
| WebRTC | 7.76 | 7.65–7.78 | 3/3 通过 |
| WebTransport | 57.32 | 54.76–58.38 | 3/3 通过 |

两者用相同 256 KiB 写入批次。接收文件 close 后发送完成 ACK，再重新读取文件校验。OPFS 结果不能等同于用户选定目录、任意磁盘或断电持久性。

这个独立 RTC 夹具没有生产协议的接收信用窗口，慢磁盘下 JS 接收队列可能积累大量字节；因此这组结果只是原型落盘成本检查，不能证明生产端有界内存、续传或背压已经解决。MoQ 本轮为完整 group 缓存的内存原型，没有测磁盘。

## 完整性、失败与限制

正式共 35 次文件传输，35 次均完成并通过字节数与 SHA-256 校验。

- 32 MiB SHA-256：`fe0f06d8221eb9aa576ab740e22c4a860c83900e8f7b6f1e247c47fe8c998279`。
- 128 MiB SHA-256：`39e1f3edfd32d5c369b48e13334afa2b7a610fc520fdf8a140786343035d1e0c`。
- 正式样本前做了独立烟测，未混入上述统计。MoQ 准备阶段曾发生一次连接 `ERR_NO_BUFFER_SPACE`，没有进入文件发送阶段；用新进程重试后成功，正式 5 轮无失败。原因未定位，不能据此宣称稳定性已全面验证。
- 本机中转没有公网带宽、RTT、丢包、运营商、跨 NAT 等成本。真实链路速度还受到发送上行、接收下行及中转带宽限制。
- 原生 QUIC 是一跳、浏览器中转是两跳；原生程序与浏览器的运行时和拷贝成本不同。因此这是候选架构的对比，不是只有协议一个变量的实验。
- MoQ 全文件缓存，与 WT 流式转发的内存策略不同；MoQ 与 WT 中转分别为 Rust 和 Go 实现。不能说 MoQ 比 WT 快/慢固定百分比。
- 没有测试 APK、两台实体设备、真实公网或生产页面；没有产品级断线续传、鉴权、完整大文件生命周期测试。
- 浏览器原始 cpuSeconds 包含哈希与测试控制调用，不可除以纯传输耗时计算核心占用。本轮没有做原生栈热点定位。
- 不将此结果描述为所有 Edge/Chromium 的固定 8 MiB/s 上限。

## 复现文件

原始数据与源码保存在本地忽略目录，不含用户文件、生产凭据或 TURN 配置：

- `output/playwright/transport-compare/bench.html`、`bench.js`、`run.cjs`：RTC/WT 独立夹具。
- `output/playwright/transport-compare/browser-memory.json`：32 MiB 内存，10 次。
- `output/playwright/transport-compare/browser-disk.json`：32 MiB OPFS，6 次。
- `output/playwright/transport-compare/browser128-memory.json`：128 MiB 内存，6 次。
- `output/playwright/transport-compare/quic/main.go`、`go.mod`、`go.sum`、`README.md`：WT relay 与 native QUIC 程序。
- `output/playwright/transport-compare/quic/native-results.json`、`native128-results.json`：原生 QUIC，5+3 次。
- `output/playwright/moq-compare/moq32.json`：MoQ，5 次。
- `output/playwright/moq-compare/bench.js`、`run.cjs`、`package-lock.json`、`relay.toml`、`README.md`：MoQ 夹具、锁定依赖、启动与限制说明。官方 Windows relay 下载已核对发布 SHA256SUMS。
- `output/playwright/transport-compare/summary.json`：统一校验和统计。

测试服务器只绑定 localhost。测试证书为本地生成、短有效期证书，不应提交私钥。Playwright 引用本机已有依赖路径，异机复现需要调整该路径。重跑前按各 README 启动中转与接收端，检查证书有效期，不要将这种本地测试服务作为生产部署。

## 下一步决策

网页版：先做 WebTransport 可靠流中转的可选通道，并在两台设备及同等中转网络条件下做对照，保留 WebRTC 回退、应用层加密、信用窗口、落盘与续传。无需为一对一文件提速先引入 MoQ。

原生客户端：单独验证原生 QUIC/iroh 在目标 Android/桌面设备上的文件读写、CPU、能耗、打洞和中转路径，再决定产品集成。本轮没有修改线上版本。
