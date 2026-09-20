import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageShell({
  label,
  title,
  meta,
  children,
}: {
  label: string
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">{label}</span>
        {meta}
      </div>
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
}: React.ComponentProps<'button'> & { variant?: 'primary' | 'outline' | 'ghost'; size?: 'sm' | 'md' }) {
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

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 border border-dashed border-foreground/25 px-4 py-8 text-center font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
      {children}
    </p>
  )
}
