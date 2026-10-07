# 本地开发

[← 项目首页](../README.md) · [部署与运维](operations.md) · [贡献指南](../CONTRIBUTING.md)

## 环境准备

使用 Node.js **22.13+**（测试使用内置 SQLite）与 npm。Wrangler、Vitest 等工具由 `package-lock.json` 锁定，命令使用项目本地依赖。

```bash
npm ci
cp .env.example .env
```

在 `.env` 中将 `AUTH_SECRET` 替换为本地随机值。默认 `AUTH_EXPOSE_CODE=1` 会在接口和登录页展示验证码，并跳过邮件发送。主持判读使用 TypeSafe Jev；每日生成另需 DeepSeek、OpenAI 或兼容端点。模型密钥按实际需要填写，未配置时不要触发对应请求。

统一使用 `.env`；**存在 `.dev.vars` 时，Wrangler 不加载 `.env`**。Vite 使用 `.env`，同时保留两种文件可能造成入口配置不同。生产 secrets 独立配置，本地文件不会随部署上传。见 [Workers secrets 文档](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 选择开发入口

| 命令                    | 适用场景                                 | 数据与更新方式                                                                                          |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev:worker`    | 完整业务：登录、题库、每日、云存档、同桌 | 本地 D1、KV、Durable Objects；先构建 `dist/` 再启动 Worker。修改前端后另开终端 `npm run build` 并刷新。 |
| `npm run dev`           | Vite 首页、组件与样式开发                | 前端热更新；仅 health 和内存对局 API，不支持完整业务。                                                  |
| `npm run preview`       | 预览已构建的前端                         | API 范围与 Vite 开发入口相同；内存对局随进程结束丢失。                                                  |
| `npm run rooms:preview` | 无密钥的界面与多人协议验证               | 隔离 Miniflare、示例题目、假账号、内存数据库与模拟主持人；不访问生产数据或真实模型。                    |

Vite 入口的 `/api/auth/*` 返回 501，题库和每日等未实现的 API 返回 404，这是入口能力限制。完整业务默认在 `http://localhost:8787`，隔离预览在 `http://localhost:8799`。

隔离预览把测试会话写入被 Git 忽略的 `.build/rooms/preview.json`，供测试脚本使用；不是生产登录方式。进入题库即可查看示例题目，多账号浏览器及原生检查见 [同桌说明](rooms.md#可复现检查)。

## 数据库初始化与升级

**新本地库**只执行当前全量 schema：

```bash
npm run db:local
npm run dev:worker
```

新库没有预置作品。可使用隔离预览查看演示题目，或在完整开发环境中登录并投稿。

**已有库**不要用全量 schema 代替升级，也不要重放全部历史迁移。先结合部署记录和表结构确认缺失项，只执行尚未应用的 SQL。迁移目录为 [`db/migrations/`](../db/migrations)，当前全量 schema 已包含其最终结构。

```bash
# 只检查本地表结构
npm run wrangler -- d1 execute jev-turtle-soup --local \
  --command "SELECT name FROM sqlite_master WHERE type='table'; PRAGMA table_info(turn_logs);"
```

例如，仅在确认当前库缺少作者周报运行表时，执行：

```bash
npm run wrangler -- d1 execute jev-turtle-soup --local \
  --file=./db/migrations/021-weekly-digest.sql
```

这些 SQL 文件没有通过 Wrangler 迁移跟踪表管理。`010-daily-single-source.sql` 含一次性重命名和删列；新库不要再次执行。多人升级详见 [同桌部署](rooms.md#数据库与发布)，周报升级详见 [作者周报](weekly-digest.md#部署与检查)。

默认持久化目录是 `.wrangler/state`。需隔离本地验证时，为初始化与运行指定同一个目录：

```bash
npm run db:local -- --persist-to .wrangler/smoke
npm run dev:worker -- --persist-to .wrangler/smoke --port 8788
```

以上 D1 命令均使用 `--local`。远程操作应在确认账号、配置和目标库后显式使用 `--remote`，详见 [D1 本地开发](https://developers.cloudflare.com/d1/best-practices/local-development/)。

## 环境变量

模板见 [`.env.example`](../.env.example)。

| 变量                                                          | 用途                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `AUTH_SECRET`                                                 | 会话与验证码签名。本地和生产分别生成随机值。                             |
| `AUTH_EXPOSE_CODE`                                            | 本地设 `1` 显示验证码、跳过邮件；生产保持未设置或 `0`。                  |
| `TYPESAFE_API_KEY`                                            | Jev 主持判读、审核与相关模型能力。读取题库和存档不需要它。               |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`   | 每日生成使用的 DeepSeek 配置；默认模型 `deepseek-chat`。                 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`         | 未配置 DeepSeek 时使用；默认模型 `gpt-4o-mini`。                         |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_PROVIDER` | 自定义 OpenAI 兼容端点，优先级最高；`provider` 为显示名称。              |
| `MAIL_FROM`                                                   | 邮件发件地址；生产需使用自己已配置的发件域名。                           |
| `DAILY_ADMIN_TOKEN`                                           | 管理生成、维护等接口口令；未设置时回退 `AUTH_SECRET`。                   |
| `ROOMS_ENABLED`                                               | `wrangler.jsonc` 中的开桌开关。设 `0` 停止新开桌，已有房间与案卷仍保留。 |

## 目录结构

```text
src/                  React 网页、交互、路由与本机存档
shared/               主持判读、题库、登录、每日生成、存档等共用逻辑
server/index.ts       Vite dev / preview 的有限 API 中间件
worker/entry.ts       Worker 入口与 Durable Object 导出
worker/index.ts       HTTP 路由、静态资源、定时任务
worker/               同桌权威状态、协议与 Cloudflare 运行时
public/               网站图标、PWA 资源
scripts/              原生构建、隔离预览与多端回归
db/                  数据库 schema、迁移与精选记录
ios/                 SwiftUI 原生客户端与字体
android/             Kotlin / Jetpack Compose 原生客户端
docs/                开发、协议、运维与设计说明
```

## 验证命令

```bash
npm test                 # Vitest + 内存 SQLite + 可控模型／网络替身
npm run lint             # oxlint
npm run build            # TypeScript 检查 + Vite 生产构建
npm run deploy:dry-run   # 构建并检查 Worker 打包，不部署
```

前端交互可使用隔离环境回归：

```bash
# 终端一
npm run rooms:preview
# 终端二，首次准备浏览器
npx playwright install chromium
npm run rooms:test:web
node scripts/test-personal-marks-web.mjs
```

原生依赖与检查入口见 [iOS](../ios/README.md) 和 [Android](../android/README.md)。测试结论应区分替身、真实本地协议、模拟器、真机和线上验证。
