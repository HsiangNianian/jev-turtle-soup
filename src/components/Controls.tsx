import { useEffect, useRef, useState } from 'react'
import { Check, Moon, Sun } from 'lucide-react'

import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const { t } = useI18n()
  const next = theme === 'dark' ? t('浅色') : t('深色')

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`${t('切换主题')}：${next}`}
      title={`${t('切换主题')}：${next}`}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center transition-opacity hover:opacity-60',
        className,
      )}
    >
      {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  )
}

export function LocaleMenu({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))

  return (
    <div ref={ref} className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('切换语言')}
        title={t('切换语言')}
        className="flex h-9 items-center gap-1.5 px-1.5 transition-opacity hover:opacity-60 sm:h-7"
      >
        <span className="font-bold">{LOCALE_LABELS[locale].short}</span>
      </button>

      {open ? (
        <ul
          role="listbox"
          className="absolute top-full right-0 z-50 mt-1 w-36 border border-foreground/25 bg-popover py-1 shadow-lg"
        >
          {LOCALES.map((code: Locale) => (
            <li key={code}>
              <button
                type="button"
                role="option"
                aria-selected={code === locale}
                onClick={() => {
                  setLocale(code)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] tracking-[0.14em] text-popover-foreground transition-colors hover:bg-accent',
                  code === locale && 'font-bold',
                )}
              >
                <span className="w-8 shrink-0 opacity-70">{LOCALE_LABELS[code].short}</span>
                <span className="min-w-0 flex-1 truncate font-sans tracking-normal">
                  {LOCALE_LABELS[code].name}
                </span>
                {code === locale ? <Check className="size-3 shrink-0" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
