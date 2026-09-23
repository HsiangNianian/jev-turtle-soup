import { useAction } from '../../src/components/hooks'
import { useState } from 'react'
import { Linking, View } from 'react-native'
import { Button, Card, Copy, Field, Notice, Page, Title } from '../../src/components/ui'
import { useRuntime } from '../../src/platform/context'
import { appEnvironment, buildNumber } from '../../src/platform/runtime'
export default function Me() {
  const runtime = useRuntime()
  const { t } = runtime
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [debugCode, setDebugCode] = useState<string>()
  const { busy, perform } = useAction()
  return (
    <Page>
      <Title>{t('我的')}</Title>
      {runtime.authError ? <Notice text={runtime.authError} retry={runtime.resume} /> : null}
      {runtime.user ? (
        <Card>
          <Copy>{runtime.user.name || runtime.user.email}</Copy>
          <Copy>{runtime.user.email}</Copy>
          <Button
            secondary
            title={t('退出登录')}
            disabled={busy}
            onPress={() => void perform(() => runtime.logout())}
          />
        </Card>
      ) : null}
      {!runtime.confirmed ? (
        <Card>
          <Copy>{t('登录后，在不同设备继续推理。')}</Copy>
          <Field
            testID="login-email"
            accessibilityLabel={t('邮箱')}
            placeholder={t('邮箱')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Button
            title={t(sent ? '重新发送验证码' : '发送验证码')}
            disabled={busy || !email.includes('@')}
            onPress={() =>
              void perform(async () => {
                const result = await runtime.api.requestCode(email.trim(), runtime.locale)
                setSent(true)
                setDebugCode(appEnvironment === 'development' ? result.code : undefined)
              })
            }
          />
          {sent ? (
            <>
              <Field
                testID="login-code"
                placeholder={t('6 位验证码')}
                accessibilityLabel={t('验证码')}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
              />
              {debugCode ? (
                <Copy>
                  {t('本地验证码')}：{debugCode}
                </Copy>
              ) : null}
              <Button
                title={t('登录')}
                disabled={busy || code.length !== 6}
                onPress={() => void perform(() => runtime.login(email.trim(), code))}
              />
            </>
          ) : null}
        </Card>
      ) : null}
      <Card>
        <Copy accessibilityRole="header">{t('语言')}</Copy>
        <View style={{ gap: 8 }}>
          {(['zh-CN', 'en', 'ja'] as const).map((locale, index) => (
            <Button
              key={locale}
              secondary={runtime.locale !== locale}
              title={['简体中文', 'English', '日本語'][index]}
              onPress={() => runtime.setLocale(locale)}
            />
          ))}
        </View>
      </Card>
      <Card>
        <Copy accessibilityRole="header">{t('外观')}</Copy>
        {(['system', 'light', 'dark'] as const).map((theme, index) => (
          <Button
            key={theme}
            secondary={runtime.theme !== theme}
            title={t(['跟随系统', '浅色', '深色'][index])}
            onPress={() => runtime.setTheme(theme)}
          />
        ))}
      </Card>
      <Button
        secondary
        title={t('打开网页版')}
        onPress={() => void Linking.openURL('https://hgt.mmstudio.games')}
      />
      <Copy>
        0.1.0 ({buildNumber}) · {appEnvironment}
      </Copy>
    </Page>
  )
}
