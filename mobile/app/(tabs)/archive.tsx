import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { Alert, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { STATUS_LABEL } from '@turtle-soup/client-core/archive'
import { Button, Card, Copy, Notice, Page, Title } from '../../src/components/ui'
import { useRuntime } from '../../src/platform/context'
export default function Archive() {
  const runtime = useRuntime()
  const { t } = runtime
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const sync = runtime.sync.getSnapshot()
  return (
    <Page scroll={false}>
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, paddingBottom: 32 }}
        data={[...runtime.games].sort((a, b) => b.updatedAt - a.updatedAt)}
        keyExtractor={(game) => game.id}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 20 }}>
            <Title>{t('档案室')}</Title>
            <Copy>
              {runtime.user
                ? t('登录后同步到账号，随时继续或回看。')
                : t('游客进度保存在这台设备上')}
            </Copy>
            {!['local', 'synced', 'syncing'].includes(sync.status) ? (
              <Notice
                text={
                  sync.status === 'storage'
                    ? '进度尚未保存，请重试'
                    : '云存档暂未同步，本机进度已保留'
                }
                retry={runtime.resume}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={<Copy>{t('这里会保存你调查过的每一碗汤。')}</Copy>}
        renderItem={({ item }) => (
          <View style={{ paddingBottom: 12 }}>
            <Card>
              <Copy>
                {t(STATUS_LABEL[item.status])} · {item.turnCount} {t('轮')}
              </Copy>
              <Title>{item.title}</Title>
              <Button
                title={t(item.status === 'active' ? '继续推理' : '查看记录')}
                onPress={() => router.push({ pathname: '/game/[id]', params: { id: item.id } })}
              />
              <Button
                secondary
                title={t('删除')}
                onPress={() =>
                  Alert.alert(t('删除这份档案？'), t('这会删除当前账号的这份记录。'), [
                    { text: t('取消'), style: 'cancel' },
                    {
                      text: t('删除'),
                      style: 'destructive',
                      onPress: () => runtime.remove(item.id),
                    },
                  ])
                }
              />
            </Card>
          </View>
        )}
      />
    </Page>
  )
}
