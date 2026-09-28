# 同桌模式

Web/PWA、SwiftUI iOS 和 Compose Android 共用 protocol 1。登录后，在公开汤或每日官汤页选「邀朋友同桌」；朋友通过网站邀请链接或在原生 App 粘贴邀请码入座。第一版没有公开大厅、随机匹配、语音或旁观席。

## 玩法与档案

手机网页和原生 App 使用连续会话布局：问题、砚的回答和桌内讨论按时间排列；底部「问砚 / 和大家聊」只切换发送对象，两份草稿分别保留。汤面和成员管理按需打开面板，等待入座的邀请卡片随会话滚动。等待时默认聊天，开汤后可向砚提问。

宽度达到 1024px 的网页采用三栏布局：左侧案卷和成员，中间正式问答，右侧桌内讨论，各自滚动。问答和讨论各有输入框；切换窗口大小保留草稿和同一条连接。布局合并不改变协议，讨论仍然不会送给主持模型。

- 一桌 2–6 人，房主在至少两人在线时开始；中途有空位可以加入并查看已有记录。
- 每人最多一个待回答问题，砚依次处理；可引用前一问题，未开始处理的问题可以撤回。桌内讨论独立保存，不送给 Jev，也不计提问轮数。
- 主动揭晓需当时在座成员全票同意，发起者自动同意。60 秒内有拒绝、超时或成员变化即取消，投票期间暂停提问。正在回答时等回答结束再开票。文字索要答案同样走投票。
- 当天官汤不能主动揭晓；成功解开仍可结案，显示汤底及完整故事。
- 断线保留座位两分钟，超时离座；房主离开后由最早入座的在线成员接任。少于两席暂停问题队列，24 小时没有操作则中止并保留档案。
- 「我的同桌」与单人案卷分开。正常离座可继续读案卷，有空位且未结束时可回来；关闭邀请只拦新成员。被移出的账号不能重入，列表与记录冻结在移出时刻，不能读取后续问答、成员变化或答案。
- 同桌最短/最长轮数仅统计成功解开的房间，作者曾参与过就整桌排除；单人统计不变。全票主动揭晓仅将同意的非作者按现有账号哈希去重计数。

## 服务端与恢复

`worker/entry.ts` 导出 HTTP Worker、`SoupRoom`、`RoomLimit`。每个房间用一个 SQLite Durable Object 保存权威状态、事件、队列、单次票据、操作确认和 D1 待写记录。公开索引、团队记录及管理员提问日志投影到 D1。

客户端先持久化 `commandId`，再发送命令，收到 ACK 后清除；断线和应用重启后重发同一 ID。服务端按 `(uid, commandId)` 去重并校验内容，先落库再广播；客户端按事件序号合并历史。三端在重放前核对服务端房间和账号身份。超过十分钟的本机待确认操作不再自动重发，避免很久以后意外执行。

模型调用只接受服务端冻结题目、完整原始故事、提问者和最近十个正式问题及被引用的问题。正式问题不包括桌内讨论，也不沿用客户端提供的裁判回答。每次判读持久化 50 秒租约，失效或进程丢失后只允许显式重试；旧调用迟到不能提交。房间调用关闭 SDK 隐式重试。D1 不可用时保留待写项，由 alarm 重试，不重新询问 Jev。

使用 Cloudflare WebSocket Hibernation API 和自动 ping/pong；活跃模型 I/O 结束后可休眠，不需要常驻计时器。API参考：[WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)。测试包含真实 workerd/SQLite/WebSocket 和模拟进程丢失后的恢复；没有以运行单元测试代替线上负载测量。

## 权限与输入边界

- HTTP 及 WebSocket 都读取服务端登录会话；每个操作和广播重新检查会话与成员身份。HTTP 不信任传入的 UID、题目答案、权限或房间状态。
- 浏览器校验 Origin/Fetch Metadata；写接口只收 JSON 与 `X-Room-Protocol: 1`。原生无 Origin，仍需登录会话。所有 API 响应 `no-store`，PWA 不缓存 API。
- 30 秒一次性 WebSocket 票据绑定账号与会话，用子协议传递，不放 URL；握手原子消费。邀请页无 Referrer 并禁止索引；邀请仅支持本站 canonical HTTPS 地址或 12 位随机码，客户端不会请求粘贴的任意 URL。
- 输入帧/请求体最多 8 KiB，提问/讨论最多 600 个 UTF-16 单元；每桌最多 600 轮、10,000 条讨论、100 名历史成员。
- 每账号开桌 5/小时、20/日；入桌 10/分钟；HTTP 120/分钟；Jev 120/小时（跨房间）。每桌每账号每 10 秒最多 30 帧，其中讨论最多 5 次、其他操作最多 10 次。最多三个同账号连接、每桌最多 24 个连接。
- 对外 snapshot 明确挑选字段，结案前不含汤底、故事、提示或模型调试内容。异常只返回受控错误文案。
- 登录会话沿用项目 KV 会话存储及其一致性语义。邀请链接持有者仍需登录且通过成员/容量检查；邀请关闭不会踢出现有成员。

## 数据库与发布

1. 先查 `PRAGMA table_info(turn_logs)` 和 `sqlite_master`。从 0.35.13 升级只执行一次 `db/migrations/020-rooms.sql`；新库直接执行 `db/schema.sql`，不要重放 ALTER。
2. 首次部署带 `ROOMS`/`ROOM_LIMITS` 绑定、`rooms-v1` SQLite 类迁移和 `ROOMS_ENABLED=0`，验证 D1 列、静态资源与现有接口。
3. 检查通过再设 `ROOMS_ENABLED=1`。应急置 `0` 可停止开新桌，已有桌与案卷继续工作。保留绑定、迁移和 D1 新列；不要为了关闭入口删除持久化数据。
4. 原生测试包使用同一生产 API。iOS 签名配置仍只在本机，Android 调试包采用调试签名。正式商店签名另行配置。

## 可复现检查

```sh
npm test
npm run lint
npm run build
npm run ios:test
npm run ios:build
npm run android:build
# 另开终端：隔离假账号/本地 D1/KV/假主持，不访问线上数据库或模型
npm run rooms:preview
npx playwright install chromium
npm run rooms:test:web
# 或 CHROME_PATH=/path/to/chrome npm run rooms:test:web
npm run rooms:test:ios     # URLSession 双客户端真实协议检查
npm run rooms:test:ios-ui  # 先启动 iPhone simulator，可用 IOS_SIMULATOR_ID 选设备
# 已连接 Android emulator，先构建测试 APK：
cd android && ./gradlew assembleDebugAndroidTest
# 回仓库根目录；可用 ADB=/path/to/adb 指定命令
npm run rooms:test:android
```

Release 构建没有本地测试来源覆盖；Android 仅 Debug 允许显式注入固定的 `127.0.0.1:8799`，明文例外也只在 Debug、只允许 loopback。

`.build/rooms/` 保存本地测试会话、截图和日志，不进入版本库。测试脚本不生成生产会话、不放宽生产接口。
