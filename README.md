# 海龟汤调查局 · Jev 情境推理

一个与主持人 **Jev**（TypeSafe System One 模型）持续对话推理、逐步揭开汤底的
网页游戏。

- **题库**：玩家可以上传自己的海龟汤；也可以玩每天定时生成的官方汤。
  出题口不对玩家开放——汤是**攒出来的**，不是现场点出来的。
- **主持**：服务端读取汤底，把玩家消息、最近对话和故事状态交给 **Jev**，
  并行判读意图、是非、接近度、动机、手法、关键反转等，再由代码组合回答。
- **档案室**：游客与每个账号分别保存本机进度；登录后同步到账号，随时继续或回看。
- **社交**：作者主页与题库的汤都有点赞和留言板。

## 技术栈

React 19 · Vite · Tailwind CSS v4 · Cloudflare Workers · TypeSafe Jev · DeepSeek / OpenAI

## 本地开发

使用 Node.js 22.13+（测试用内置 SQLite；也支持更新的 Node 版本）。
Wrangler **4.136.2**、Vitest **5.0.1** 已锁定在开发依赖中，所有命令使用项目本地版本。

```bash
npm ci
cp .env.example .env   # 本地验证码模式已开启，按需填模型密钥
```

保留两个入口：

| 命令                 | 适用场景                                                  | 修改前端后                                            |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `npm run dev`        | Vite 首页、组件与样式开发；API 仅有 health 和内存对局接口 | 自动热更新                                            |
| `npm run dev:worker` | 完整业务：验证码登录、题库、每日汤、云存档；本地 KV / D1  | 重新运行此命令，或另开终端运行 `npm run build` 后刷新 |

Vite 不提供完整题库、登录、每日汤或云存档；控制台也会提示使用 Workers 入口。
Workers 入口先构建 `dist/`，再运行 `wrangler dev --local`，不会自动构建前端。
它使用与线上相同的 Worker 代码，但数据和绑定均在本地，不需要部署。

### 本地数据库：初始化与升级

**新库**只执行当前全量 schema，然后启动 Worker：

```bash
npm run db:local
npm run dev:worker
```

**已有库**不要用全量 schema 代替升级，也不要重放所有历史迁移。
先对照 `db/migrations/` 检查本地表与列，仅按编号执行尚未应用的迁移。
例如此前已完成 001–015、只缺云存档表时：

```bash
npm run wrangler -- d1 execute jev-turtle-soup --local --command "PRAGMA table_info(dailies); PRAGMA table_info(saves);"
npm run wrangler -- d1 execute jev-turtle-soup --local --file=./db/migrations/016-saves.sql
```

当前 `dailies` 应有 `generate_attempts`，标题和汤面等字段以 `puzzles` 为准。
010 包含重命名和删列等一次性操作；新库已包含其最终结构，不要再执行。
这些 SQL 文件未通过 Wrangler 的迁移跟踪表管理，应结合已有升级记录和表结构判断缺失项。
以上命令均指定 `--local`，不会清空已有数据。

如需隔离验证，用同一个新目录同时初始化数据库和启动 Worker：

```bash
npm run db:local -- --persist-to .wrangler/smoke
npm run dev:worker -- --persist-to .wrangler/smoke --port 8788
```

D1 默认本地持久化目录为 `.wrangler/state`；参见 [D1 本地开发规则](https://developers.cloudflare.com/d1/best-practices/local-development/)。

### 环境变量

统一推荐 `.env`。**如果已有 `.dev.vars`，Wrangler 将不加载 `.env`**；请将配置合并到一种文件中。
Vite 使用 `.env`，因此同时保留两种文件容易造成两个入口配置不同。
具体优先级见 [Workers 本地 secrets 规则](https://developers.cloudflare.com/workers/configuration/secrets/)。
生产 secrets 另行配置，`.env` 不会随部署上传。

| 变量                                                          | 说明                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`                                            | Jev 判读、每日审核等模型能力需要；登录、题库读取与存档不需要                 |
| `AUTH_SECRET`                                                 | 登录会话与验证码签名；本地和生产应分别生成随机值                             |
| `AUTH_EXPOSE_CODE`                                            | 本地设为 `1`：接口及登录页显示验证码，跳过邮件发送；生产默认关闭，勿设为 `1` |
| `MAIL_FROM`                                                   | 邮件发件地址，Wrangler 配置已有默认值                                        |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`   | 每日生成，默认模型 `deepseek-chat`                                           |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`         | 未配 DeepSeek 时使用，默认 `gpt-4o-mini`                                     |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_PROVIDER` | 自定义 OpenAI 兼容端点，优先级最高；provider 用作显示名称                    |
| `DAILY_ADMIN_TOKEN`                                           | 管理生成和维护接口口令，未设置时使用 `AUTH_SECRET`                           |

不配置模型密钥也能验证本地验证码登录、已有题库读取与存档增删改查；不要触发判读或每日生成即可。

## 架构

```
worker/index.ts   ← Cloudflare Worker：/api/* 与静态资源 SPA 兜底
server/index.ts   ← Vite dev 中间件：health / 内存对局，前端开发用
shared/game.ts    ← 共用逻辑：主持提问、判定拼装（不依赖 Node API）
src/              ← React 前端；提问发送题号或会话号，未揭晓汤底留在服务端
```

| 路由                                         | 作用                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/health`                            | 返回当前配置的模型与兜底题库数量                                                  |
| `POST /api/game/ask`                         | 带上会话号与玩家消息，返回主持人回答                                              |
| `POST /api/game/reveal`                      | 揭晓这一局的汤底                                                                  |
| `/api/library/puzzles[...]`                  | 公开题库：列表、详情、判读、上传、改可见性、删除                                  |
| `/api/me/saves`、`/api/me/saves/:id`         | 登录态存档列表/兼容批量导入、单局 PUT/DELETE                                      |
| `/api/auth/*`、`/api/me/*`、`/api/u/:handle` | 邮箱验证码登录、我的题库、作者主页                                                |
| `GET /api/daily`、`GET /api/daily/:date`     | 官方每日汤：今天的一碗与往期（当天不下发汤底）                                    |
| `POST /api/daily/generate`                   | 手动生成当天官方汤（SSE，需 `x-admin-token`）                                     |
| `GET /api/audit/flags`                       | 判读巡检结果：复核后改判的条目（需 `x-admin-token`）                              |
| `POST /api/audit/run`                        | 手动跑一次维护：清理过期日志 + 巡检（需 `x-admin-token`）                         |
| `/api/social/{profile\|puzzle}/:id`          | 点赞与留言板：`GET` 取数据，`POST/DELETE .../like` 点赞，`POST .../comments` 留言 |
| `/api/social/comments/:id`                   | 删除留言（留言作者或对象主人）；`/report` 举报                                    |

管理接口的口令取自 `DAILY_ADMIN_TOKEN`，没配时退回 `AUTH_SECRET`：

```bash
npm run wrangler -- secret put DAILY_ADMIN_TOKEN
curl -X POST -H "x-admin-token: $DAILY_ADMIN_TOKEN" \
  https://hgt.mmstudio.games/api/daily/generate
```

## 定时任务

`wrangler.jsonc` 里配了三条 Cron，处理入口都在 `worker/index.ts` 的 `scheduled`，按 `event.cron` 分流：

| Cron（UTC）                | 做什么                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `0 0 * * *`、`0 */6 * * *` | 生成当天官方汤；每 6 小时补一次，避免当天缺题                 |
| `0 4 * * *`                | 维护：清理过期日志（判读流水 90 天、反馈 1 年）+ 巡检可疑判读 |

**判读巡检**（`shared/audit.ts`）抽查最近 7 天里判成「无关 / 是，也不是」的记录，让 Jev
**盲判**一次（不告诉它原判读，避免迁就），只把「漏掉真线索」和「前后矛盾」这一类改判写进
`judge_flags`；`无关 → 不是` 这种两说都成立的差异不计，免得淹没信号。一次巡检只花一次
LLM 调用。

**点赞与留言板**（`shared/social.ts`）：作者主页与题库的汤共用一套，只有 `profile`（按 handle）
和 `puzzle`（按题号）两种对象。点赞**不需要登录**——登录了用 uid、没登录用本机设备号，
唯一索引保证一个人只算一票；留言**需要登录**，有署名才谈得上留言板。删除权限给留言作者本人
和这个对象的主人（主页作者 / 题主）；举报走的还是 `reports` 表，`kind = 'comment'`。
私密主页和未公开的题一律当作不存在，不参与点赞留言。

**汤底永远留在服务端**：对局写进 D1（`visibility = 'session'`，默认保留 90 天），
题库的题也写进 D1。浏览器只会收到汤面，提问时只发会话号，因此 F12 看不到答案；
只有揭晓或结案时才会拿到汤底。未登录的本机进度只能在同一浏览器继续；
登录并同步成功后，才可在其他设备登录同一账号接着玩。

### 云存档恢复与边界

本机 `turtle-soup.archive.v2` 将游客、各账号的进度和待同步操作放在独立空间中，
以一次 localStorage 写入同时保存。旧 `turtle-soup.archive.v1` 只迁移一次：
有缓存账号时归入该账号，否则归游客，原 key 保留为备份。写入失败不标记迁移成功。
游客记录归首次登录账号；目标空间和源清除原子保存，后续账号不会重复导入。

缓存账号只用于离线显示；服务端认证成功后才上传。登录导入走逐条 PUT，
500ms 合并频繁保存，同账号串行发送。失败操作和删除标记在刷新后仍保留；
网络错误、429、5xx 按 1/2/4/8/16/30 秒重试，之后最多间隔 30 秒，联网或页面重新可见时可提前重试。
401/账号不匹配暂停等待认证，其他错误保留操作并提示重试；本机写入失败显示“进度尚未保存”。
“已并入账号”只统计服务端已确认的记录。

存档 URL 和 `updatedAt` 冲突规则不变：较新的覆盖较旧的，时间相等保留已有值。
新客户端携带 `X-Save-Owner`，服务端与会话账号不符返回 409；未携带此头的旧客户端仍兼容。
云端列表仍最多返回 200 局，未返回的局不会被当作删除。
本次没有跨设备删除墓碑，另一台长期离线设备仍可能重新上传其持有的旧存档。

## 部署到 Cloudflare Workers

仓库已带 `wrangler.jsonc`：Worker 处理 `/api/*`，其余请求交给 `./dist` 的
SPA（`not_found_handling: single-page-application` + `run_worker_first: true`，支持页面分享元信息）。

**Dashboard 连 Git 的构建配置：**

| 项             | 值                           |
| -------------- | ---------------------------- |
| Build command  | `npm run build`              |
| Deploy command | `npm run wrangler -- deploy` |

**再配上密钥**（Workers & Pages → 该项目 → Settings → Variables and Secrets）：

```bash
npm run wrangler -- secret put TYPESAFE_API_KEY
npm run wrangler -- secret put DEEPSEEK_API_KEY
npm run wrangler -- secret put AUTH_SECRET
```

也可以本地直接部署：

```bash
npm run build
npm run wrangler -- deploy
```

生产数据库的初始化与升级也应区分新库和已有库，规则同上；线上操作需要明确选择远程目标。
本文的开发和验证命令只使用本地 D1。

## 验证命令

```bash
npm test                 # Vitest；真实内存 SQLite schema，可控模型/网络替身，无真实邮件或模型调用
npm run lint             # oxlint
npm run build            # 类型检查 + 构建 dist/
npm run deploy:dry-run   # 构建并检查 Worker 打包，不部署
npm run preview          # 预览前端构建，API 能力与 Vite 开发入口相同
```

回归覆盖每日汤历史关联查询、持久队列失败恢复、并发顺序、账号隔离、一次性迁移、
存储失败、账号请求头和时间戳冲突规则。

## 关于中文

TypeSafe 文档说明 Jev 以英文为主要训练语言，中日韩文字可用但准确率相对较低。因此
主持人的问题指令与选项描述使用英文，故事状态保留中文，实测分类稳定；若你的数据上
表现不佳，可在 `shared/game.ts` 的 `HOST_QUESTIONS` 中调整措辞或阈值。
