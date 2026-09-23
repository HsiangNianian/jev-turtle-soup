import { type ReactNode } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePalette, useRuntime } from '../platform/context'

export function Copy({ children, style, ...props }: TextProps) {
  const colors = usePalette()
  return (
    <Text {...props} style={[styles.copy, { color: colors.text }, style]}>
      {children}
    </Text>
  )
}
export function Title({ children }: { children: ReactNode }) {
  return (
    <Copy accessibilityRole="header" style={styles.title}>
      {children}
    </Copy>
  )
}
export function Button({
  title,
  onPress,
  disabled,
  secondary,
  testID,
}: {
  title: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
  testID?: string
}) {
  const c = usePalette()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? c.card : c.accent,
          borderColor: c.line,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Copy
        style={{ color: secondary ? c.text : c.onAccent, fontWeight: '600', textAlign: 'center' }}
      >
        {title}
      </Copy>
    </Pressable>
  )
}
export function Field(props: TextInputProps) {
  const c = usePalette()
  return (
    <TextInput
      placeholderTextColor={c.muted}
      selectionColor={c.accent}
      {...props}
      style={[
        styles.field,
        { borderColor: c.line, backgroundColor: c.card, color: c.text },
        props.style,
      ]}
    />
  )
}
export function Page({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = usePalette()
  const insets = useSafeAreaInsets()
  if (!scroll) return <View style={{ flex: 1, backgroundColor: c.background }}>{children}</View>
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: c.background }}
      contentContainerStyle={[
        styles.page,
        {
          paddingBottom: insets.bottom + 32,
          paddingTop: Platform.OS === 'android' ? insets.top + 20 : 24,
        },
      ]}
    >
      {children}
    </ScrollView>
  )
}
export function Card({ children }: { children: ReactNode }) {
  const c = usePalette()
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.line }]}>{children}</View>
  )
}
export function Notice({ text, retry }: { text: string; retry?: () => void }) {
  const c = usePalette()
  const { t } = useRuntime()
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { borderColor: c.line }]}>
      <Copy>{t(text)}</Copy>
      {retry ? <Button title={t('重试')} onPress={retry} secondary /> : null}
    </View>
  )
}
export function Loading() {
  const c = usePalette()
  return <ActivityIndicator size="large" color={c.accent} style={{ padding: 32 }} />
}
const styles = StyleSheet.create({
  copy: { fontSize: 16, lineHeight: 25 },
  title: {
    fontSize: 30,
    lineHeight: 39,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    marginBottom: 8,
  },
  page: { padding: 20, gap: 20 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 14 },
  button: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  field: { minHeight: 50, borderRadius: 10, borderWidth: 1, padding: 14, fontSize: 17 },
  notice: { padding: 14, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
})
