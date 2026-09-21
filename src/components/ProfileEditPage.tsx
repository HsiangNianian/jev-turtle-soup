import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button, Field, Notice, PageShell, inputClass } from '@/components/Bits'
import { navigate } from '@/lib/router'
import { getMyProfile, updateMyProfile, type Profile } from '@/lib/library-client'
import { renderInline } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

export function ProfileEditPage() {
  const { t } = useI18n()
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

  if (!profile && !error) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <PageShell label={t('编辑资料 / PROFILE')} title={t('作者资料')}>
      <div className="mt-7 space-y-6">
        <Field label={t('昵称 / NICKNAME')} hint={t('最多 24 字')}>
          <input
            value={displayName}
            maxLength={24}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={t('主页地址 / HANDLE')} hint={t('3-20 位小写字母、数字或连字符')}>
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">/u/</span>
            <input
              value={handle}
              maxLength={20}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
              className={`${inputClass} font-mono`}
            />
          </div>
        </Field>

        <Field label={t('个人简介 / BIO')} hint={t('最多 200 字')}>
          <textarea
            value={bio}
            rows={4}
            maxLength={200}
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
            <span className="mt-2 block border-l-2 border-foreground/25 bg-card px-3 py-2 font-serif text-[14px] leading-7 text-foreground/80">
              {renderInline(bio)}
            </span>
          ) : null}
        </Field>

        <button
          type="button"
          onClick={() => setProfilePublic((value) => !value)}
          className="flex w-full items-center gap-3 border border-foreground/30 bg-card px-4 py-3 text-left transition-colors hover:border-foreground"
        >
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center border',
              profilePublic ? 'border-[var(--v-yes)] bg-[var(--v-yes)]' : 'border-foreground/40',
            )}
          >
            {profilePublic ? <span className="size-1.5 bg-background" /> : null}
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

        <div className="flex flex-wrap items-center gap-3">
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
