import { createContext, useContext } from 'react'

import { en } from '@/locales/en'
import { ja } from '@/locales/ja'

export const LOCALES = ['zh-CN', 'en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_LABELS: Record<Locale, { short: string; name: string }> = {
  'zh-CN': { short: '中', name: '简体中文' },
  en: { short: 'EN', name: 'English' },
  ja: { short: '日', name: '日本語' },
}

/** 中文原文即 key，字典只需要放译文；缺译文时自动回落到中文。 */
export const DICTS: Record<Locale, Record<string, string>> = {
  'zh-CN': {},
  en,
  ja,
}

export const LOCALE_STORAGE_KEY = 'turtle-soup.locale'

export type TranslateParams = Record<string, string | number>

export interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: TranslateParams) => string
  formatDate: (value: number | Date, options?: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number) => string
}

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale
  } catch {
    /* 隐私模式下忽略 */
  }
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const raw of candidates) {
    const lang = (raw || '').toLowerCase()
    if (lang.startsWith('zh')) return 'zh-CN'
    if (lang.startsWith('ja')) return 'ja'
    if (lang.startsWith('en')) return 'en'
  }
  return 'zh-CN'
}

export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** 按指定语言取词，用于「界面中文但玩家用日文提问」这类情况。 */
export function translateFor(locale: Locale, key: string, params?: TranslateParams): string {
  return interpolate(DICTS[locale][key] ?? key, params)
}

export const I18nContext = createContext<I18nValue | null>(null)

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n 必须在 I18nProvider 内使用')
  return value
}
