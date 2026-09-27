import { useI18n } from '@/lib/i18n'

export function SolveTurnRecords({
  shortest,
  longest,
  teamShortest,
  teamLongest,
}: {
  shortest: number | null | undefined
  longest: number | null | undefined
  teamShortest?: number | null
  teamLongest?: number | null
}) {
  const { t } = useI18n()
  return (
    <div className="mt-8 border-y border-foreground/15 py-4">
      <div className="grid grid-cols-2 gap-4">
        {(
          [
            [t('最短解开'), shortest],
            [t('最长解开'), longest],
          ] as const
        ).map(([label, turns]) => (
          <div key={label}>
            <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">{label}</p>
            <p className="mt-2 font-serif text-xl text-foreground">
              {turns == null ? t('暂无纪录') : t('{turns} 轮', { turns })}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        {t('仅统计已解开对局，作者账号不计入')}
      </p>
      {teamShortest !== undefined || teamLongest !== undefined ? (
        <div className="mt-4 border-t border-dashed border-foreground/20 pt-3">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
            {t('同桌纪录')}
          </p>
          <p className="mt-2 font-serif text-sm">
            {t('最短解开')} {teamShortest == null ? '—' : t('{turns} 轮', { turns: teamShortest })}
            <span className="mx-4 text-muted-foreground/40">/</span>
            {t('最长解开')} {teamLongest == null ? '—' : t('{turns} 轮', { turns: teamLongest })}
          </p>
          <p className="mt-2 font-mono text-[10px] leading-5 text-muted-foreground">
            {t('仅统计共同解开，作者参与过的同桌不计入。')}
          </p>
        </div>
      ) : null}
    </div>
  )
}
