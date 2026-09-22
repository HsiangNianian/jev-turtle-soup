import { ExternalLink, Link } from '@/components/Link'
import { PageShell } from '@/components/Bits'
import { QQ_GROUP, showsGroupInvite } from '@/lib/community'
import { useI18n } from '@/lib/i18n'

const HOW_TO_PLAY = [
  {
    step: '出题',
    body: '题目有两个来源：别人写好放进题库的，和每天定时熬一碗的官方汤。每则都分成两半：摆在你面前的怪事叫「汤面」，藏起来的真相叫「汤底」。',
  },
  {
    step: '盘问',
    body: '你只能问能用「是」或「不是」回答的问题，比如「他是自杀的吗？」。主持人砚看过汤底，只会回你「是」「不是」「无关」，或者「是，也不是」。',
  },
  {
    step: '结案',
    body: '想通了就把整件事说一遍，说对了就算通关；实在没头绪，也可以直接翻开汤底看答案，或者换一碗重来。',
  },
]

const DATA = [
  {
    name: '邮箱',
    body: '只有你登录时填的那个邮箱。它只用来给你发一封带 6 位登录码的邮件，我们不会拿它发别的东西。',
  },
  {
    name: '你写的汤',
    body: '你自己写的汤面和汤底会留在我们这边。想让所有人都能玩，还是只留给自己看，由你决定。',
  },
  {
    name: '新开的汤',
    body: '每次现熬的汤也暂时放在我们这边，90 天之后自动清掉，不会一直留着。',
  },
  {
    name: '这台设备上的记录',
    body: '你玩到哪儿、以前玩过的局、今日人品，都记在你这台设备的浏览器里。换一台设备打开就是新的。',
  },
]

export function AboutPage() {
  const { t, locale } = useI18n()
  return (
    <PageShell
      label={t('关于')}
      title={t('关于这碗汤')}
      meta={
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          v{__APP_VERSION__} · {__BUILD_ID__}
        </span>
      }
    >
      <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        {t(
          '海龟汤是一种猜真相的游戏：先给你一句反常的话，你只能靠问「是 / 不是」的问题，一点点把背后的故事问出来。这里没有真人当主持，出题和判读都由 AI 完成。',
        )}
      </p>
      <p className="mt-3 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        {t('它由 Meaningless Meaning Studio 的 {name} 制作。')
          .split('{name}')
          .map((part, index, parts) => (
            <span key={index}>
              {part}
              {index < parts.length - 1 ? (
                <ExternalLink
                  href="https://academic.jyunko.cn"
                  className="underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
                >
                  {t('简律纯')}
                </ExternalLink>
              ) : null}
            </span>
          ))}
      </p>

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        {t('怎么玩')}
      </div>
      <ul className="mt-3 border-t border-foreground/20">
        {HOW_TO_PLAY.map((item) => (
          <li key={t(item.step)} className="rule-dashed flex items-start gap-4 py-3.5">
            <span className="w-20 shrink-0 pt-0.5 font-mono text-[11px] leading-5 break-words text-stamp sm:w-24">
              {t(item.step)}
            </span>
            <span className="font-serif text-[14px] leading-7 text-foreground/80">
              {t(item.body)}
            </span>
          </li>
        ))}
      </ul>

      {/* 读者群只给中文界面看 */}
      {showsGroupInvite(locale) ? (
        <>
          <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
            {t('编辑部群')}
          </div>
          <p className="mt-3 max-w-xl font-serif text-[14px] leading-7 text-foreground/80">
            {t('群里是写汤和玩汤的人：出题讨论、判读纠错、催更，以及「这道汤到底该怎么问」。')}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 font-mono text-[11px] tracking-[0.14em]">
            <span className="text-muted-foreground">
              {t('群号 {number}', { number: QQ_GROUP.number })}
            </span>
            <ExternalLink
              href={QQ_GROUP.href}
              className="underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
            >
              {t('点这里加入')}
            </ExternalLink>
            <span className="text-muted-foreground/50">{QQ_GROUP.name}</span>
          </p>
        </>
      ) : null}

      <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        {t('我们存了什么')}
      </div>
      <ul className="mt-3 border-t border-foreground/20">
        {DATA.map((item) => (
          <li key={t(item.name)} className="rule-dashed flex items-start gap-4 py-3.5">
            <span className="w-20 shrink-0 pt-1 font-serif text-[13px] leading-6 break-words text-muted-foreground sm:w-28">
              {t(item.name)}
            </span>
            <span className="font-serif text-[14px] leading-7 text-foreground/80">
              {t(item.body)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-l-2 border-l-foreground/40 bg-card px-4 py-3 font-serif text-[13px] leading-7 text-foreground/75">
        {t(
          '没有第三方统计，也没有广告。汤底不会提前跑到你的浏览器里——只有你点「拆封汤底」的时候，它才会被取回来。',
        )}
      </p>

      <div className="mt-9">
        <Link
          to="/"
          className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('← 回首页')}
        </Link>
      </div>
    </PageShell>
  )
}
