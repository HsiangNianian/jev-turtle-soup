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
  { label: '上传新汤', to: '/upload' },
  { label: '我的题库', to: '/me' },
  { label: '关于与版本', to: '/about' },
]

export function Footer() {
  const { t, locale } = useI18n()
  return (
    <footer className="mx-auto mt-16 w-full max-w-3xl px-5 pb-10 sm:px-6">
      <div className="border-t border-foreground/25 pt-6">
        <span className="font-mono text-[10px] tracking-[0.24em] text-foreground">
          {t('海龟汤调查局')}
        </span>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] tracking-[0.16em]">
          {INNER_LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(item.label)}
            </Link>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.16em]">
          <span className="text-muted-foreground/50">{t('姊妹站')}</span>
          {SISTER_SITES.map((site) => (
            <ExternalLink
              key={site.href}
              href={site.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(site.label)}
            </ExternalLink>
          ))}
          <ExternalLink
            href="https://mmstudio.games"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('工作室')}
          </ExternalLink>
        </div>

        {/* 读者群只给中文界面看：群是中文社区 */}
        {showsGroupInvite(locale) ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.16em]">
            <span className="text-muted-foreground/50">{t('编辑部群')}</span>
            <ExternalLink
              href={QQ_GROUP.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {QQ_GROUP.number}
            </ExternalLink>
            <span className="text-muted-foreground/40">{QQ_GROUP.name}</span>
          </div>
        ) : null}

        <div className="mt-5 border-t border-dashed border-foreground/20 pt-4">
          <span className="font-mono text-[9px] tracking-[0.16em] text-muted-foreground/55">
            © {new Date().getFullYear()} Meaningless Meaning Studio · v{__APP_VERSION__} ·{' '}
            {__BUILD_ID__}
          </span>
        </div>
      </div>
    </footer>
  )
}
