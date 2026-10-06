import type { ReactNode } from 'react'
import { BadgeCheck } from 'lucide-react'

import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * 官方汤的认证标记：一枚红章图标 + 「官方」二字。
 * 光一枚图标太隐晦，补上文字让标记一眼可读；title（鼠标悬停）再交代一次。
 */
export function OfficialMark({ className }: { className?: string }) {
  const { t } = useI18n()
  return (
    <span
      title={t('官方')}
      className={cn('inline-flex shrink-0 items-center gap-1 text-stamp', className)}
    >
      <BadgeCheck className="size-3.5" aria-hidden />
      <span>{t('官方')}</span>
    </span>
  )
}

/** 难度：三颗点 + 文字。点让人一眼比较深浅，字留给读屏和不熟悉的人。 */
export function Difficulty({ value, className }: { value: string; className?: string }) {
  const { t } = useI18n()
  const level = value === '简单' ? 1 : value === '困难' ? 3 : 2
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.14em]',
        level === 3 ? 'text-stamp' : 'text-muted-foreground',
        className,
      )}
    >
      <span className="difficulty-dots" aria-hidden>
        {[1, 2, 3].map((dot) => (
          <i key={dot} data-on={dot <= level || undefined} />
        ))}
      </span>
      {t(value)}
    </span>
  )
}

export function PageShell({
  label,
  title,
  meta,
  lead,
  wide = false,
  children,
}: {
  /** 可以不传：那一页把标记放到正文的元信息行里了 */
  label?: ReactNode
  title: string
  meta?: ReactNode
  /** 标题下的一句导语 */
  lead?: ReactNode
  /** 列表类页面（题库、每日）用宽版，表单和长文保持阅读宽度 */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn('mx-auto w-full px-5 py-10 sm:px-8 sm:py-14', wide ? 'max-w-6xl' : 'max-w-3xl')}
    >
      <header className="animate-rise-in">
        {/* flex-wrap：meta 太长时换到下一行，而不是把 label 挤成「官方 / 汤」两行 */}
        {label || meta ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {label ? <span className="eyebrow">{label}</span> : null}
            {meta}
          </div>
        ) : null}
        <h1
          className={cn(
            'mt-4 font-serif leading-[1.1] font-semibold tracking-tight',
            wide ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl',
          )}
        >
          {title}
        </h1>
        {lead ? (
          <div className="mt-4 max-w-2xl font-serif text-[15px] leading-8 text-foreground/75">
            {lead}
          </div>
        ) : null}
        <div className="mt-6 flex items-center gap-2" aria-hidden>
          <span className="h-[3px] w-10 bg-stamp" />
          <span className="h-px flex-1 bg-foreground/70" />
        </div>
      </header>
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground">
        {label}
        {hint ? <span className="ml-2 tracking-normal opacity-60">{hint}</span> : null}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

export const inputClass =
  'w-full border border-foreground/25 bg-sheet px-3.5 py-2.5 font-serif text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground focus:shadow-[0_0_0_3px_var(--stamp-soft)] disabled:opacity-50'

export function Notice({
  tone = 'ink',
  children,
}: {
  tone?: 'ink' | 'stamp' | 'good'
  children: ReactNode
}) {
  const tones = {
    ink: 'border-l-foreground/40 text-foreground/75',
    stamp: 'border-l-stamp text-stamp',
    good: 'border-l-[var(--v-yes)] text-[var(--v-yes)]',
  }
  return (
    <p
      className={cn(
        'border-l-2 bg-sheet px-4 py-3 font-mono text-[11px] leading-6 shadow-[var(--shadow-sheet)]',
        tones[tone],
      )}
    >
      {children}
    </p>
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: 'primary' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
}) {
  const variants = {
    primary:
      'bg-foreground text-background shadow-[0_6px_16px_-8px_rgba(23,21,15,0.6)] hover:-translate-y-px hover:bg-stamp hover:text-[#fbf6ec]',
    outline: 'border border-foreground/80 hover:bg-foreground hover:text-background',
    ghost: 'text-muted-foreground hover:text-foreground',
  }
  const sizes = {
    sm: 'min-h-8 px-3 py-1.5 text-[10px]',
    md: 'min-h-11 px-5 py-2.5 text-[11px]',
  }
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-mono font-bold tracking-[0.18em] transition-[color,background-color,transform,box-shadow] duration-200 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none',
        variants[variant],
        sizes[size],
        className,
      )}
    />
  )
}

/** 作者里程碑徽章：一排小戳。文案 key 由服务端给（中文），这里只负责翻。 */
export function Badges({ badges, className }: { badges: string[]; className?: string }) {
  const { t } = useI18n()
  if (!badges.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {badges.map((badge) => (
        <span
          key={badge}
          className="border border-stamp/60 px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-stamp"
        >
          {t(badge)}
        </span>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 border border-dashed border-foreground/25 bg-sheet/50 px-4 py-10 text-center font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
      {children}
    </p>
  )
}
