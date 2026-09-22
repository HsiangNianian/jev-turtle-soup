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

export function PageShell({
  label,
  title,
  meta,
  children,
}: {
  /** 可以不传：那一页把标记放到正文的元信息行里了 */
  label?: ReactNode
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      {/* flex-wrap：meta 太长时换到下一行，而不是把 label 挤成「官方 / 汤」两行 */}
      {label || meta ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {label ? (
            <span className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
              {label}
            </span>
          ) : null}
          {meta}
        </div>
      ) : null}
      <h1 className="mt-3 font-serif text-3xl leading-tight font-semibold sm:text-4xl">{title}</h1>
      <div className="mt-5 h-px w-full bg-foreground/70" />
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
      <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
        {label}
        {hint ? <span className="ml-2 tracking-normal opacity-60">{hint}</span> : null}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

export const inputClass =
  'w-full border border-foreground/30 bg-card px-3.5 py-2.5 font-serif text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground disabled:opacity-50'

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
    <p className={cn('border-l-2 bg-card px-4 py-3 font-mono text-[11px] leading-6', tones[tone])}>
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
    primary: 'bg-foreground text-background hover:opacity-85',
    outline: 'border border-foreground hover:bg-foreground hover:text-background',
    ghost: 'text-muted-foreground hover:text-foreground',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-[10px]',
    md: 'px-5 py-2.5 text-[11px]',
  }
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-mono font-bold tracking-[0.18em] transition-colors disabled:opacity-40',
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
    <p className="mt-6 border border-dashed border-foreground/25 px-4 py-8 text-center font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
      {children}
    </p>
  )
}
