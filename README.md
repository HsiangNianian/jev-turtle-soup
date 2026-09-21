# 海龟汤调查局 · Jev 情境推理

一个与主持人 **Jev**（TypeSafe System One 模型）持续对话推理、逐步揭开汤底的
网页游戏。

- **题库**：玩家可以上传自己的海龟汤；也可以玩每天定时生成的官方汤。
  出题口不对玩家开放——汤是**攒出来的**，不是现场点出来的。
- **主持**：每一轮把玩家消息、最近对话和汤底一起交给 **Jev**，一次并行地问 5
  个原子问题（意图、是非判断、接近度、是否猜中、元请求），由代码把判断组合成
  「是 / 不是 / 无关 / 是，也不是」的回答。
- **档案室**：对局实时存进浏览器 localStorage，随时继续或回看。
- **社交**：作者主页与题库的汤都有点赞和留言板。

## 技术栈

React 19 · Vite · Tailwind CSS v4 · Cloudflare Workers · TypeSafe Jev · DeepSeek / OpenAI

## 快速开始

```bash
npm install
cp .env.example .env   # 填入密钥
npm run dev
```

打开终端里输出的地址即可。本地开发的 `/api/*` 由 Vite 中间件（`server/index.ts`）
提供，线上由 Worker（`worker/index.ts`）提供，两者共用 `shared/game.ts`，行为一致。

## 环境变量

本地放在 `.env`，线上用 Worker secrets（`wrangler secret put <NAME>`）。

| 变量 | 说明 |
| --- | --- |
| `TYPESAFE_API_KEY` | 必填。主持人 Jev 的密钥，从 https://console.typesafe.ai/keys 获取 |
| `DEEPSEEK_API_KEY` | 选填。配置后用它生成每日官方汤（`deepseek-chat`） |
| `OPENAI_API_KEY` | 选填。没有 DeepSeek 时使用（默认 `gpt-4o-mini`） |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 选填。任意 OpenAI 兼容端点，优先级最高 |

LLM 密钥只在生成每日官方汤时用到；没有配置时题库与对局仍然可用。

## 架构

```
worker/index.ts   ← Cloudflare Worker：/api/* 与静态资源 SPA 兜底
server/index.ts   ← Vite dev 中间件：同一套 /api/*，仅本地开发用
shared/game.ts    ← 共用逻辑：主持提问、判定拼装（不依赖 Node API）
src/              ← React 前端；汤面与汤底随请求一起发送，无服务端会话
```

| 路由 | 作用 |
| --- | --- |
| `GET /api/health` | 返回当前配置的模型与兜底题库数量 |
| `POST /api/game/ask` | 带上会话号与玩家消息，返回主持人回答 |
| `POST /api/game/reveal` | 揭晓这一局的汤底 |
| `/api/library/puzzles[...]` | 公开题库：列表、详情、判读、上传、改可见性、删除 |
| `/api/auth/*`、`/api/me/*`、`/api/u/:handle` | 邮箱验证码登录、我的题库、作者主页 |
| `GET /api/daily`、`GET /api/daily/:date` | 官方每日汤：今天的一碗与往期（当天不下发汤底） |
| `POST /api/daily/generate` | 手动生成当天官方汤（SSE，需 `x-admin-token`） |
| `GET /api/audit/flags` | 判读巡检结果：复核后改判的条目（需 `x-admin-token`） |
| `POST /api/audit/run` | 手动跑一次维护：清理过期日志 + 巡检（需 `x-admin-token`） |
| `/api/social/{profile\|puzzle}/:id` | 点赞与留言板：`GET` 取数据，`POST/DELETE .../like` 点赞，`POST .../comments` 留言 |
| `/api/social/comments/:id` | 删除留言（留言作者或对象主人）；`/report` 举报 |

管理接口的口令取自 `DAILY_ADMIN_TOKEN`，没配时退回 `AUTH_SECRET`：

```bash
npx wrangler secret put DAILY_ADMIN_TOKEN
curl -X POST -H "x-admin-token: $DAILY_ADMIN_TOKEN" \
  https://hgt.mmstudio.games/api/daily/generate
```

## 定时任务

`wrangler.jsonc` 里配了三条 Cron，处理入口都在 `worker/index.ts` 的 `scheduled`，按 `event.cron` 分流：

| Cron（UTC） | 做什么 |
| --- | --- |
| `0 0 * * *`、`0 */6 * * *` | 生成当天官方汤；每 6 小时补一次，避免当天缺题 |
| `0 4 * * *` | 维护：清理过期日志（判读流水 90 天、反馈 1 年）+ 巡检可疑判读 |

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
只有调用揭晓接口时才会拿到汤底。对局进度仍实时存在 localStorage，
刷新或换设备打开都能继续。

## 部署到 Cloudflare Workers

仓库已带 `wrangler.jsonc`：Worker 处理 `/api/*`，其余请求交给 `./dist` 的
SPA（`not_found_handling: single-page-application` + `run_worker_first: ["/api/*"]`）。

**Dashboard 连 Git 的构建配置：**

| 项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

**再配上密钥**（Workers & Pages → 该项目 → Settings → Variables and Secrets）：

```bash
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
```

也可以本地直接部署：

```bash
npm run build
npx wrangler deploy
```

**数据库**：`db/schema.sql` 是全量建表，`db/migrations/` 里是增量变更。
新建 D1 时先跑全量，之后的变更按序执行：

```bash
npx wrangler d1 execute jev-turtle-soup --remote --file=./db/schema.sql
npx wrangler d1 execute jev-turtle-soup --remote --file=./db/migrations/004-judge-flags.sql
```

## 命令

```bash
npm run dev      # 开发（Vite + 本地 API 中间件）
npm run build    # 类型检查 + 构建 dist/
npm run lint     # oxlint
npm run preview  # 预览构建产物（同样带本地 API）
```

## 关于中文

TypeSafe 文档说明 Jev 以英文为主要训练语言，中日韩文字可用但准确率相对较低。因此
主持人的问题指令与选项描述使用英文，故事状态保留中文，实测分类稳定；若你的数据上
表现不佳，可在 `shared/game.ts` 的 `HOST_QUESTIONS` 中调整措辞或阈值。
