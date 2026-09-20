import { Link } from '@/components/Link'
import { PageShell } from '@/components/Bits'

const HOW_IT_WORKS = [
  ['出题', '你选难度和题材（本格 / 怪力乱神），大模型写出一则完整的汤。'],
  ['盘问', '只能问能用「是 / 不是」回答的问题，主持人砚会读汤底后给出判断。'],
  ['结案', '完全还原真相即通关；也可以随时拆封汤底，或者中止本案。'],
]

const STORAGE = [
  ['邮箱', '登录用的邮箱地址，只用来发 6 位验证码，不做推广。'],
  ['上传的汤', '汤面、汤底、提示存在 D1 里，按你设置的公开或私密展示。'],
  ['生成的汤', '临时会话同样存在服务端，默认保留 90 天，之后自动清理。'],
  ['本地进度', '对局进度、档案室和今日人品的设备码都存在浏览器 localStorage。'],
]

export function AboutPage() {
  return (
    <PageShell
      label="关于 / ABOUT"
      title="关于这碗汤"
      meta={
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          v{__APP_VERSION__} · {__BUILD_ID__}
        </span>
      }
    >
      <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        海龟汤调查局是一个机器主持的情境推理游戏：AI 负责出题，主持人「砚（Ellis）」
        负责判读你的问题。它由 Meaningless Meaning Studio 制作。
      </p>

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        怎么玩 / HOW IT WORKS
      </div>
      <ul className="mt-3 border-t border-foreground/20">
        {HOW_IT_WORKS.map(([title, body]) => (
          <li key={title} className="rule-dashed flex gap-4 py-3.5">
            <span className="w-10 shrink-0 font-mono text-[11px] text-stamp">{title}</span>
            <span className="font-serif text-[14px] leading-7 text-foreground/80">{body}</span>
          </li>
        ))}
      </ul>

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        我们存了什么 / DATA
      </div>
      <ul className="mt-3 border-t border-foreground/20">
        {STORAGE.map(([title, body]) => (
          <li key={title} className="rule-dashed flex gap-4 py-3.5">
            <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
              {title}
            </span>
            <span className="font-serif text-[14px] leading-7 text-foreground/80">{body}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-l-2 border-l-foreground/40 bg-card px-4 py-3 font-mono text-[11px] leading-6 text-foreground/75">
        没有第三方统计、没有广告、没有埋点。汤底只在你点「拆封汤底」时才会传给浏览器。
      </p>

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        技术 / STACK
      </div>
      <p className="mt-3 font-serif text-[14px] leading-7 text-foreground/80">
        React 19 · Vite · Tailwind v4 前端；Cloudflare Workers + D1 + KV 后端；出题用 DeepSeek，
        主持判读用 TypeSafe System One。源码在{' '}
        <a
          href="https://github.com/HsiangNianian/jev-turtle-soup"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
        >
          GitHub
        </a>
        ，更新记录见{' '}
        <a
          href="https://github.com/HsiangNianian/jev-turtle-soup/commits/main"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
        >
          提交历史
        </a>
        ，问题和建议请开{' '}
        <a
          href="https://github.com/HsiangNianian/jev-turtle-soup/issues"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
        >
          Issue
        </a>
        。
      </p>

      <div className="mt-9">
        <Link
          to="/"
          className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          ← 回首页
        </Link>
      </div>
    </PageShell>
  )
}
