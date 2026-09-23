import type { ReportSnapshotRead } from '../../shared/report-snapshot'

const NOTICES = {
  trimmed: '快照较长，已优先保留最近的完整消息；部分较早消息或判读明细已省略。',
  recovered: '旧快照已被截断，仅恢复了截断前的完整内容；后续对话可能缺失。',
  corrupt: '快照已损坏，无法恢复完整内容。可展开查看保存下来的原文。',
  missing: '这条反馈没有可用的快照。',
}

export function ReportSnapshot({ snapshot, snapshotStatus, snapshotRaw }: ReportSnapshotRead) {
  const notice = snapshotStatus === 'complete' ? null : NOTICES[snapshotStatus]
  return (
    <div className="space-y-2">
      {notice ? (
        <p className="font-mono text-[11px] leading-5 text-muted-foreground">{notice}</p>
      ) : null}
      {snapshot != null ? (
        <details>
          <summary className="w-fit cursor-pointer font-mono text-[10px] tracking-[0.14em] text-muted-foreground/60 hover:text-muted-foreground">
            对局快照{snapshotStatus === 'recovered' ? '（部分恢复）' : ''}
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto border border-foreground/20 bg-card p-3 font-mono text-[10px] leading-5 text-muted-foreground">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </details>
      ) : null}
      {snapshotRaw ? (
        <details>
          <summary className="w-fit cursor-pointer font-mono text-[10px] text-muted-foreground/60 hover:text-muted-foreground">
            查看损坏快照原文
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all border border-foreground/20 bg-card p-3 font-mono text-[10px] leading-5 text-muted-foreground">
            {snapshotRaw}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
