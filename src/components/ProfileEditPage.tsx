import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button, Field, Notice, PageShell, inputClass } from '@/components/Bits'
import { navigate } from '@/lib/router'
import {
  getMyProfile,
  isCoolingDown,
  PROFILE_FIELD_COOLDOWN_MS,
  updateMyProfile,
  HANDLE_COOLDOWN_MS,
  type Profile,
} from '@/lib/library-client'
import { renderInline } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

/** 冷却中还差几天可改：把「下次可改日期」写清楚，比只禁用输入框友好。 */
function cooldownHint(
  changedAt: number | null,
  windowMs: number,
  formatDate: (value: number) => string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (!isCoolingDown(changedAt, windowMs)) return null
  const readyAt = (changedAt as number) + windowMs
  return t(
    windowMs === HANDLE_COOLDOWN_MS
      ? '每年可改一次 · 下次可改 {date}'
      : '每 30 天可改一次 · 下次可改 {date}',
    {
      date: formatDate(readyAt),
    },
  )
}

export function ProfileEditPage() {
  const { t, formatDate } = useI18n()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [profilePublic, setProfilePublic] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getMyProfile()
      .then((next) => {
        setProfile(next)
        setDisplayName(next.displayName)
        setHandle(next.handle)
        setBio(next.bio)
        setProfilePublic(next.profilePublic)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : t('加载失败')),
      )
  }, [t])

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await updateMyProfile({ displayName, handle, bio, profilePublic })
      setProfile(next)
      setHandle(next.handle)
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const nameHint = cooldownHint(
    profile?.displayNameChangedAt ?? null,
    PROFILE_FIELD_COOLDOWN_MS,
    formatDate,
    t,
  )
  const handleHint = cooldownHint(
    profile?.handleChangedAt ?? null,
    HANDLE_COOLDOWN_MS,
    formatDate,
    t,
  )
  const bioHint = cooldownHint(
    profile?.bioChangedAt ?? null,
    PROFILE_FIELD_COOLDOWN_MS,
    formatDate,
    t,
  )

  if (!profile && !error) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <PageShell label={t('编辑资料')} title={t('作者资料')}>
      <div className="sheet mt-8 space-y-7 p-5 sm:p-8">
        <div className="flex items-center gap-4 border-b border-dashed border-foreground/15 pb-6">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-foreground font-serif text-xl text-background ring-4 ring-stamp-soft"
          >
            {(displayName.trim() || '?').slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-serif text-lg font-semibold">
              {displayName.trim() || t('昵称')}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] tracking-[0.12em] text-muted-foreground">
              /u/{handle || '…'}
            </div>
          </div>
        </div>

        <Field label={t('昵称')} hint={nameHint ?? t('最多 24 字')}>
          <input
            value={displayName}
            maxLength={24}
            disabled={Boolean(nameHint)}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={t('主页地址')} hint={handleHint ?? t('3-20 位小写字母、数字或连字符')}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-mono text-[12px] text-muted-foreground">
              /u/
            </span>
            <input
              value={handle}
              maxLength={20}
              disabled={Boolean(handleHint)}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
              className={`${inputClass} pl-10 font-mono`}
            />
          </div>
        </Field>

        <Field label={t('个人简介')} hint={bioHint ?? t('最多 200 字')}>
          <textarea
            value={bio}
            rows={4}
            maxLength={200}
            disabled={Boolean(bioHint)}
            onChange={(event) => setBio(event.target.value)}
            placeholder={t('想说什么都行，比如你的出题偏好。')}
            className={`${inputClass} resize-none leading-7`}
          />
          <span className="mt-2 block font-mono text-[10px] leading-5 tracking-[0.12em] text-muted-foreground">
            {t(
              '支持 **加粗**、*斜体*、~~删除线~~、[文字](链接)，链接和网址会自动变成可点的站外链接。',
            )}
          </span>
          {bio.trim() ? (
            <span className="mt-3 block border-l-2 border-stamp/50 bg-background/60 px-3 py-2 font-serif text-[14px] leading-7 text-foreground/80">
              {renderInline(bio)}
            </span>
          ) : null}
        </Field>

        <button
          type="button"
          role="switch"
          aria-checked={profilePublic}
          onClick={() => setProfilePublic((value) => !value)}
          className="flex w-full items-center gap-4 border border-foreground/15 bg-background/50 px-4 py-3.5 text-left transition-colors hover:border-foreground/40"
        >
          <span
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              profilePublic ? 'bg-[var(--v-yes)]' : 'bg-foreground/20',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform duration-200',
                profilePublic && 'translate-x-5',
              )}
            />
          </span>
          <span className="min-w-0">
            <span className="block font-serif text-[14px]">{t('公开我的主页')}</span>
            <span className="mt-0.5 block font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
              {t('关闭后别人打不开 /u/{handle}，你的公开题也不会列出来', {
                handle: handle || '…',
              })}
            </span>
          </span>
        </button>

        {error ? <Notice tone="stamp">{error}</Notice> : null}
        {saved ? <Notice tone="good">{t('已保存。')}</Notice> : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-foreground/15 pt-6">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('保存')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/me')}>
            {t('返回我的题库')}
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
