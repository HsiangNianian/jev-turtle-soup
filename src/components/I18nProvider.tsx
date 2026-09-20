import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  DICTS,
  I18nContext,
  LOCALE_STORAGE_KEY,
  detectLocale,
  interpolate,
  type I18nValue,
  type Locale,
} from '@/lib/i18n'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [])

  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[locale]
    return {
      locale,
      setLocale,
      t: (key, params) => interpolate(dict[key] ?? key, params),
      formatDate: (input, options) =>
        new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium' }).format(
          typeof input === 'number' ? new Date(input) : input,
        ),
      formatNumber: (input) => new Intl.NumberFormat(locale).format(input),
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
