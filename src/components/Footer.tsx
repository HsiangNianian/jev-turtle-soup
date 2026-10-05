import { ExternalLink, Link } from '@/components/Link'
import { QQ_GROUP, showsGroupInvite } from '@/lib/community'
import { useI18n } from '@/lib/i18n'

const SISTER_SITES = [
  { label: '认知防锈', href: 'https://cortex.hydroroll.team' },
  { label: '烤死线', href: 'https://ddlroast.hydroroll.team' },
  { label: '积案拂尘', href: 'https://deadpan.hydroroll.team' },
  { label: '另一个行测', href: 'https://lcti.hydroroll.team' },
]

const INNER_LINKS = [
  { label: '题库', to: '/library' },
  { label: '怎么写', to: '/guide' },
  { label: '上传新汤', to: '/upload' },
  { label: '我的题库', to: '/me' },
  { label: '关于与版本', to: '/about' },
]

export function Footer() {
  const { t, locale } = useI18n()
  const linkClass = 'ink-link text-muted-foreground transition-colors hover:text-foreground'
  return (
    <footer className="mx-auto mt-20 w-full max-w-6xl px-5 pb-10 sm:px-8">
      <div className="grid gap-8 border-t border-foreground/20 pt-10 sm:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="seal size-7 text-[15px]">
              汤
            </span>
            <span className="font-serif text-[15px] font-semibold tracking-[0.14em]">
              {t('海龟汤调查局')}
            </span>
          </div>
          {/* 读者群只给中文界面看：群是中文社区 */}
          {showsGroupInvite(locale) ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.12em]">
              <span className="text-muted-foreground/70">{t('编辑部群')}</span>
              <ExternalLink href={QQ_GROUP.href} className={linkClass}>
                {QQ_GROUP.number}
              </ExternalLink>
              <span className="text-muted-foreground/60">{QQ_GROUP.name}</span>
            </div>
          ) : null}
        </div>

        <nav className="flex flex-col items-start gap-2.5 font-mono text-[11px] tracking-[0.14em]">
          <span className="mb-1 text-[10px] tracking-[0.24em] text-muted-foreground/70">
            {t('调查局')}
          </span>
          {INNER_LINKS.map((item) => (
            <Link key={item.to} to={item.to} className={linkClass}>
              {t(item.label)}
            </Link>
          ))}
        </nav>

        <nav className="flex flex-col items-start gap-2.5 font-mono text-[11px] tracking-[0.14em]">
          <span className="mb-1 text-[10px] tracking-[0.24em] text-muted-foreground/70">
            {t('姊妹站')}
          </span>
          {SISTER_SITES.map((site) => (
            <ExternalLink key={site.href} href={site.href} className={linkClass}>
              {t(site.label)}
            </ExternalLink>
          ))}
          <ExternalLink href="https://mmstudio.games" className={linkClass}>
            {t('工作室')}
          </ExternalLink>
        </nav>
      </div>

      <div className="mt-10 border-t border-dashed border-foreground/15 pt-5">
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70">
          © {new Date().getFullYear()} Meaningless Meaning Studio · v{__APP_VERSION__}
        </span>
      </div>
    </footer>
  )
}
