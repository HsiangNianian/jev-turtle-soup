import { useResource } from '../../src/components/hooks'
import { FlashList } from '@shopify/flash-list'
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ActionSheetIOS, Alert, Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Card, Copy, Field, Loading, Notice, Page, Title } from '../../src/components/ui'
import { useRuntime } from '../../src/platform/context'
import type { LibraryPuzzle } from '@turtle-soup/client-core/public-types'
export default function Library() {
  const [genre, setGenre] = useState<number>()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'new' | 'hot' | 'featured'>('new')
  return (
    <LibraryResults
      key={`${query}:${sort}:${genre}`}
      {...{ query, setQuery, sort, setSort, genre, setGenre }}
    />
  )
}
function LibraryResults({
  query,
  setQuery,
  sort,
  setSort,
  genre,
  setGenre,
}: {
  query: string
  setQuery(value: string): void
  sort: 'new' | 'hot' | 'featured'
  setSort(value: 'new' | 'hot' | 'featured'): void
  genre?: number
  setGenre(value: number | undefined): void
}) {
  const runtime = useRuntime()
  const { t } = runtime
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [input, setInput] = useState(query)
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<LibraryPuzzle[]>([])
  const resource = useResource(
    async (signal) => {
      const data = await runtime.api.puzzles(
        { q: query, sort, genre, limit: 20, offset: page * 20 },
        signal,
      )
      if (!signal.aborted)
        setItems((previous) => [
          ...new Map(
            (page === 0 ? data : [...previous, ...data]).map((item) => [item.id, item]),
          ).values(),
        ])
      return data
    },
    [query, sort, genre, page],
  )
  const refresh = () => {
    if (page === 0) resource.refresh()
    else setPage(0)
  }
  const filters = ['全部题材', '偏本格', '偏变格']
  const chooseGenre = (index: number) => setGenre([undefined, 0, 100][index])
  const openFilter = () => {
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('题材偏好'),
          options: [...filters.map((label) => t(label)), t('取消')],
          cancelButtonIndex: 3,
        },
        (index) => {
          if (index < 3) chooseGenre(index)
        },
      )
    else
      Alert.alert(
        t('题材偏好'),
        t('按题材接近程度排序'),
        filters.map((label, index) => ({ text: t(label), onPress: () => chooseGenre(index) })),
      )
  }
  return (
    <Page scroll={false}>
      <FlashList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, paddingBottom: 32 }}
        data={items}
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
              }}
            />
            <Button
              title={t('搜索')}
              onPress={() => {
                setQuery(input.trim())
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
                  }}
                />
              ))}
            </View>
            <Button
              secondary
              title={t(filters[genre === undefined ? 0 : genre === 0 ? 1 : 2])}
              onPress={openFilter}
            />
            {resource.error ? <Notice text={resource.error} retry={resource.refresh} /> : null}
            {resource.loading && !resource.data ? <Loading /> : null}
          </View>
        }
        ListEmptyComponent={!resource.loading ? <Copy>{t('还没有找到符合条件的汤')}</Copy> : null}
        onRefresh={refresh}
        refreshing={resource.loading && page === 0 && items.length > 0}
        ListFooterComponent={
          resource.loading && page > 0 ? (
            <Loading />
          ) : resource.data?.length === 20 ? (
            <Button
              secondary
              title={t('加载更多')}
              disabled={resource.loading}
              onPress={() => setPage((value) => value + 1)}
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
