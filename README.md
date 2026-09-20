# 海龟汤调查局 · Jev 情境推理

一个可点击生成完整海龟汤、并与主持人 **Jev**（TypeSafe System One 模型）持续对
话推理、逐步揭开汤底的网页游戏。

- **出题**：调用 DeepSeek / OpenAI 等大模型生成「汤面 + 汤底 + 提示」。
- **主持**：每一轮把玩家消息、最近对话和汤底一起交给 **Jev**，一次并行地问 5
  个原子问题（意图、是非判断、接近度、是否猜中、元请求），由代码把判断组合成
  「是 / 不是 / 无关 / 是，也不是」的回答。
- **档案室**：对局实时存进浏览器 localStorage，随时继续或回看；同一时间只能有
  一桩在办案件，结案（猜中 / 揭晓 / 中止）后才能立案新的。

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
| `DEEPSEEK_API_KEY` | 选填。配置后默认用它出题（`deepseek-chat`） |
| `OPENAI_API_KEY` | 选填。没有 DeepSeek 时使用（默认 `gpt-4o-mini`） |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 选填。任意 OpenAI 兼容端点，优先级最高 |

未配置任何 LLM 密钥时会退回到内置的 3 则经典海龟汤，游戏仍可完整体验。

## 架构

```
worker/index.ts   ← Cloudflare Worker：/api/* 与静态资源 SPA 兜底
server/index.ts   ← Vite dev 中间件：同一套 /api/*，仅本地开发用
shared/game.ts    ← 共用逻辑：出题、主持提问、判定拼装（不依赖 Node API）
src/              ← React 前端；汤面与汤底随请求一起发送，无服务端会话
```

| 路由 | 作用 |
| --- | --- |
| `GET /api/health` | 返回当前配置的模型与兜底题库数量 |
| `POST /api/game/new` | 生成一则海龟汤，返回汤面、汤底、提示 |
| `POST /api/game/ask` | 带上 `puzzle`（汤面/汤底）与玩家消息，返回主持人回答 |

服务端不保存任何对局：**汤底随请求往返，进度只存在浏览器 localStorage 里**，
因此刷新、重开、换设备部署都不会丢存档，也没有「会话过期」问题。

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
