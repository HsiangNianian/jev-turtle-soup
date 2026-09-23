import { en } from './locales/en'
import { ja } from './locales/ja'
import type { Locale } from './public-types'
import { mobileCopy } from './mobile-copy'
export type { Locale } from './public-types'
const dictionaries: Record<Locale, Record<string, string>> = { 'zh-CN': {}, en, ja }
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const value =
    (locale === 'zh-CN' ? undefined : mobileCopy[key]?.[locale === 'en' ? 0 : 1]) ??
    dictionaries[locale][key] ??
    key
  return params
    ? value.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    : value
}
export const verdictLabels: Record<string, string> = {
  yes: '是',
  no: '不是',
  partly: '是，也不是',
  irrelevant: '无关',
  solved: '已结案',
}
