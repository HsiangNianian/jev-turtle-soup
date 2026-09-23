import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { Alert } from 'react-native'
import { useRuntime } from '../platform/context'

export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencies: unknown[] = [],
) {
  const key = JSON.stringify(dependencies)
  const load = useEffectEvent(loader)
  const [state, setState] = useState<{ key: string; data?: T; error?: string; loading: boolean }>({
    key,
    loading: true,
  })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((v) => v + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted)
        setState((s) => ({ key, ...(s.key === key ? { data: s.data } : {}), loading: true }))
    })
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, loading: false })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((s) => ({
            ...s,
            key,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          }))
      })
    return () => controller.abort()
  }, [key, revision])
  return {
    ...(state.key === key ? state : { loading: true, data: undefined, error: undefined }),
    refresh,
  }
}
export function useAction() {
  const [busy, setBusy] = useState(false)
  const runtime = useRuntime()
  const perform = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (error) {
      Alert.alert(
        runtime.t('暂时无法完成'),
        error instanceof Error ? runtime.t(error.message) : String(error),
      )
    } finally {
      setBusy(false)
    }
  }
  return { busy, perform }
}
