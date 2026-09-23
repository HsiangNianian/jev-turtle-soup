import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { usePalette, useRuntime } from '../../src/platform/context'
export default function Tabs() {
  const c = usePalette()
  const { t } = useRuntime()
  return (
    <NativeTabs tintColor={c.accent} backgroundColor={c.background} labelStyle={{ color: c.muted }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="sun.max" md="today" />
        <NativeTabs.Trigger.Label>{t('今日')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Icon sf="books.vertical" md="menu_book" />
        <NativeTabs.Trigger.Label>{t('题库')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="archive">
        <NativeTabs.Trigger.Icon sf="archivebox" md="inventory_2" />
        <NativeTabs.Trigger.Label>{t('档案')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="me">
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="person" />
        <NativeTabs.Trigger.Label>{t('我的')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
