import { useAction } from '../../src/components/hooks'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useHeaderHeight } from 'expo-router/build/react-navigation/elements'
import type { ChatMessage } from '@turtle-soup/client-core/types'
import { translate, verdictLabels } from '@turtle-soup/client-core/i18n'
import { STATUS_LABEL } from '@turtle-soup/client-core/archive'
import { Button, Copy, Field, Notice, Page } from '../../src/components/ui'
import { usePalette, useRuntime } from '../../src/platform/context'

export default function Game() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <GameScreen key={id} id={id} />
}
function GameScreen({ id }: { id: string }) {
  const runtime = useRuntime()
  const c = usePalette()
  const router = useRouter()
  const { t } = runtime
  const game = runtime.game(id)
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
  const list = useRef<FlashListRef<ChatMessage>>(null)
  const atBottom = useRef(true)
  const initialScroll = useRef(false)
  const [unread, setUnread] = useState(false)
  const [text, setText] = useState(game?.draft ?? '')
  const lastId = game?.messages.at(-1)?.id
  const { busy, perform } = useAction()
  useEffect(() => {
    return () => runtime.interrupt(id)
  }, [id, runtime])
  useEffect(() => {
    if (atBottom.current) list.current?.scrollToEnd({ animated: initialScroll.current })
    else setUnread(true)
  }, [lastId])
  if (!game)
    return (
      <Page>
        <Notice text="这份档案已删除或属于其他账号" />
        <Button title={t('返回档案')} onPress={() => router.replace('/(tabs)/archive')} />
      </Page>
    )
  const pending = game.pendingAsk
  const sending = pending?.state === 'sending'
  const finished = game.status !== 'active'
  return (
    <Page scroll={false}>
      <Stack.Screen
        options={{
          title: game.title,
          headerRight: () => (
            <Button
              secondary
              title={t('案卷')}
              testID="open-case"
              onPress={() => router.push({ pathname: '/case/[id]', params: { id } })}
            />
          ),
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
        style={{ flex: 1 }}
      >
        <FlashList
          ref={list}
          data={game.messages}
          keyExtractor={(item) => item.id}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 18 }}
          onLoad={() => {
            list.current?.scrollToEnd({ animated: false })
            initialScroll.current = true
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
            atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100
            if (atBottom.current) setUnread(false)
          }}
          scrollEventThrottle={32}
          onContentSizeChange={() => {
            if (atBottom.current) list.current?.scrollToEnd({ animated: initialScroll.current })
          }}
          ListHeaderComponent={
            <View
              style={{
                borderBottomWidth: 1,
                borderColor: c.line,
                paddingBottom: 18,
                marginBottom: 20,
              }}
            >
              <Copy style={{ fontSize: 14, color: c.muted }}>
                {t(STATUS_LABEL[game.status])} · {game.turnCount} {t('轮')}
              </Copy>
              <Copy numberOfLines={4} style={{ marginTop: 12 }}>
                {game.surface}
              </Copy>
            </View>
          }
          renderItem={({ item }) => (
            <View
              testID={item.role === 'host' ? 'host-message' : 'player-message'}
              style={{
                marginBottom: 18,
                alignSelf: item.role === 'player' ? 'flex-end' : 'stretch',
                maxWidth: item.role === 'player' ? '88%' : '100%',
                borderRadius: 14,
                padding: 16,
                backgroundColor: item.role === 'player' ? c.card : 'transparent',
                borderWidth: item.role === 'player' ? 1 : 0,
                borderColor: c.line,
              }}
            >
              <Copy style={{ color: c.muted, fontSize: 12, marginBottom: 5 }}>
                {item.role === 'host' ? 'JEV' : t('你')}
              </Copy>
              {item.tone === 'verdict' && item.verdict && verdictLabels[item.verdict] ? (
                <Copy
                  testID="host-verdict"
                  style={{
                    fontSize: 23,
                    fontWeight: '700',
                    color: item.verdict === 'yes' ? c.yes : c.accent,
                  }}
                >
                  {translate(item.replyLocale ?? runtime.locale, verdictLabels[item.verdict])}
                </Copy>
              ) : (
                <Copy selectable style={{ color: item.tone === 'error' ? c.accent : c.text }}>
                  {item.text}
                </Copy>
              )}
            </View>
          )}
        />
        {unread ? (
          <Button
            title={t('查看新消息')}
            secondary
            onPress={() => {
              atBottom.current = true
              setUnread(false)
              list.current?.scrollToEnd({ animated: true })
            }}
          />
        ) : null}
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 12),
            gap: 10,
            backgroundColor: c.background,
            borderTopWidth: 1,
            borderColor: c.line,
          }}
        >
          {runtime.store.storageError ? (
            <Notice text="进度尚未保存，请重试" retry={runtime.resume} />
          ) : null}
          {pending && !sending ? (
            <Notice
              text={pending.error || '上次提问已中断，问题已保留'}
              retry={() => void perform(() => runtime.send(id, '', true))}
            />
          ) : null}
          {sending ? <Copy accessibilityLiveRegion="polite">{t('主持人正在思考…')}</Copy> : null}
          {finished ? (
            <Button
              title={t(game.status === 'abandoned' ? '查看案卷' : '查看结案记录')}
              onPress={() => router.push({ pathname: '/case/[id]', params: { id } })}
            />
          ) : (
            <>
              <Field
                testID="question-input"
                accessibilityLabel={t('你的问题')}
                placeholder={t('问一个可以用是或不是回答的问题…')}
                multiline
                value={text}
                onChangeText={(value) => {
                  setText(value)
                  runtime.setDraft(id, value)
                }}
                style={{ maxHeight: 150 }}
                editable={!sending}
                submitBehavior="newline"
              />
              <Button
                testID="send-question"
                title={t('提问')}
                disabled={busy || !!pending || !text.trim() || runtime.store.storageError}
                onPress={() => {
                  const question = text
                  atBottom.current = true
                  void perform(async () => {
                    // Legacy-ID lookup may fail before a question is persisted.
                    const request = runtime.send(id, question)
                    if (runtime.game(id)?.draft === '') setText('')
                    await request
                    setText(runtime.game(id)?.draft ?? question)
                  })
                }}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Page>
  )
}
