import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'TurtleSoup',
  slug: 'turtle-soup',
  scheme: 'turtlesoup',
  version: '0.1.0',
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'games.mmstudio.turtlesoup',
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false, CFBundleDisplayName: '海龟汤调查局' },
  },
  android: { package: 'games.mmstudio.turtlesoup' },
  plugins: ['expo-router', 'expo-secure-store', 'expo-sqlite', 'expo-localization'],
  experiments: { typedRoutes: true },
}
export default config
