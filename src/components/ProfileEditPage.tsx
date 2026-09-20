import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button, Field, Notice, PageShell, inputClass } from '@/components/Bits'
import { navigate } from '@/lib/router'
import { getMyProfile, updateMyProfile, type Profile } from '@/lib/library-client'
import { cn } from '@/lib/utils'

export function ProfileEditPage() {
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
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])

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
      setError(caught instanceof Error ? caught.message : '保存失败')
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
    <PageShell label="编辑资料 / PROFILE" title="作者资料">
      <div className="mt-7 space-y-6">
        <Field label="昵称 / NICKNAME" hint="最多 24 字">
          <input
            value={displayName}
            maxLength={24}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="主页地址 / HANDLE" hint="3-20 位小写字母、数字或连字符">
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

        <Field label="个人简介 / BIO" hint="最多 200 字">
          <textarea
            value={bio}
            rows={4}
            maxLength={200}
            onChange={(event) => setBio(event.target.value)}
            placeholder="想说什么都行，比如你的出题偏好。"
            className={`${inputClass} resize-none leading-7`}
          />
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
            <span className="block font-serif text-[14px]">公开我的主页</span>
            <span className="mt-0.5 block font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
              关闭后别人打不开 /u/{handle || '…'}，你的公开题也不会列出来
            </span>
          </span>
        </button>

        {error ? <Notice tone="stamp">{error}</Notice> : null}
        {saved ? <Notice tone="good">已保存。</Notice> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            保存
          </Button>
          <Button variant="ghost" onClick={() => navigate('/me')}>
            返回我的题库
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
