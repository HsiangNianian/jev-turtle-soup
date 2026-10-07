# 部署与运维

[← 项目首页](../README.md) · [本地开发](development.md) · [同桌协议](rooms.md)

## Cloudflare 部署

[`wrangler.jsonc`](../wrangler.jsonc) 以 `worker/entry.ts` 为入口。Worker 处理 API 与页面分享元信息，其余请求交给 `dist/` 静态资源；SPA 使用 `single-page-application` 兜底。

### 自建实例

仓库配置中的资源 ID 和域名属于现有站点。部署自己的实例时：

1. 在自己的 Cloudflare 账号创建 D1 和 KV，把 `DB` 的数据库名称／ID、`AUTH_KV` 的 namespace ID 替换为自己的值，并设置自己的 Worker 名称。
2. 保留代码所使用的绑定名：`DB`、`AUTH_KV`、`ASSETS`、`ROOMS`、`ROOM_LIMITS`、`EMAIL`。同桌依赖 `SoupRoom`、`RoomLimit` 与 `rooms-v1` SQLite Durable Object 迁移。
3. 为生产登录邮件和作者周报配置自己的 Cloudflare Email Service 发件域名与 `MAIL_FROM`。发送能力使用 [Workers Email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)。
4. 按 [新库／旧库规则](development.md#数据库初始化与升级) 准备目标 D1。远程初始化或升级必须明确目标库并使用 `--remote`；新库执行 `db/schema.sql`，旧库只执行缺失迁移。
5. 配置生产 secrets。不要把本地 `AUTH_EXPOSE_CODE=1` 带入生产。
6. 如使用自己的域名，同步检查网站分享地址、邀请链接校验、`shared/digest.ts` 的周报站点地址，以及原生客户端的 API 地址。当前它们面向 `hgt.mmstudio.games`，并非所有地址都由一个环境变量控制。

```bash
npm run wrangler -- secret put AUTH_SECRET
npm run wrangler -- secret put TYPESAFE_API_KEY
npm run wrangler -- secret put DEEPSEEK_API_KEY
# 可使用 OPENAI_API_KEY 或 LLM_* 替代每日生成提供商
npm run wrangler -- secret put DAILY_ADMIN_TOKEN
```

模型密钥按实际提供商设置；生产 secrets 与本地 `.env` 分开管理。参考 [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

### 发布

```bash
npm test
npm run lint
npm run deploy:dry-run
# 确认当前账号、目标资源与验证结果后发布
npm run deploy
```

Dashboard 连接 Git 构建时：

| 设置           | 值                           |
| -------------- | ---------------------------- |
| Build command  | `npm run build`              |
| Deploy command | `npm run wrangler -- deploy` |

发布后核对部署所指向的提交，检查 `/api/health`、首页、题库、登录入口及受影响流程。数据库升级与 Worker 发布分开确认；同桌首次启用与关闭入口的边界见 [同桌部署](rooms.md#数据库与发布)。

## 三条定时任务

Cron 配置见 `wrangler.jsonc`，处理函数在 `worker/index.ts` 的 `scheduled`。三个分支按 `event.cron` 区分：

| Cron（UTC）    | 行为                                                  |
| -------------- | ----------------------------------------------------- |
| `0 */6 * * *`  | UTC 00:00 首次生成每日官汤；之后每 6 小时检查并补缺。 |
| `0 4 * * *`    | 清理过期日志与对局、补充题材评分、巡检可疑判读。      |
| `0 12 * * mon` | 每周一北京时间 20:00 发送作者周报。                   |

官汤不是每次访问临时生成。失败时先查该次 Cron 日志与后台记录，区分已发布、生成中和缺失，不要把重复触发当作正常补救。

判读巡检在 `shared/audit.ts` 中抽查近期可疑记录，盲判后将值得复核的差异写入 `judge_flags`；保留可追溯的记录，不以历史回答作为故事事实。

后台「作者周报」支持**预览、发送记录、手动发送和失败补发**，自动每周发送与手动入口并存。重复发送、失败与不确定结果的处理规则见 [作者周报](weekly-digest.md)。发布检查不需要触发实际群发。

## 主要接口

实际权限、方法与参数以 `worker/index.ts` 及对应模块为准。

| 接口                                          | 用途                                              |
| --------------------------------------------- | ------------------------------------------------- |
| `GET /api/health`                             | 返回 `ok`、Jev 是否已配置、生成模型提供商与名称。 |
| `POST /api/game/ask`、`POST /api/game/reveal` | 基础对局提问与揭晓。                              |
| `/api/library/puzzles[...]`                   | 题库查询、上传、提问、可见性与删除。              |
| `/api/auth/*`、`/api/me/*`、`/api/u/:handle`  | 邮箱登录、个人内容与作者主页。                    |
| `/api/me/saves`、`/api/me/saves/:id`          | 登录态存档列表、导入与单局增删改。                |
| `GET /api/daily`、`GET /api/daily/:date`      | 今日与往期官汤。当天未解开前不主动下发答案。      |
| `/api/rooms[...]`                             | 邀请、入座、房间与案卷；见 [同桌协议](rooms.md)。 |
| `/api/social/{profile\|puzzle}/:id`           | 点赞与留言板。                                    |
| `/api/social/comments/:id`                    | 留言删除及举报。                                  |
| `POST /api/daily/generate`                    | 手动生成当天官汤，需 `x-admin-token`。            |
| `GET /api/audit/flags`、`POST /api/audit/run` | 查看巡检标记、触发维护，需 `x-admin-token`。      |

管理口令取 `DAILY_ADMIN_TOKEN`，未设置时回退 `AUTH_SECRET`。不要将管理密钥写入客户端或公开示例。

## 社群与内容

编辑在后台「题库精选」为公开原创汤填写不剧透的推荐语后，作品进入网站与 App 精选区；后台「社群观察」展示来源、第一问、第二碗、外部留言、跨周投稿等指标。

作者主页与题目共用点赞、留言系统。点赞按登录账号或匿名设备标识去重，留言需要登录；留言作者和对象主人可删除，其他用户可举报。私密主页和未公开题目不参与公开互动。

服务端保存故事与答案，并在提问和揭晓时校验权限；客户端未获揭晓权限时不能取得答案。当天官汤、同桌投票、填空答案等入口各自执行对应规则，不能用某一端的隐藏 UI 代替服务端权限。

## 云存档恢复与边界

本机 `turtle-soup.archive.v2` 将游客、各账号的进度和待同步操作放在独立空间中，
以一次 localStorage 写入同时保存。旧 `turtle-soup.archive.v1` 只迁移一次：
有缓存账号时归入该账号，否则归游客，原 key 保留为备份。写入失败不标记迁移成功。
游客记录归首次登录账号；目标空间和源清除原子保存，后续账号不会重复导入。

缓存账号只用于离线显示；服务端认证成功后才上传。登录导入走逐条 PUT，
500ms 合并频繁保存，同账号串行发送。失败操作和删除标记在刷新后仍保留；
网络错误、429、5xx 按 1/2/4/8/16/30 秒重试，之后最多间隔 30 秒，联网或页面重新可见时可提前重试。
401/账号不匹配暂停等待认证，其他错误保留操作并提示重试；本机写入失败显示“进度尚未保存”。
正常同步在后台静默进行；仅断网、同步失败、认证失效或本机未保存时显示状态与重试入口。
“已并入账号”只统计服务端已确认的记录。

存档 URL 和 `updatedAt` 冲突规则不变：较新的覆盖较旧的，时间相等保留已有值。
新客户端携带 `X-Save-Owner`，服务端与会话账号不符返回 409；未携带此头的旧客户端仍兼容。
云端列表仍最多返回 200 局，未返回的局不会被当作删除。
本次没有跨设备删除墓碑，另一台长期离线设备仍可能重新上传其持有的旧存档。

## PWA 与离线边界

网站也可以作为 PWA 安装：浏览器从 `/manifest.webmanifest` 读取名称和图标，
`/sw.js` 随每次构建写入当版资源清单。iPhone 用 Safari 的「分享 → 添加到主屏幕」，
Chrome/Android 可在浏览器菜单选择安装，网站「关于」页也会在支持时提供安装按钮。
联网时页面入口始终走网络，断网时才回退到预缓存的应用外壳；在已安装应用中保存的
案卷仍可阅读。iPhone 主屏幕应用可能使用独立于 Safari 的本地存储；登录可同步已有
进度。`/api/*`、账号数据、每日汤和题库数据不由 Service Worker 缓存，
需要联网才能更新或继续判读。更新后的 Worker 等旧页面关闭再接管，避免切换版本时
丢失正在玩的状态。

## 页面加载恢复

发布后旧页面引用的按需资源可能已失效。客户端只对本站应用资源失败执行恢复，
第三方脚本失败不会触发整页刷新。每个标签页 60 秒内最多自动刷新一次；
断网时等待联网，本机进度未保存或 sessionStorage 不可用时提供手动重试。
慢启动只显示加载提示，不强制中断下载，也不计作客户端错误。
错误台账保留实际失败的资源路径、版本与组件栈，历史计数不会因发布而清空。

主持人判读单次等待最多 20 秒，临时故障最多重试一次，退避最多 1 秒；
仍失败时返回本地化的超时或连接提示。判读问题、模型选择和结案规则不变。
