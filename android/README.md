# 海龟汤 Android 测试 App

这是 Kotlin + Jetpack Compose 的原生界面，没有 WebView。它与网页和 iPhone App 使用同一个 `https://hgt.mmstudio.games` API，账号、公开汤题、互动与云端案卷共享；本机游客案卷在首次登录时并入账号。四栏为广场、每日、动态、我的。

## 构建与安装

准备 JDK 17、Android SDK Platform 36、Build Tools 35.0.0 和 Android Platform Tools。把 `JAVA_HOME` 指向 JDK 17，并通过 `ANDROID_HOME` 或 `android/local.properties` 的 `sdk.dir` 指向 SDK。然后在仓库根目录运行：

```bash
npm run android:build
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

如果本地网络无法访问 Maven Central，可临时设置 `SOUP_MAVEN_MIRROR` 为可访问的 Maven Central 镜像地址。默认仍使用 Google Maven 和 Maven Central。

连接开启 USB 调试的安卓设备后：

```bash
adb devices
npm run android:install
```

`assembleDebug` 会用 Android 调试密钥签名，供设备侧载测试。发布到应用商店需要另配正式签名与发布流程；不要提交密钥或本机 `local.properties`。

品牌字体来自 `ios/TurtleSoup/Fonts/`，授权文本随 APK 放在 `assets/licenses/`。应用包名是 `games.mmstudio.turtlesoup`，调试版本号从 `0.1.0` 开始。
