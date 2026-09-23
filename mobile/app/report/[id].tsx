import { useAction } from '../../src/components/hooks'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Platform } from 'react-native'
import { Button, Copy, Field, Page, Title } from '../../src/components/ui'
import { useRuntime } from '../../src/platform/context'
export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runtime = useRuntime()
  const { t } = runtime
  const router = useRouter()
  const [note, setNote] = useState('')
  const { busy, perform } = useAction()
  return (
    <Page>
      <Title>{t('哪里不对劲？')}</Title>
      <Copy>{t('描述你遇到的问题，我们会附上这局的问答记录。')}</Copy>
      <Field
        accessibilityLabel={t('反馈内容')}
        multiline
        style={{ minHeight: 160, textAlignVertical: 'top' }}
        value={note}
        onChangeText={setNote}
        placeholder={t('例如：这个问题的判定似乎不符合汤面…')}
      />
      <Button
        title={t('提交反馈')}
        disabled={busy || !note.trim()}
        onPress={() =>
          void perform(async () => {
            await runtime.report(id, note.trim(), Platform.OS)
            Alert.alert(t('反馈已提交'))
            router.back()
          })
        }
      />
    </Page>
  )
}
