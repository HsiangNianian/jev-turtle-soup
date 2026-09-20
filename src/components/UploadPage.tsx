import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button, Field, Notice, PageShell, inputClass } from '@/components/Bits'
import { navigate } from '@/lib/router'
import { createPuzzle } from '@/lib/library-client'
import { cn } from '@/lib/utils'

const DIFFICULTIES = ['简单', '中等', '困难'] as const

export function UploadPage() {
  const [title, setTitle] = useState('')
  const [surface, setSurface] = useState('')
  const [truth, setTruth] = useState('')
  const [hint, setHint] = useState('')
  const [difficulty, setDifficulty] = useState<string>('中等')
  const [tags, setTags] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = title.trim() && surface.trim() && truth.trim()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const created = await createPuzzle({
        title: title.trim(),
        surface: surface.trim(),
        truth: truth.trim(),
        hint: hint.trim(),
        difficulty,
        tags: tags
          .split(/[\s,，]+/)
          .map((tag) => tag.replace(/^#/, '').trim())
          .filter(Boolean),
        visibility,
      })
      navigate(visibility === 'public' ? `/library/${created.id}` : '/me')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell label="上传 / NEW PUZZLE" title="写一碗海龟汤">
      <p className="mt-5 max-w-xl font-serif text-[15px] leading-8 text-foreground/75">
        汤面只写现象、制造悬念；汤底交代真相，并且必须能解释汤面里的每个反常细节。
      </p>

      <div className="mt-7 space-y-6">
        <Field label="标题 / TITLE" hint="最多 40 字">
          <input
            value={title}
            maxLength={40}
            placeholder="例如：红伞"
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="汤面 / SURFACE" hint="最多 200 字">
          <textarea
            value={surface}
            rows={3}
            maxLength={200}
            placeholder="只写现象，不要解释原因。"
            onChange={(event) => setSurface(event.target.value)}
            className={`${inputClass} resize-none leading-7`}
          />
          <span className="mt-1.5 block text-right font-mono text-[10px] text-muted-foreground/60">
            {surface.length} / 200
          </span>
        </Field>

        <Field label="汤底 / TRUTH" hint="最多 2000 字">
          <textarea
            value={truth}
            rows={5}
            maxLength={2000}
            placeholder="完整交代真正发生了什么。"
            onChange={(event) => setTruth(event.target.value)}
            className={`${inputClass} resize-none leading-7`}
          />
        </Field>

        <Field label="提示 / HINT" hint="可选，最多 200 字">
          <input
            value={hint}
            maxLength={200}
            placeholder="玩家求提示时主持人会说这句。"
            onChange={(event) => setHint(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="难度 / DIFFICULTY">
          <span className="flex gap-px">
            {DIFFICULTIES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDifficulty(value)}
                className={cn(
                  'flex-1 border px-3 py-2.5 font-mono text-[11px] tracking-[0.16em] transition-colors',
                  difficulty === value
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-foreground/30 text-muted-foreground hover:text-foreground',
                )}
              >
                {value}
              </button>
            ))}
          </span>
        </Field>

        <Field label="标签 / TAGS" hint="空格或逗号分隔，最多 5 个">
          <input
            value={tags}
            placeholder="密室 雨夜"
            onChange={(event) => setTags(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="可见性 / VISIBILITY">
          <span className="flex gap-px">
            {(
              [
                ['public', '公开到题库'],
                ['private', '只给自己'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setVisibility(value)}
                className={cn(
                  'flex-1 border px-3 py-2.5 font-mono text-[11px] tracking-[0.16em] transition-colors',
                  visibility === value
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-foreground/30 text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </span>
        </Field>

        {error ? <Notice tone="stamp">{error}</Notice> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void submit()} disabled={busy || !ready}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            上传
          </Button>
          <Button variant="ghost" onClick={() => navigate('/me')}>
            返回我的题库
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
