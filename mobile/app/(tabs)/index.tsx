import { useResource } from '../../src/components/hooks'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { AppState, View } from 'react-native'
import { useEffect } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { utcToday } from '@turtle-soup/client-core/game'
import { Button, Card, Copy, Loading, Notice, Page, Title } from '../../src/components/ui'
import { useRuntime } from '../../src/platform/context'
export default function Today() {
  const runtime = useRuntime()
  const { t } = runtime
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const resource = useResource((signal) => runtime.api.dailies(signal), [utcToday()])
  const refresh = resource.refresh
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh()
    })
    return () => sub.remove()
  }, [refresh])
  const active = runtime.games
    .filter((g) => g.status === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return (
    <Page scroll={false}>
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, paddingBottom: 32 }}
        data={resource.data?.history ?? []}
        keyExtractor={(item) => item.date}
        ListHeaderComponent={
          <View style={{ gap: 18, paddingBottom: 20 }}>
            <Copy>{t('海龟汤调查局')} / JEV</Copy>
            <Title>{t('今日的一碗汤')}</Title>
            <Copy>{t('从一句疑问开始，慢慢靠近真相。')}</Copy>
            {active ? (
              <Card>
                <Copy>{t('继续上次')}</Copy>
                <Title>{active.title}</Title>
                <Button
                  title={t('继续推理')}
                  testID="continue-game"
                  onPress={() => router.push({ pathname: '/game/[id]', params: { id: active.id } })}
                />
              </Card>
            ) : null}
            {resource.error ? <Notice text={resource.error} retry={resource.refresh} /> : null}
            {resource.loading && !resource.data ? <Loading /> : null}
            {resource.data?.today ? (
              <Card>
                <Copy>
                  {resource.data.today.date} · {t('官方每日汤')}
                </Copy>
                <Title>{resource.data.today.title}</Title>
                <Copy>{resource.data.today.surface}</Copy>
                <Button
                  title={t('开始推理')}
                  testID="start-today"
                  onPress={() => {
                    const id = runtime.startGame(resource.data!.today!)
                    router.push({ pathname: '/game/[id]', params: { id } })
                  }}
                />
              </Card>
            ) : !resource.loading ? (
              <Notice text="今天的汤还在准备中" retry={resource.refresh} />
            ) : null}
            <Copy accessibilityRole="header" style={{ fontWeight: '700' }}>
              {t('往期每日汤')}
            </Copy>
          </View>
        }
        onRefresh={resource.refresh}
        refreshing={resource.loading && !!resource.data}
        renderItem={({ item }) => (
          <View style={{ paddingBottom: 12 }}>
            <Card>
              <Copy>
                {item.date} · {item.locale}
              </Copy>
              <Copy style={{ fontSize: 21, fontWeight: '600' }}>{item.title}</Copy>
              <Button
                secondary
                title={t('查看汤面')}
                onPress={() =>
                  router.push({
                    pathname: '/puzzle/[kind]/[id]',
                    params: { kind: 'daily', id: item.date },
                  })
                }
              />
            </Card>
          </View>
        )}
      />
    </Page>
  )
}
