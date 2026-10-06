import { useState } from 'react'
import { Check, Loader2, Mail } from 'lucide-react'

import { Button, Field, Notice, PageShell, inputClass } from '@/components/Bits'
import { requestLoginCode, verifyLoginCode, type AuthUser } from '@/lib/auth-client'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function LoginPage({ onDone }: { onDone: (user: AuthUser) => void }) {
  const { t, locale } = useI18n()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      const result = await requestLoginCode(email.trim(), locale)
      setSent(true)
      setDevCode(result.code ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('发送失败'))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      onDone(await verifyLoginCode(email.trim(), code.trim()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('登录失败'))
    } finally {
      setBusy(false)
    }
  }

  const step = sent ? 2 : 1
  return (
    <PageShell label={t('登录')} title={t('邮箱验证码登录')}>
      <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_13rem] md:gap-12">
        <div className="sheet-stack">
          <div className="sheet p-6 sm:p-8">
            <ol className="flex items-center gap-3 font-mono text-[10px] tracking-[0.18em]">
              {[t('邮箱'), t('验证码')].map((label, index) => (
                <li key={label} className="flex items-center gap-3">
                  {index ? <span aria-hidden className="h-px w-8 bg-foreground/20" /> : null}
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full tabular-nums transition-colors',
                      index + 1 < step
                        ? 'bg-[var(--v-yes)] text-background'
                        : index + 1 === step
                          ? 'bg-stamp text-[#fbf6ec]'
                          : 'border border-foreground/25 text-muted-foreground',
                    )}
                  >
                    {index + 1 < step ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span
                    className={index + 1 === step ? 'text-foreground' : 'text-muted-foreground'}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-8 space-y-6">
              <Field label={t('邮箱')}>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    disabled={sent}
                    placeholder="you@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !sent) void sendCode()
                    }}
                    className={cn(inputClass, 'py-3 pl-10')}
                  />
                </div>
              </Field>

              {sent ? (
                <div className="animate-rise-in">
                  <Field label={t('验证码')} hint={t('10 分钟内有效')}>
                    <input
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      maxLength={6}
                      placeholder="000000"
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void submit()
                      }}
                      className={cn(
                        inputClass,
                        'py-3 text-center font-mono text-2xl tracking-[0.6em]',
                      )}
                    />
                  </Field>
                </div>
              ) : null}

              {devCode ? (
                <Notice>{t('开发模式：验证码是 {code}', { code: devCode })}</Notice>
              ) : null}
              {error ? <Notice tone="stamp">{error}</Notice> : null}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {sent ? (
                  <>
                    <Button onClick={() => void submit()} disabled={busy || code.length !== 6}>
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {t('登录')}
                    </Button>
                    <Button variant="ghost" onClick={() => void sendCode()} disabled={busy}>
                      {t('重新发送')}
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => void sendCode()} disabled={busy || !email.includes('@')}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {t('发送验证码')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="order-first flex flex-row items-start gap-4 md:order-none md:flex-col md:pt-4">
          <span
            aria-hidden
            className="seal size-10 shrink-0 rotate-[-4deg] text-xl md:size-12 md:text-2xl"
          >
            汤
          </span>
          <p className="font-serif text-[14px] leading-7 text-foreground/75">
            {t(
              '不需要密码。填邮箱收一封 6 位验证码，验证后就能上传自己的海龟汤、管理题库和作者主页。',
            )}
          </p>
        </aside>
      </div>
    </PageShell>
  )
}
