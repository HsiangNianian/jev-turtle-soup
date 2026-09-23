import { useAction } from '../../src/components/hooks'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Alert, Share, View } from 'react-native'
import { buildLedger, shareTarget, winningConclusion } from '@turtle-soup/client-core/archive'
import { isDailyLocked } from '@turtle-soup/client-core/game'
import { verdictLabels } from '@turtle-soup/client-core/i18n'
import { Button, Card, Copy, Page, Title } from '../../src/components/ui'
import { useRuntime } from '../../src/platform/context'
export default function Case() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runtime = useRuntime()
  const { t } = runtime
  const router = useRouter()
  const game = runtime.game(id)
  const { busy, perform } = useAction()
  if (!game)
    return (
      <Page>
        <Copy>{t('找不到这份档案')}</Copy>
      </Page>
    )
  const target = shareTarget(game)
  const active = game.status === 'active'
  const locked = isDailyLocked(game)
  return (
    <Page scroll={false}>
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 22, paddingBottom: 40 }}
        data={buildLedger(game.messages)}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ gap: 18, paddingBottom: 20 }}>
            <Title>{game.title}</Title>
            <Copy>{game.surface}</Copy>
            {game.sourceLocale ? (
              <Copy>
                {t('原作语言')} · {game.sourceLocale}
              </Copy>
            ) : null}
            <Copy>
              {game.difficulty} · {game.turnCount} {t('轮')}
              {game.closeness !== null ? ` · ${t('接近度')} ${Math.round(game.closeness)}%` : ''}
            </Copy>
            {game.revealed ? (
              <Card>
                <Title>{t('汤底')}</Title>
                {game.solved ? (
                  <>
                    <Copy>{t('你的结论')}</Copy>
                    <Copy>{winningConclusion(game.messages)}</Copy>
                  </>
                ) : null}
                <Copy selectable>{game.truth || t('汤底暂未载入')}</Copy>
                {!game.truth ? (
                  <Button
                    secondary
                    disabled={busy}
                    title={t('重新加载汤底')}
                    onPress={() => void perform(() => runtime.reveal(id))}
                  />
                ) : null}
              </Card>
            ) : null}
            {active ? (
              <>
                <Button
                  secondary
                  disabled={busy || !!game.pendingAsk}
                  title={t('给我一点提示')}
                  onPress={() => {
                    router.back()
                    void perform(() => runtime.send(id, t('给我一点提示吧。')))
                  }}
                />
                <Button
                  secondary
                  disabled={busy || !!game.pendingAsk || locked}
                  title={t(locked ? '今日汤明天解锁' : '揭晓汤底')}
                  onPress={() =>
                    Alert.alert(t('揭晓汤底？'), t('揭晓后将结束本局推理。'), [
                      { text: t('取消'), style: 'cancel' },
                      { text: t('揭晓'), onPress: () => void perform(() => runtime.reveal(id)) },
                    ])
                  }
                />
                <Button
                  secondary
                  title={t('中止本案')}
                  onPress={() =>
                    Alert.alert(t('中止本案？'), t('记录会保留，但不能继续提问。'), [
                      { text: t('取消'), style: 'cancel' },
                      {
                        text: t('中止'),
                        style: 'destructive',
                        onPress: () => {
                          runtime.abandon(id)
                          router.back()
                        },
                      },
                    ])
                  }
                />
              </>
            ) : null}
            {target ? (
              <Button
                secondary
                title={t('分享这碗汤')}
                onPress={() =>
                  void perform(() =>
                    Share.share({
                      title: target.title,
                      message: `${target.title}\nhttps://hgt.mmstudio.games${target.path}`,
                    }),
                  )
                }
              />
            ) : null}
            <Button
              secondary
              title={t('怎么玩')}
              onPress={() =>
                Alert.alert(
                  t('怎么玩'),
                  t(
                    '根据汤面提问，用是非问题缩小范围。确定的回答会进入已知结论；信息不足时主持人会请你澄清。整理出完整经过后，直接说出你的结论。',
                  ),
                )
              }
            />
            <Button
              secondary
              title={t('反馈问题')}
              onPress={() => router.replace({ pathname: '/report/[id]', params: { id } })}
            />
            <Copy accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>
              {t('已知结论')}
            </Copy>
          </View>
        }
        ListEmptyComponent={<Copy>{t('确定的回答会记录在这里。')}</Copy>}
        renderItem={({ item }) => (
          <View style={{ gap: 5, paddingVertical: 12 }}>
            <Copy>{item.question}</Copy>
            <Copy style={{ fontWeight: '700' }}>
              {t(verdictLabels[item.verdict] ?? item.verdict)}
            </Copy>
          </View>
        )}
      />
    </Page>
  )
}
