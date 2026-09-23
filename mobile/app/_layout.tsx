import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { usePalette, useRuntime } from '../src/platform/context'
import { RuntimeProvider } from '../src/platform/provider'
import { Loading, Page } from '../src/components/ui'

function Navigation() {
  const c = usePalette()
  const runtime = useRuntime()
  if (!runtime.ready)
    return (
      <Page>
        <Loading />
      </Page>
    )
  return (
    <>
      <StatusBar style={c.background === '#14130f' ? 'light' : 'dark'} />
      <Stack
        key={runtime.owner ?? 'guest'}
        screenOptions={{
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="puzzle/[kind]/[id]" options={{ title: runtime.t('汤面') }} />
        <Stack.Screen name="game/[id]" options={{ title: runtime.t('推理中') }} />
        <Stack.Screen
          name="case/[id]"
          options={{
            title: runtime.t('案卷'),
            presentation: 'formSheet',
            sheetAllowedDetents: [0.5, 1],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="report/[id]"
          options={{
            title: runtime.t('玩家反馈'),
            presentation: 'formSheet',
            sheetAllowedDetents: [0.75, 1],
            sheetGrabberVisible: true,
          }}
        />
      </Stack>
    </>
  )
}
export default function RootLayout() {
  return (
    <RuntimeProvider>
      <Navigation />
    </RuntimeProvider>
  )
}
