import { useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import { Button, Empty, Notice, PageShell, inputClass } from '@/components/Bits'
import { Link } from '@/components/Link'
import { ReportSnapshot } from '@/components/ReportSnapshot'
import {
  addAdmin,
  clearAdminErrors,
  getAdminMetrics,
  deleteAdminError,
  deleteAdminFlag,
  deleteAdminReport,
  listAdminAdmins,
  listAdminErrors,
  listAdminFlags,
  listAdminPuzzles,
  listAdminReports,
  removeAdmin,
  setAdminPuzzleFeatured,
  setAdminReportStatus,
  type AdminMetrics,
  type AdminEntry,
  type AdminError,
  type AdminFlag,
  type AdminPuzzle,
  type AdminReport,
} from '@/lib/admin-client'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * 管理后台。**只有中文** —— 这是内部工具，不是给玩家看的，
 * 不值得为它维护三语；与 /about、编辑部群那类「中文限定」保持一致。
 */

const VERDICT_LABEL: Record<string, string> = {
  yes: '是',
  no: '不是',
  partly: '是，也不是',
  irrelevant: '无关',
  cannot_answer: '无法回答',
}

const REPORT_STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  resolved: '已处理',
  dismissed: '已忽略',
}

function fmt(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

type Tab = 'reports' | 'flags' | 'puzzles' | 'metrics' | 'errors' | 'admins'
const TABS: { key: Tab; label: string }[] = [
  { key: 'reports', label: '玩家反馈' },
  { key: 'flags', label: '判读巡检' },
  { key: 'puzzles', label: '题库精选' },
  { key: 'metrics', label: '社群观察' },
  { key: 'errors', label: '客户端错误' },
  { key: 'admins', label: '管理员' },
]

export function AdminPage() {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('reports')

  return (
    <PageShell label={t('管理后台')} title={t('调查局后台')}>
      <div className="mt-6 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'border px-3.5 py-1.5 font-mono text-[10px] tracking-[0.16em] transition-colors',
              tab === item.key
                ? 'border-foreground bg-foreground text-background'
                : 'border-foreground/30 text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-7">
        {tab === 'reports' ? <ReportsPanel /> : null}
        {tab === 'flags' ? <FlagsPanel /> : null}
        {tab === 'puzzles' ? <PuzzlesPanel /> : null}
        {tab === 'metrics' ? <MetricsPanel /> : null}
        {tab === 'errors' ? <ErrorsPanel /> : null}
        {tab === 'admins' ? <AdminsPanel /> : null}
      </div>
    </PageShell>
  )
}

function Loading() {
  return (
    <div className="mt-10 flex justify-center text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  )
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
      {children}
    </span>
  )
}

function ReportsPanel() {
  const [items, setItems] = useState<AdminReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    listAdminReports()
      .then(setItems)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])
  useEffect(load, [load])

  async function setStatus(report: AdminReport, status: string) {
    setBusy(report.id)
    try {
      await setAdminReportStatus(report.id, status)
      setItems((prev) => (prev ?? []).map((r) => (r.id === report.id ? { ...r, status } : r)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  async function remove(report: AdminReport) {
    if (!window.confirm('删除这条反馈？删除后无法恢复。')) return
    setBusy(report.id)
    try {
      await deleteAdminReport(report.id)
      setItems((prev) => (prev ?? []).filter((r) => r.id !== report.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Notice tone="stamp">{error}</Notice>
  if (!items) return <Loading />
  if (!items.length) return <Empty>还没有收到反馈。</Empty>

  return (
    <ul className="border-t border-foreground/20">
      {items.map((report) => (
        <li key={report.id} className="rule-dashed space-y-2 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={cn(
                'border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em]',
                report.status === 'open'
                  ? 'border-stamp text-stamp'
                  : 'border-foreground/30 text-muted-foreground',
              )}
            >
              {REPORT_STATUS_LABEL[report.status] ?? report.status}
            </span>
            <Meta>
              {report.kind ?? '—'}
              {report.targetType ? ` · ${report.targetType}` : ''}
            </Meta>
            <Meta>{fmt(report.createdAt)}</Meta>
            {report.puzzleTitle ? (
              report.puzzleId ? (
                <Link
                  to={`/library/${report.puzzleId}`}
                  className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground underline decoration-dotted hover:text-foreground"
                >
                  《{report.puzzleTitle}》
                </Link>
              ) : (
                <Meta>《{report.puzzleTitle}》</Meta>
              )
            ) : report.puzzleId ? (
              <Meta>{report.puzzleId}</Meta>
            ) : null}
          </div>

          <p className="font-serif text-[14px] leading-7 whitespace-pre-wrap">{report.note}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Meta>{report.playerKey ?? '匿名'}</Meta>
            <Meta>{report.locale ?? '—'}</Meta>
            {report.targetId ? <Meta>target: {report.targetId}</Meta> : null}
          </div>

          <ReportSnapshot {...report} />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {report.status === 'open' ? (
              <>
                <Button
                  size="sm"
                  disabled={busy === report.id}
                  onClick={() => void setStatus(report, 'resolved')}
                >
                  标记已处理
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === report.id}
                  onClick={() => void setStatus(report, 'dismissed')}
                >
                  标记忽略
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === report.id}
                onClick={() => void setStatus(report, 'open')}
              >
                重新打开
              </Button>
            )}
            <button
              type="button"
              aria-label="删除"
              disabled={busy === report.id}
              onClick={() => void remove(report)}
              className="flex size-8 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function FlagsPanel() {
  const [items, setItems] = useState<AdminFlag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    listAdminFlags()
      .then(setItems)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])

  async function remove(flag: AdminFlag) {
    if (!window.confirm('删除这条巡检记录？')) return
    setBusy(flag.id)
    try {
      await deleteAdminFlag(flag.id)
      setItems((prev) => (prev ?? []).filter((f) => f.id !== flag.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Notice tone="stamp">{error}</Notice>
  if (!items) return <Loading />
  if (!items.length) return <Empty>还没有巡检记录。</Empty>

  return (
    <ul className="border-t border-foreground/20">
      {items.map((flag) => (
        <li key={flag.id} className="rule-dashed space-y-2 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-stamp">
              {VERDICT_LABEL[flag.firstVerdict] ?? flag.firstVerdict}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/60">→</span>
            <span className="font-mono text-[11px] font-bold tracking-[0.1em]">
              {VERDICT_LABEL[flag.secondVerdict] ?? flag.secondVerdict}
            </span>
            <Meta>置信度 {flag.confidence.toFixed(2)}</Meta>
            <Meta>{fmt(flag.createdAt)}</Meta>
            <Link
              to={`/library/${flag.puzzleId}`}
              className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              {flag.puzzleId}
            </Link>
          </div>
          <p className="font-serif text-[14px] leading-7">{flag.question}</p>
          {flag.reason ? (
            <p className="font-mono text-[11px] leading-6 text-muted-foreground">{flag.reason}</p>
          ) : null}
          <div className="pt-1">
            <button
              type="button"
              aria-label="删除"
              disabled={busy === flag.id}
              onClick={() => void remove(flag)}
              className="flex size-8 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function PuzzlesPanel() {
  const [items, setItems] = useState<AdminPuzzle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    listAdminPuzzles()
      .then(setItems)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])

  async function update(puzzle: AdminPuzzle, featured: boolean) {
    setBusy(puzzle.id)
    setError(null)
    try {
      const featuredNote = (notes[puzzle.id] ?? puzzle.featuredNote ?? '').trim()
      if (featured && !featuredNote) throw new Error('请先写一句不含剧透的推荐语')
      await setAdminPuzzleFeatured(puzzle.id, featured, featuredNote)
      setItems((prev) =>
        (prev ?? [])
          .map((item) => (item.id === puzzle.id ? { ...item, featured, featuredNote } : item))
          .sort((a, b) => Number(b.featured) - Number(a.featured)),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  if (!items) return error ? <Notice tone="stamp">{error}</Notice> : <Loading />
  if (!items.length) return <Empty>题库里还没有公开的汤。</Empty>

  return (
    <div>
      {error ? (
        <div className="mb-4">
          <Notice tone="stamp">{error}</Notice>
        </div>
      ) : null}
      <p className="mb-4 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
        选中的汤会在网站和 App 的编辑精选出现。推荐语最多 80 字，不要揭露汤底。
      </p>
      <ul className="border-t border-foreground/20">
        {items.map((puzzle) => (
          <li key={puzzle.id} className="rule-dashed flex flex-wrap items-center gap-3 py-4">
            {puzzle.featured ? (
              <span className="shrink-0 border border-stamp px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-stamp">
                精选
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-serif text-[15px]">{puzzle.title}</span>
              <span className="mt-0.5 block truncate font-serif text-[12px] text-muted-foreground">
                {puzzle.surface}
              </span>
            </span>
            <Meta>@{puzzle.ownerName}</Meta>
            <Meta>
              {puzzle.plays} / {puzzle.solves}
            </Meta>
            <input
              value={notes[puzzle.id] ?? puzzle.featuredNote ?? ''}
              onChange={(event) =>
                setNotes((prev) => ({ ...prev, [puzzle.id]: event.target.value }))
              }
              maxLength={80}
              placeholder="一句不剧透的推荐语"
              aria-label={`《${puzzle.title}》推荐语`}
              className={cn(inputClass, 'w-full sm:w-60')}
            />
            <Button
              size="sm"
              disabled={busy === puzzle.id}
              onClick={() => void update(puzzle, true)}
            >
              {puzzle.featured ? '保存推荐语' : '设为精选'}
            </Button>
            {puzzle.featured ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === puzzle.id}
                onClick={() => void update(puzzle, false)}
              >
                取消精选
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function MetricsPanel() {
  const [data, setData] = useState<AdminMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAdminMetrics()
      .then(setData)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])

  if (error) return <Notice tone="stamp">{error}</Notice>
  if (!data) return <Loading />

  return (
    <div className="space-y-7">
      <p className="font-serif text-sm leading-7 text-muted-foreground">
        最近 {data.days} 天的站内观察。按设备统计，管理员与标记的测试设备不计入新增事件。
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border border-foreground/25 p-4">
          <div className="font-mono text-[10px] text-muted-foreground">玩过第二碗的设备</div>
          <strong className="mt-2 block font-serif text-2xl">{data.secondPuzzlePlayers}</strong>
        </div>
        <div className="border border-foreground/25 p-4">
          <div className="font-mono text-[10px] text-muted-foreground">获得外部留言的原创汤</div>
          <strong className="mt-2 block font-serif text-2xl">
            {data.outsideFeedback.withFeedback} / {data.outsideFeedback.soups}
          </strong>
        </div>
        <div className="border border-foreground/25 p-4">
          <div className="font-mono text-[10px] text-muted-foreground">跨周投稿的作者</div>
          <strong className="mt-2 block font-serif text-2xl">{data.crossWeekAuthors}</strong>
        </div>
      </div>
      <div>
        <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
          进入来源
        </div>
        <ul className="mt-2 border-t border-foreground/20">
          {data.sources.map((row) => (
            <li
              key={`${row.platform}:${row.source}`}
              className="rule-dashed flex justify-between py-2 font-mono text-[11px]"
            >
              <span>
                {row.platform} · {row.source}
              </span>
              <span>{row.entries}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
          每日事件
        </div>
        <ul className="mt-2 border-t border-foreground/20">
          {data.daily.map((row) => (
            <li
              key={`${row.day}:${row.platform}:${row.event}`}
              className="rule-dashed flex justify-between py-2 font-mono text-[11px]"
            >
              <span>
                {row.day} · {row.platform} · {row.event}
              </span>
              <span>{row.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ErrorsPanel() {
  const [items, setItems] = useState<AdminError[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    listAdminErrors()
      .then(setItems)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])
  useEffect(load, [load])

  async function remove(item: AdminError) {
    setBusy(item.hash)
    try {
      await deleteAdminError(item.hash)
      setItems((prev) => (prev ?? []).filter((e) => e.hash !== item.hash))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  async function clearAll() {
    if (!window.confirm('清空全部客户端错误记录？')) return
    setBusy('__all__')
    try {
      await clearAdminErrors()
      setItems([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '清空失败')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Notice tone="stamp">{error}</Notice>
  if (!items) return <Loading />

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          {items.length} 个不同的错误
        </span>
        {items.length ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy === '__all__'}
            onClick={() => void clearAll()}
          >
            清空全部
          </Button>
        ) : null}
      </div>
      {!items.length ? (
        <div className="mt-4">
          <Empty>没有客户端错误。</Empty>
        </div>
      ) : (
        <ul className="mt-4 border-t border-foreground/20">
          {items.map((item) => (
            <li key={item.hash} className="rule-dashed space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="border border-stamp px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums tracking-[0.12em] text-stamp">
                  ×{item.count}
                </span>
                <Meta>{item.source || '—'}</Meta>
                {item.buildId ? <Meta>build {item.buildId}</Meta> : null}
                {item.locale ? <Meta>{item.locale}</Meta> : null}
              </div>
              <p className="font-mono text-[12px] leading-6 break-words">{item.message}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Meta>{item.path || '—'}</Meta>
                <Meta>最后 {fmt(item.lastAt)}</Meta>
                <Meta>首次 {fmt(item.firstAt)}</Meta>
              </div>
              {item.stack ? (
                <details>
                  <summary className="w-fit cursor-pointer font-mono text-[10px] tracking-[0.14em] text-muted-foreground/60 hover:text-muted-foreground">
                    堆栈
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto border border-foreground/20 bg-card p-3 font-mono text-[10px] leading-5 text-muted-foreground">
                    {item.stack}
                  </pre>
                </details>
              ) : null}
              <div className="pt-1">
                <button
                  type="button"
                  aria-label="删除"
                  disabled={busy === item.hash}
                  onClick={() => void remove(item)}
                  className="flex size-8 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AdminsPanel() {
  const [items, setItems] = useState<AdminEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    listAdminAdmins()
      .then(setItems)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = draft.trim()
    if (!value) return
    setBusy('__add__')
    setError(null)
    try {
      const entry = await addAdmin(value)
      setItems((prev) => {
        const rest = (prev ?? []).filter((a) => a.uid !== entry.uid)
        return [...rest, entry]
      })
      setDraft('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '添加失败')
    } finally {
      setBusy(null)
    }
  }

  async function remove(entry: AdminEntry) {
    if (!window.confirm(`移除管理员「${entry.displayName ?? entry.email}」？`)) return
    setBusy(entry.uid)
    setError(null)
    try {
      await removeAdmin(entry.uid)
      setItems((prev) => (prev ?? []).filter((a) => a.uid !== entry.uid))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '移除失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
            添加管理员 · 邮箱或 user id
          </span>
          <input
            className={cn(inputClass, 'mt-2')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="name@example.com 或 f50c1a48-…"
          />
        </label>
        <Button type="submit" disabled={busy === '__add__' || !draft.trim()}>
          添加
        </Button>
      </form>

      {error ? (
        <div className="mt-5">
          <Notice tone="stamp">{error}</Notice>
        </div>
      ) : null}

      {!items ? (
        <Loading />
      ) : !items.length ? (
        <div className="mt-6">
          <Empty>还没有管理员。</Empty>
        </div>
      ) : (
        <ul className="mt-6 border-t border-foreground/20">
          {items.map((entry) => (
            <li key={entry.uid} className="rule-dashed flex flex-wrap items-center gap-3 py-4">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-[15px]">
                  {entry.displayName ?? entry.email ?? entry.uid}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                  {entry.email || '（用户行已不存在）'}
                  {entry.handle ? ` · @${entry.handle}` : ''}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/60">
                  {entry.uid}
                </span>
              </span>
              <Meta>{fmt(entry.createdAt)}</Meta>
              <button
                type="button"
                aria-label="移除"
                disabled={busy === entry.uid}
                onClick={() => void remove(entry)}
                className="flex size-8 shrink-0 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
