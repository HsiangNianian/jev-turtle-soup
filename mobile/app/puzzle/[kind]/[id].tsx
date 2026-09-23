import { useResource } from '../../../src/components/hooks'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { DailyDetail, LibraryPuzzle } from '@turtle-soup/client-core/public-types'
import { Button, Card, Copy, Loading, Notice, Page, Title } from '../../../src/components/ui'
import { useRuntime } from '../../../src/platform/context'
export default function Puzzle() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>()
  const runtime = useRuntime()
  const router = useRouter()
  const resource = useResource<DailyDetail | LibraryPuzzle>(
    (signal) => (kind === 'daily' ? runtime.api.daily(id, signal) : runtime.api.puzzle(id, signal)),
    [kind, id],
  )
  return (
    <Page>
      {resource.loading ? <Loading /> : null}
      {resource.error ? <Notice text={resource.error} retry={resource.refresh} /> : null}
      {resource.data ? (
        <Card>
          <Copy>
            {resource.data.difficulty}
            {'locale' in resource.data ? ` · ${resource.data.locale}` : ''}
          </Copy>
          <Title>{resource.data.title}</Title>
          <Copy>{resource.data.surface}</Copy>
          <Button
            title={runtime.t('开始推理')}
            onPress={() => {
              const gameId = runtime.startGame(resource.data!)
              router.replace({ pathname: '/game/[id]', params: { id: gameId } })
            }}
          />
        </Card>
      ) : null}
    </Page>
  )
}
