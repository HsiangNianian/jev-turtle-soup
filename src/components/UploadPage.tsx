import { useEffect, useState, type KeyboardEvent } from 'react'
import { Loader2 } from 'lucide-react'

import { Button, Field, Notice, PageShell, inputClass } from '@/components/Bits'
import { ClozePicker } from '@/components/ClozePicker'
import { Link } from '@/components/Link'
import { navigate } from '@/lib/router'
import { blankGroups, clozeIssues, composeDoc, editText, parseDoc } from '@/lib/cloze-template'
import { SUPERNATURAL_TAG, createPuzzle, type PuzzleIssue } from '@/lib/library-client'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

const TRUTH_MAX = 2000
const DIFFICULTIES = ['简单', '中等', '困难'] as const
const PRESET_TAGS = [SUPERNATURAL_TAG] as const

/**
 * 草稿存在本机：写到一半被打断、误关标签页，回来还在。
 * 上传成功后清掉。它和「可见性=只给自己」是两件事——那是发出去的私密题，
 * 这是还没发出去的半成品。
 */
const DRAFT_KEY = 'turtle-soup.upload-draft'

interface UploadDraft {
  mode: 'classic' | 'cloze'
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  tags: string
  visibility: 'public' | 'private'
}

function readDraft(): Partial<UploadDraft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Partial<UploadDraft>) : null
  } catch {
    return null
  }
}

const MODES = [
  {
    value: 'classic',
    title: '普通海龟汤',
    desc: '玩家提问，主持人只答「是 / 不是 / 无关」，一步步还原真相。',
  },
  {
    value: 'cloze',
    title: '汤底填空',
    desc: '把汤底里的关键词挖成空格，玩家边提问边猜字、补全故事。',
  },
] as const

/** 体检结论的四种小标签，和《怎么写一碗好汤》里的「常见毛病」同名。 */
const REVIEW_LABEL: Record<string, string> = {
  spoiler: '汤面剧透',
  unexplained: '细节没交代',
  unsolvable: '问不出来',
  no_unique: '没有唯一解',
}

export function UploadPage() {
  const { t, locale } = useI18n()
  // 只读一次草稿，用它给每个字段定初值
  const [draft] = useState(readDraft)
  const [mode, setMode] = useState<'classic' | 'cloze'>(
    draft?.mode === 'cloze' ? 'cloze' : 'classic',
  )
  const [title, setTitle] = useState(draft?.title ?? '')
  const [surface, setSurface] = useState(draft?.surface ?? '')
  const [truth, setTruth] = useState(draft?.truth ?? '')
  const [hint, setHint] = useState(draft?.hint ?? '')
  const [difficulty, setDifficulty] = useState<string>(draft?.difficulty ?? t('中等'))
  const [tags, setTags] = useState(draft?.tags ?? '')
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    draft?.visibility === 'private' ? 'private' : 'public',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 发布前体检的结果：有它就先停在这一屏，让作者看一眼再走
  const [review, setReview] = useState<{
    id: string
    visibility: 'public' | 'private'
    issues: PuzzleIssue[]
  } | null>(null)

  // 每次改动都存一份，随时被打断也不丢
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ mode, title, surface, truth, hint, difficulty, tags, visibility }),
      )
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [mode, title, surface, truth, hint, difficulty, tags, visibility])

  const clozeDoc = parseDoc(truth)
  const clozeOk =
    mode !== 'cloze' ||
    (blankGroups(clozeDoc).length > 0 && clozeIssues(truth, TRUTH_MAX).length === 0)
  const ready = title.trim() && surface.trim() && truth.trim() && clozeOk
  const selectedTags = tags
    .split(/[\s,，]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)

  function chooseMode(next: 'classic' | 'cloze') {
    // 填空的标记只在填空模式里有意义；换回普通模式时把 [[ ]] 去掉，别留在汤底里
    if (next === 'classic' && mode === 'cloze') setTruth(clozeDoc.chars.join(''))
    setMode(next)
  }

  // 单选组的标准键盘操作：方向键在选项间移动并选中，Tab 只停在当前选中的那张
  function onModeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    event.preventDefault()
    const at = MODES.findIndex((item) => item.value === mode)
    const next = MODES[(at + step + MODES.length) % MODES.length]
    chooseMode(next.value)
    event.currentTarget.querySelector<HTMLElement>(`[data-mode="${next.value}"]`)?.focus()
  }

  function toggleTag(tag: string) {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag]
    setTags(next.join(' '))
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const created = await createPuzzle({
        mode,
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
        locale,
      })
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* 隐私模式下忽略 */
      }
      // 体检有问题就先展示，作者看完再决定去哪
      if (created.review?.length) {
        setReview({ id: created.id, visibility, issues: created.review })
        return
      }
      navigate(visibility === 'public' ? `/library/${created.id}` : '/me')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('上传失败'))
    } finally {
      setBusy(false)
    }
  }

  // 体检结果先占一屏：看一眼再决定去哪，不让它埋进别的内容里
  if (review) {
    return (
      <PageShell label={t('上传')} title={t('发布前体检')}>
        <p className="mt-5 max-w-xl font-serif text-[15px] leading-8 text-foreground/75">
          {t('碗已经发出去了。这是 Jev 看出来的几个小问题，下次写的时候可以参考。')}
        </p>
        <ul className="mt-6">
          {review.issues.map((issue, index) => (
            <li
              key={`${issue.kind}-${index}`}
              className="flex items-start gap-3 border-t border-dashed border-foreground/20 py-3"
            >
              <span className="shrink-0 border border-foreground/30 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
                {t(REVIEW_LABEL[issue.kind] ?? issue.kind)}
              </span>
              <span className="font-serif text-[14px] leading-7">{issue.detail}</span>
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button
            onClick={() =>
              navigate(review.visibility === 'public' ? `/library/${review.id}` : '/me')
            }
          >
            {t('知道了，去看看')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setReview(null)
              navigate('/me')
            }}
          >
            {t('回我的题库')}
          </Button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell label={t('上传')} title={t('写一碗海龟汤')}>
      <p className="mt-5 max-w-xl font-serif text-[15px] leading-8 text-foreground/75">
        {t('汤面只写现象、制造悬念；汤底交代真相，并且必须能解释汤面里的每个反常细节。')}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.14em]">
        <Link to="/guide" className="text-stamp transition-opacity hover:opacity-70">
          {t('不会写？看看《怎么写一碗好汤》 →')}
        </Link>
        <span className="text-muted-foreground/60">{t('草稿会自动存在这台设备上')}</span>
      </div>

      <div className="mt-7 space-y-6">
        <div role="radiogroup" aria-labelledby="upload-mode-label" onKeyDown={onModeKeyDown}>
          <span
            id="upload-mode-label"
            className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground"
          >
            {t('玩法')}
          </span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {MODES.map((item) => {
              const active = mode === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-mode={item.value}
                  tabIndex={active ? 0 : -1}
                  onClick={() => chooseMode(item.value)}
                  className={cn(
                    'relative border px-4 py-3 text-left transition-colors outline-none focus-visible:shadow-[0_0_0_3px_var(--stamp-soft)]',
                    active
                      ? 'border-foreground bg-sheet shadow-[inset_3px_0_0_var(--stamp)]'
                      : 'border-foreground/25 text-muted-foreground hover:border-foreground/60 hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'block font-serif text-[15px] font-semibold',
                      active && 'text-foreground',
                    )}
                  >
                    {t(item.title)}
                  </span>
                  <span className="mt-1 block text-xs leading-6">{t(item.desc)}</span>
                </button>
              )
            })}
          </div>
        </div>
        <Field label={t('标题')} hint={t('最多 40 字')}>
          <input
            value={title}
            maxLength={40}
            placeholder={t('例如：红伞')}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={t('汤面')} hint={t('最多 200 字')}>
          <textarea
            value={surface}
            rows={3}
            maxLength={200}
            placeholder={t('只写现象，不要解释原因。')}
            onChange={(event) => setSurface(event.target.value)}
            className={`${inputClass} resize-none leading-7`}
          />
          <span className="mt-1.5 block text-right font-mono text-[10px] text-muted-foreground/60">
            {surface.length} / 200
          </span>
        </Field>

        <div>
          <Field label={t('汤底')} hint={t('最多 2000 字')}>
            <textarea
              value={mode === 'cloze' ? clozeDoc.chars.join('') : truth}
              rows={5}
              maxLength={TRUTH_MAX}
              placeholder={t('完整交代真正发生了什么。')}
              onChange={(event) =>
                setTruth(
                  mode === 'cloze'
                    ? composeDoc(editText(clozeDoc, event.target.value))
                    : event.target.value,
                )
              }
              className={`${inputClass} resize-none leading-7`}
            />
          </Field>
          {mode === 'cloze' ? (
            <ClozePicker value={truth} maxLength={TRUTH_MAX} onChange={setTruth} />
          ) : null}
        </div>

        <Field label={t('提示')} hint={t('可选，最多 200 字')}>
          <input
            value={hint}
            maxLength={200}
            placeholder={t('玩家求提示时主持人会说这句。')}
            onChange={(event) => setHint(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={t('难度')}>
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
                {t(value)}
              </button>
            ))}
          </span>
        </Field>

        <Field label={t('标签')} hint={t('空格或逗号分隔，最多 5 个')}>
          <span className="mb-2 flex flex-wrap gap-2">
            {PRESET_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={cn(
                  'border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] transition-colors',
                  selectedTags.includes(tag)
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-foreground/30 text-muted-foreground hover:text-foreground',
                )}
              >
                {tag}
              </button>
            ))}
            <span className="self-center font-mono text-[10px] tracking-[0.12em] text-muted-foreground/60">
              {t('选中后可以生成／筛选同题材的汤')}
            </span>
          </span>
          <input
            value={tags}
            placeholder={t('密室 雨夜')}
            onChange={(event) => setTags(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={t('可见性')}>
          <span className="flex gap-px">
            {(
              [
                ['public', t('公开到题库')],
                ['private', t('只给自己')],
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
                {t(label)}
              </button>
            ))}
          </span>
        </Field>

        {error ? <Notice tone="stamp">{error}</Notice> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void submit()} disabled={busy || !ready}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('上传')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/me')}>
            {t('返回我的题库')}
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
