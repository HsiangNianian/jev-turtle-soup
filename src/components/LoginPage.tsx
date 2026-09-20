import { useState } from 'react'
import { Loader2, Mail } from 'lucide-react'

import { Button, Field, Notice, PageShell, inputClass } from '@/components/Bits'
import { requestLoginCode, verifyLoginCode, type AuthUser } from '@/lib/auth-client'

export function LoginPage({ onDone }: { onDone: (user: AuthUser) => void }) {
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
      const result = await requestLoginCode(email.trim())
      setSent(true)
      setDevCode(result.code ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败')
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
      setError(caught instanceof Error ? caught.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell label="登录 / SIGN IN" title="邮箱验证码登录">
      <p className="mt-5 max-w-xl font-serif text-[15px] leading-8 text-foreground/75">
        不需要密码。填邮箱收一封 6 位验证码，验证后就能上传自己的海龟汤、管理题库和作者主页。
      </p>

      <div className="mt-7 space-y-5">
        <Field label="邮箱 / EMAIL">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center border border-foreground/30 bg-card text-muted-foreground">
              <Mail className="size-4" />
            </span>
            <input
              type="email"
              value={email}
              disabled={sent}
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !sent) void sendCode()
              }}
              className={inputClass}
            />
          </div>
        </Field>

        {sent ? (
          <Field label="验证码 / CODE" hint="10 分钟内有效">
            <input
              inputMode="numeric"
              value={code}
              maxLength={6}
              placeholder="000000"
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
              className={`${inputClass} font-mono text-lg tracking-[0.4em]`}
            />
          </Field>
        ) : null}

        {devCode ? <Notice>开发模式：验证码是 {devCode}</Notice> : null}
        {error ? <Notice tone="stamp">{error}</Notice> : null}

        <div className="flex flex-wrap items-center gap-3">
          {sent ? (
            <>
              <Button onClick={() => void submit()} disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                登录
              </Button>
              <Button variant="ghost" onClick={() => void sendCode()} disabled={busy}>
                重新发送
              </Button>
            </>
          ) : (
            <Button onClick={() => void sendCode()} disabled={busy || !email.includes('@')}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              发送验证码
            </Button>
          )}
        </div>
      </div>
    </PageShell>
  )
}
