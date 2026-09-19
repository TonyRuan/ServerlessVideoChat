# 文件传输优化实测（2026-09-19）

本轮落地文件发送背压优化，解决本机测试中首轮传输因大量排队而出现的长停顿。极速模式 16 MiB 冷启动传输中位耗时由 7.5324 秒降至 2.0475 秒，减少 72.8%。持续吞吐仍约 8 MiB/s；这次修改没有解决浏览器原生线程的持续吞吐限制。

## 实际修改

- 新增 `src/lib/fileTransferBackpressure.ts`，在 `CallPage.tsx` 文件 bulk send 后调用。
- 浏览器发送缓冲区超过 256 KiB 时等待降至 128 KiB，由 `bufferedamountlow` 事件唤醒；250 ms 轮询仅兜底漏事件和失效任务。替换文件通道原先的 4 MiB 阈值、20 ms 轮询。
- 等待期间检查连接、传输代次及可选取消信号，结束时释放监听器和定时器，并协调同一通道上的阈值占用。
- 保留接收端确认的持久化偏移和断线续传机制。应用分块仍为 256 KiB，加密/极速模式的接收窗口分别为 1/8 MiB。
- 该水位控制的是浏览器队列，不能当作 PeerJS 内部序列化队列或总内存的硬上限；单次发送也可能越过水位。

本轮没有修改加密实现。极速模式跳过应用层 AES，WebRTC 自带的 DTLS 仍然存在。

## 测试口径与范围

Windows，Intel i7-12700，Edge 152.0.4191.66，Playwright Firefox 153.0。网站运行于本地 Vite 开发服务器。两个独立浏览器进程以真实 PeerJS/WebRTC 通信，关闭摄像头和麦克风；所有负载实验串行执行。

网站测试由真实 UI 发起/接受文件，测试夹具用 OPFS 的真实可写文件替代系统保存对话框。计时从接收端可写文件准备完成到关闭文件完成，包含传输、协议等待、解密和写入，不含人工操作及最终哈希计算。每次比较文件大小和 SHA-256，并等待发送端显示完成。它不等同于任意用户磁盘目录、所有文件系统或发布构建的性能。

旧配置通过测试路由仅将新的 bulk 等待调用替换为旧等待器，其余使用同一份当前应用代码；这不是与较早版本整个应用的比较。双方均断言模块埋点加载且新旧配置匹配。直连测试确认 host 候选；强制 TURN 测试另外确认文件通道选中 relay。

## 网站结果

| 场景 | 旧配置 | 新配置 | 样本与结论 |
| --- | --- | --- | --- |
| 极速，16 MiB，新连接首次传输 | 7.5324 s；2.1242 MiB/s | 2.0475 s；7.8144 MiB/s | 各 3 次中位数；耗时减少 72.8%，吞吐约 3.68 倍 |
| 加密，64 MiB，先传 8 MiB 预热 | 7.7714 MiB/s | 7.9167 MiB/s | 各 1 次正式传输，未观察到明显退化 |
| 极速，64 MiB，先传 8 MiB 预热 | 7.6728 MiB/s | 7.7375 MiB/s | 各 1 次正式传输，持续吞吐没有大幅提高 |
| 加密，8 MiB，强制 TURN | 中位 0.5666 MiB/s，范围 0.5274–0.7010 | 中位 0.6391 MiB/s，范围 0.5681–0.8934 | 各 3 次，波动大且范围重叠，不能认定稳定提速 |

冷启动旧配置三次耗时为 6.2565、7.5324、9.1218 秒；新配置为 2.0475、2.0837、1.9944 秒。顺序为旧1、新1、新2、旧2、旧3、新3；每次重启浏览器和连接，使用同一个文件。72.8% 仅是这一实验的耗时下降比例，不是所有文件、网络或瓶颈的占比。

64 MiB 结果只适合排查明显回退，样本不足以证明几个百分点的差异。两种模式的旧/新对照各使用相同文件，但加密与极速之间使用不同随机文件。TURN 结果受公网条件影响，本机直连提速比例不能外推到中转。

加密与极速分别做了 16 MiB 断线恢复：接收端写入约 1 MiB 后主动关闭发送端文件 `RTCPeerConnection`，均自动重建通道、继续传输并通过最终哈希校验，总耗时分别为 3.1919、3.2271 秒。该测试覆盖文件通道关闭，没有模拟整机断网或浏览器重启。

以上共 22 次网站传输（含 4 次预热），全部通过文件校验和发送端完成状态检查，无捕获到的页面错误。

## 原生传输实验：持续吞吐仍值得调查

以下为移除 PeerJS、应用加密和磁盘写入的原生可靠有序 DataChannel 实验，16 MiB 数据预先载入内存，16 KiB 消息，64 KiB 发送水位。它们不能直接作为网站完整流程的成绩。

| 发送端 → 接收端 | 吞吐 | 样本限制 |
| --- | --- | --- |
| Edge → Edge | 7.82 MiB/s | 1 次，开启原生 trace 和线程 CPU 采集，存在采集开销 |
| Firefox → Firefox | 19.44、20.25、23.92 MiB/s | 初次连续实验成功 2 次；另一次连接建立超时；重启浏览器补测成功 1 次 |
| Edge → Firefox | 8.18 MiB/s | 1 次 |
| Firefox → Edge | 8.48 MiB/s | 1 次 |

Firefox 另有 4 MiB 水位的 3 次成功实验，速度为 14.43、16.31、19.23 MiB/s。全部成功的原生实验通过文件哈希校验；一次连接建立 45 秒超时单独记录，不能隐去或计为成功样本。

本轮 Edge trace 对应 2.0464 秒传输，其两个高 CPU 的 WebRTC 线程分别消耗约 2.000、1.953 CPU 秒。结合跨浏览器结果，支持当前机器上的 Edge 原生路径存在计算吞吐限制；尚不能归因到 SCTP、DTLS、校验和或内存复制中的某个具体函数，更不是所有 Chromium 版本的固定 8 MiB/s 上限。

本轮尝试启用 CDP native CPU profiler，但导出的 trace JSON 没有可用的 native 调用栈。不能用显式 SendPacket 等埋点耗时冒充完整 CPU 热点占比，也不能凭 JSON 缺样本认定目标线程一定未被采样。Windows ETW 采样所需的系统 profiling 权限当前不可用；没有启动、停止或干扰既有系统追踪会话。

Firefox 尚未做网站完整大文件保存、恢复和兼容性验证，应用现有保存方式支持差异也需处理。因此目前保留为后续方向，不据此切换产品默认浏览器或重写传输架构。

## 验证与原始记录

本轮新增 14 项背压 helper 测试及 2 项发送泵/背压集成测试，覆盖漏事件、关闭/错误、取消、并发等待、代次失效、资源释放，以及按接收端持久化偏移重发或跳过首块。

- `npm test`：43 个文件、300 项测试全部通过。
- `npm run check`、`npm run lint`、`npm run build`：全部通过。
- 构建版本保持 0.0.14；构建仅提示 Browserslist 数据较旧，不影响通过。
- `git diff --check`：通过。

原始记录位于本地忽略目录 `output/playwright/`，不包含凭据，也不随 Git 自动交付：

- `roi-verified-{legacy,production}-fast-cold-{1,2,3}.json`：有效冷启动对照。
- `roi-warm-{legacy,production}-{encrypted-1M,fast-8M}.json`：预热和持续传输。
- `roi-turn-legacy-encrypted-{1,2,3}.json`、`roi-turn-production-encrypted.json`、`roi-turn-production-encrypted-{2,3}.json`：TURN。
- `roi-recovery-{encrypted,fast}.json`：断线恢复。
- `roi-firefox-native.json`、`roi-firefox-native-recheck.json`、`roi-mixed-{edge-firefox,firefox-edge}.json`：跨浏览器隔离实验。
- `roi-cpu-sampling.json`、`roi-cpu-trace-native16-smallbuffer-{0,1}.json`：线程 CPU 和 trace。
- `two-window-transfer.cjs`、`run-transport-lab.cjs`、`transport-lab.js`：本机测试夹具，使用本机 Playwright 路径。

曾有 6 份初始新旧对照因 Vite 热更新 URL 查询参数导致路由埋点未命中，已全部排除；清单为 `roi-excluded-results.json`。修正匹配并增加运行时断言后重新完成了上述正式对照，不使用那 6 份记录支持任何结论。

复测需先启动本地 Vite，串行运行夹具，避免其他 CPU 密集任务。网站对照使用 `BENCH_MATRIX=1`、`BENCH_MIB=16`、`BENCH_CASE=fast-8M`；旧配置额外设 `BENCH_LEGACY=1`，新配置移除它。第二次起设 `BENCH_REUSE=1` 复用同一文件，并以 `BENCH_OUTPUT` 保存不同结果。预热设 `BENCH_WARM=1`；TURN 设 `BENCH_TURN=force`；断线设 `BENCH_INTERRUPT=1`。各实验必须清除前一实验不再适用的环境变量。

本轮仅修改和验证本地网站。尚未进行两台物理设备的跨网实测、Android APK 验证或线上部署。后续优先在目标设备上复测；若继续定位原生热点，需要可用的 native 栈采样格式及符号，不能从现有等待时间编造各瓶颈占比。
