import { Link } from '@/components/Link'

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
  return (
    <footer className="mx-auto mt-16 w-full max-w-3xl px-5 pb-10 sm:px-6">
      <div className="border-t border-foreground/25 pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-mono text-[10px] tracking-[0.24em] text-foreground">
            海龟汤调查局 / TURTLE SOUP BUREAU
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
            Meaningless Meaning Studio
          </span>
        </div>

        <p className="mt-3.5 max-w-xl font-serif text-[14px] leading-7 text-foreground/75">
          砚（Ellis）在这里主持。每一碗汤都从一句反常的话开始，余下的故事，要靠你一句句问回来。
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] tracking-[0.16em]">
          {INNER_LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.16em]">
          <span className="text-muted-foreground/50">姊妹站</span>
          {SISTER_SITES.map((site) => (
            <a
              key={site.href}
              href={site.href}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {site.label}
            </a>
          ))}
          <a
            href="https://mmstudio.games"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            工作室
          </a>
        </div>

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
