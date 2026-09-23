import { useResource } from '../../src/components/hooks'
import { FlashList } from '@shopify/flash-list'
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Card, Copy, Field, Loading, Notice, Page, Title } from '../../src/components/ui'
import { useRuntime } from '../../src/platform/context'
export default function Library() {
  const runtime = useRuntime()
  const { t } = runtime
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'new' | 'hot' | 'featured'>('new')
  const [limit, setLimit] = useState(20)
  const resource = useResource(
    (signal) => runtime.api.puzzles({ q: query, sort, limit }, signal),
    [query, sort, limit],
  )
  return (
    <Page scroll={false}>
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, paddingBottom: 32 }}
        data={resource.data ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 20 }}>
            <Title>{t('题库')}</Title>
            <Field
              testID="library-search"
              placeholder={t('搜索题目或标签')}
              value={input}
              onChangeText={setInput}
              returnKeyType="search"
              onSubmitEditing={() => {
                setQuery(input.trim())
                setLimit(20)
              }}
            />
            <Button
              title={t('搜索')}
              onPress={() => {
                setQuery(input.trim())
                setLimit(20)
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['new', 'hot', 'featured'] as const).map((value, index) => (
                <Button
                  key={value}
                  secondary={sort !== value}
                  title={t(['最新', '热门', '精选'][index])}
                  onPress={() => {
                    setSort(value)
                    setLimit(20)
                  }}
                />
              ))}
            </View>
            {resource.error ? <Notice text={resource.error} retry={resource.refresh} /> : null}
            {resource.loading && !resource.data ? <Loading /> : null}
          </View>
        }
        ListEmptyComponent={!resource.loading ? <Copy>{t('还没有找到符合条件的汤')}</Copy> : null}
        onRefresh={resource.refresh}
        refreshing={resource.loading && !!resource.data}
        ListFooterComponent={
          resource.data?.length === limit ? (
            <Button
              secondary
              title={t('加载更多')}
              onPress={() => setLimit((value) => value + 20)}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ paddingBottom: 12 }}>
            <Card>
              <Copy>
                {item.owner.displayName} · {item.difficulty}
              </Copy>
              <Title>{item.title}</Title>
              <Copy numberOfLines={3}>{item.surface}</Copy>
              <Button
                secondary
                title={t('查看汤面')}
                onPress={() =>
                  router.push({
                    pathname: '/puzzle/[kind]/[id]',
                    params: { kind: 'library', id: item.id },
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
