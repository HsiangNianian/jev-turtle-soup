import { useEffect, useState } from 'react'
import { Flag, Heart, Trash2 } from 'lucide-react'

import { Link } from '@/components/Link'
import { ShareButton } from '@/components/ShareButton'
import { cn } from '@/lib/utils'
import { formatWhen } from '@/lib/archive'
import {
  fetchSocial,
  postComment,
  removeComment,
  reportComment,
  setSocialLike,
  type SocialComment,
  type SocialKind,
  type SocialPayload,
} from '@/lib/social-client'
import { useI18n } from '@/lib/i18n'
import { trackWebEngagement } from '@/lib/engagement-client'

function CommentRow({
  comment,
  onDelete,
  onReport,
  busy,
}: {
  comment: SocialComment
  onDelete: (comment: SocialComment) => void
  onReport: (comment: SocialComment) => void
  busy: boolean
}) {
  const { t } = useI18n()
  return (
    <li className="rule-dashed flex items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
          {comment.author.handle ? (
            <Link
              to={`/u/${comment.author.handle}`}
              className="text-stamp transition-opacity hover:opacity-70"
            >
              @{comment.author.displayName}
            </Link>
          ) : (
            <span className="text-stamp">@{comment.author.displayName}</span>
          )}
          <span>{formatWhen(comment.createdAt)}</span>
          {comment.mine ? <span className="opacity-70">{t('你')}</span> : null}
        </div>
        <p className="mt-1.5 font-serif text-[14px] leading-7 break-words text-foreground/85">
          {comment.body}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {comment.canDelete ? (
          <button
            type="button"
            disabled={busy}
            aria-label={t('删除这条留言')}
            onClick={() => onDelete(comment)}
            className="flex size-7 items-center justify-center border border-transparent text-muted-foreground/50 transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
        {!comment.mine ? (
          <button
            type="button"
            disabled={busy}
            aria-label={t('举报这条留言')}
            onClick={() => onReport(comment)}
            className="flex size-7 items-center justify-center border border-transparent text-muted-foreground/50 transition-colors hover:border-foreground hover:text-foreground disabled:opacity-40"
          >
            <Flag className="size-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  )
}

export function SocialPanel({
  kind,
  id,
  path,
  title,
  spoilerGate = false,
  initiallyExpanded = false,
}: {
  kind: SocialKind
  id: string
  /** 分享用的站内路径 */
  path: string
  /** 分享标题 */
  title: string
  spoilerGate?: boolean
  initiallyExpanded?: boolean
}) {
  const { t, locale } = useI18n()
  const [social, setSocial] = useState<SocialPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const showDiscussion = expanded || initiallyExpanded

  useEffect(() => {
    if (spoilerGate && initiallyExpanded) trackWebEngagement('discussion_open', id)
  }, [id, initiallyExpanded, spoilerGate])

  useEffect(() => {
    let alive = true
    fetchSocial(kind, id)
      .then((next) => {
        if (alive) {
          setSocial(next)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : t('加载失败'))
      })
    return () => {
      alive = false
    }
  }, [kind, id, t])

  async function toggleLike() {
    if (!social || busy) return
    const next = !social.liked
    const before = { likes: social.likes, liked: social.liked }
    setBusy(true)
    setSocial({ ...social, liked: next, likes: social.likes + (next ? 1 : -1) })
    try {
      const result = await setSocialLike(kind, id, next)
      setSocial((current) => (current ? { ...current, ...result } : current))
    } catch (caught) {
      setSocial((current) => (current ? { ...current, ...before } : current))
      setError(caught instanceof Error ? caught.message : t('操作失败，请稍后再试'))
    } finally {
      setBusy(false)
    }
  }

  async function submitComment() {
    const body = draft.trim()
    if (!body || posting) return
    if (body.length < 2) {
      setComposerError(t('留言太短了，至少写两个字'))
      return
    }
    if (body.length > 300) {
      setComposerError(t('留言最多 300 字'))
      return
    }
    setPosting(true)
    setComposerError(null)
    try {
      const { comment } = await postComment(kind, id, body)
      setSocial((current) =>
        current
          ? { ...current, comments: [comment, ...current.comments], signedIn: true }
          : current,
      )
      setDraft('')
    } catch (caught) {
      setComposerError(caught instanceof Error ? caught.message : t('发表失败，请稍后再试'))
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete(comment: SocialComment) {
    if (!window.confirm(t('删除这条留言？'))) return
    setBusy(true)
    try {
      await removeComment(comment.id)
      setSocial((current) =>
        current
          ? { ...current, comments: current.comments.filter((it) => it.id !== comment.id) }
          : current,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('删除失败'))
    } finally {
      setBusy(false)
    }
  }

  async function handleReport(comment: SocialComment) {
    if (!window.confirm(t('举报这条留言？'))) return
    setBusy(true)
    try {
      await reportComment(comment.id, '', locale)
      setNotice(t('已举报，谢谢。'))
      window.setTimeout(() => setNotice(null), 3000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('举报失败'))
    } finally {
      setBusy(false)
    }
  }

  if (error && !social) {
    return (
      <div className="mt-8 border border-dashed border-foreground/25 px-4 py-6 text-center font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
        {error}
      </div>
    )
  }

  return (
    <div id={kind === 'puzzle' ? 'discussion' : undefined} className="mt-9 scroll-mt-16">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-foreground/25 pt-5">
        <button
          type="button"
          onClick={() => void toggleLike()}
          disabled={busy || !social}
          className={cn(
            'flex items-center gap-1.5 font-mono text-[11px] tracking-[0.16em] transition-colors disabled:opacity-40',
            social?.liked ? 'text-stamp' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Heart className={cn('size-3.5', social?.liked ? 'fill-current' : '')} />
          {social?.liked
            ? t('已赞 {count}', { count: social.likes })
            : t('赞 {count}', { count: social?.likes ?? 0 })}
        </button>
        <ShareButton path={path} title={title} />
        {social ? (
          <span className="ml-auto font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70">
            {t('{count} 条留言', { count: social.comments.length })}
          </span>
        ) : null}
      </div>

      {spoilerGate && !showDiscussion ? (
        <button
          type="button"
          onClick={() => {
            setExpanded(true)
            trackWebEngagement('discussion_open', id)
          }}
          className="mt-6 w-full border border-dashed border-foreground/30 px-4 py-5 text-left font-serif text-[13px] text-muted-foreground hover:text-foreground"
        >
          {t('查看汤友讨论 · 可能含汤底')} →
        </button>
      ) : (
        <>
          <div className="mt-6 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
            {t('留言板')}
          </div>

          {social?.signedIn ? (
            <div className="mt-3 border border-foreground bg-card px-4 py-3">
              <textarea
                value={draft}
                rows={2}
                maxLength={300}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setComposerError(null)
                }}
                placeholder={t('写一条留言……')}
                className="chat-scroll w-full resize-none bg-transparent font-serif text-sm leading-7 outline-none placeholder:text-muted-foreground/60"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void submitComment()}
                  disabled={posting || draft.trim().length < 2}
                  className="bg-foreground px-3.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  {posting ? t('发表中……') : t('发表留言')}
                </button>
                <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground/70">
                  {t('{count}/300', { count: draft.length })}
                </span>
              </div>
              {composerError ? (
                <p className="mt-2 font-mono text-[10px] text-stamp">{composerError}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 border border-dashed border-foreground/25 px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
              {t('留言需要先登录。')}{' '}
              <Link
                to={`/login?next=${encodeURIComponent(kind === 'puzzle' ? `${path}?discussion=1` : path)}`}
                className="text-stamp transition-opacity hover:opacity-70"
              >
                {t('去登录')}
              </Link>
            </p>
          )}

          {notice ? (
            <p className="mt-3 border-l-2 border-l-[var(--v-yes)] bg-card px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-[var(--v-yes)]">
              {notice}
            </p>
          ) : null}
          {error && social ? (
            <p className="mt-3 border-l-2 border-stamp bg-card px-3 py-2 font-mono text-[10px] text-stamp">
              {error}
            </p>
          ) : null}

          {social && !social.comments.length ? (
            <p className="mt-3 border border-dashed border-foreground/25 px-4 py-6 text-center font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
              {t('还没有人留言。')}
            </p>
          ) : null}

          {social?.comments.length ? (
            <ul className="mt-2 border-t border-foreground/20">
              {social.comments.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  busy={busy}
                  onDelete={(item) => void handleDelete(item)}
                  onReport={(item) => void handleReport(item)}
                />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}
