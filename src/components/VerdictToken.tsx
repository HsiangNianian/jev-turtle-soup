import { useI18n, type Locale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// One-character stamps, not translated words: all locales fit the same small square.
const tokens: Record<string, { glyph: Record<Locale, string>; cls: string; label: string }> = {
  yes: { glyph: { 'zh-CN': '是', en: 'Y', ja: '是' }, cls: 'verdict-yes', label: '是' },
  no: { glyph: { 'zh-CN': '否', en: 'N', ja: '否' }, cls: 'verdict-no', label: '不是' },
  partly: { glyph: { 'zh-CN': '半', en: '~', ja: '半' }, cls: 'verdict-partly', label: '部分正确' },
  irrelevant: {
    glyph: { 'zh-CN': '—', en: '—', ja: '—' },
    cls: 'verdict-irrelevant',
    label: '无关',
  },
  solved: { glyph: { 'zh-CN': '中', en: '✓', ja: '中' }, cls: 'verdict-yes', label: '已破案' },
}

export function VerdictToken({ verdict }: { verdict: string }) {
  const { t, locale } = useI18n()
  const token = tokens[verdict] ?? tokens.irrelevant
  return (
    <span
      className={cn(
        'verdict-token inline-flex h-6 min-w-6 shrink-0 items-center justify-center border px-1 font-mono text-[11px] font-bold',
        token.cls,
      )}
      aria-label={t(token.label)}
      title={t(token.label)}
      data-verdict={verdict}
    >
      {token.glyph[locale]}
    </span>
  )
}
