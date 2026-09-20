# 海龟汤 · Jev 情境推理

一个可点击生成完整海龟汤、并与主持人 **Jev**（TypeSafe System One 模型）持续对
话推理、逐步揭开汤底的网页游戏。

- **出题**：调用 DeepSeek / OpenAI 等大模型生成「汤面 + 汤底 + 提示」，汤底保存在
  服务端内存会话里，前端拿不到。
- **主持**：每一轮把玩家消息、最近对话和隐藏汤底一起交给 **Jev**，一次并行地问 5
  个原子问题（意图、是非判断、接近度、是否猜中、元请求），由代码把判断组合成
  「是 / 不是 / 无关 / 是，也不是」的回答。
- **揭晓**：可以继续猜（猜中即通关），也可以随时点按钮直接看 LLM 预生成的汤底。

## 技术栈

React 19 · Vite · Tailwind CSS v4 · shadcn/ui · TypeSafe Jev · DeepSeek / OpenAI

## 快速开始

```bash
npm install
cp .env.example .env   # 填入密钥
npm run dev
```

打开终端里输出的地址即可。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `TYPESAFE_API_KEY` | 必填。主持人 Jev 的密钥，从 https://console.typesafe.ai/keys 获取 |
| `DEEPSEEK_API_KEY` | 选填。配置后默认用它出题（`deepseek-chat`） |
| `OPENAI_API_KEY` | 选填。没有 DeepSeek 时使用（默认 `gpt-4o-mini`） |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 选填。任意 OpenAI 兼容端点，优先级最高 |

未配置任何 LLM 密钥时会退回到内置的 3 则经典海龟汤，游戏仍可完整体验。

## 架构

密钥只在服务端使用。API 通过 Vite 中间件（`server/index.ts`）提供：

| 路由 | 作用 |
| --- | --- |
| `GET /api/health` | 返回当前配置的模型与兜底题库数量 |
| `POST /api/game/new` | 生成并保存一则海龟汤，返回汤面（不返回汤底） |
| `POST /api/game/ask` | 让 Jev 判读玩家这一轮消息，返回主持人回答 |
| `POST /api/game/reveal` | 揭晓汤底 |

汤底存放于服务端会话，前端只能通过 `/api/game/ask` 或 `/api/game/reveal` 取得。

## 命令

```bash
npm run dev      # 开发
npm run build    # 类型检查 + 生产构建
npm run lint     # oxlint
```

## 关于中文

TypeSafe 文档说明 Jev 以英文为主要训练语言，中日韩文字可用但准确率相对较低。因此
主持人的问题指令与选项描述使用英文，故事状态保留中文，实测分类稳定；若你的数据上
表现不佳，可在 `server/index.ts` 的 `HOST_QUESTIONS` 中调整措辞或阈值。
