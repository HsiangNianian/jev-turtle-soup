import { createContext, useContext, useSyncExternalStore } from 'react'
import { useColorScheme } from 'react-native'
import { NativeRuntime } from './runtime'

export const RuntimeContext = createContext<NativeRuntime | null>(null)
export function useRuntime() {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('Missing RuntimeProvider')
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  return runtime
}
export const palette = {
  light: {
    background: '#f2efe6',
    card: '#fffdf7',
    text: '#17150f',
    muted: '#716d62',
    line: '#d8d2c5',
    accent: '#b5342a',
    onAccent: '#ffffff',
    yes: '#326552',
  },
  dark: {
    background: '#14130f',
    card: '#201e18',
    text: '#ece7db',
    muted: '#b1aa9a',
    line: '#403c32',
    accent: '#e0736a',
    onAccent: '#14130f',
    yes: '#8bbea3',
  },
}
export function usePalette() {
  const runtime = useRuntime()
  const system = useColorScheme()
  return palette[
    runtime.theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : runtime.theme
  ]
}
