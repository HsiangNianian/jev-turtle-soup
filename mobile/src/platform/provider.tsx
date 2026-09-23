import { useEffect, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import * as Network from 'expo-network'
import { NativeRuntime } from './runtime'
import { RuntimeContext } from './context'

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(() => new NativeRuntime())
  useEffect(() => {
    void runtime.start()
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') runtime.resume()
    })
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected) runtime.resume()
    })
    return () => {
      app.remove()
      network.remove()
    }
  }, [runtime])
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
}
