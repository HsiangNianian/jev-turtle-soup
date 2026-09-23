# 原生移动客户端

Expo / React Native 独立 iOS、Android 客户端，和 Web 共用 `packages/client-core` 与现有 Worker API。当前用 GitHub Actions 云构建；所有编译入口也是可在本地运行的 npm 脚本，不依赖 EAS。

本阶段先验收 Android 和 iOS 模拟器；iPhone 真机签名后续配置。

本阶段检查已通过：[CI 与安装包](https://github.com/HsiangNianian/jev-turtle-soup/actions/runs/35889580022)。Android 包含提问及重启恢复检查，iOS 包含启动检查；产物为 `0.1.0` / build `3`，使用 fixture API，详细验收边界见 [实施记录](../docs/mobile-app-plan.md)。

## 开发与检查

在仓库根目录执行：

```sh
npm ci
npm run mobile:check
npm run lint
npm run build
EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 npm run mobile:export
```

本机不需要安装原生工具链就能完成以上检查、Worker 开发和 Metro 热更新。工具链版本见 [toolchain.json](toolchain.json)，移动端 React 固定为 Expo 配套版本，Metro 显式保证原生 bundle 使用这一份 React。

完整 API 联调用已有的 `npm run dev:worker`；`npm run dev` 是 Web Vite 入口，不能替代所有 Worker 接口。真机需要手机能访问的局域网 API 地址；Android 模拟器访问宿主机一般用 `10.0.2.2`，iOS 模拟器用 `127.0.0.1`。模型密钥放 Worker 的本地 `.dev.vars`，不放 `EXPO_PUBLIC_*`。

```sh
EXPO_PUBLIC_API_URL=http://192.168.1.20:8787 npm run mobile:start
```

安装 CI 的 development 包后连接 Metro。修改 JS 可热更新，修改原生依赖需要重编译。首次 App 邮箱登录依赖本分支的 Worker Bearer 会话扩展，旧生产 Worker 尚不支持 token 登录；请使用对应分支的 Worker 测试环境。

## 本地与 CI 共用构建命令

先安装 [toolchain.json](toolchain.json) 指定的原生工具链：Android 需要 JDK、Android SDK 和 `ANDROID_HOME`；iOS 需要 macOS、完整 Xcode、Ruby/Bundler，并在 `mobile/` 执行 `bundle install`。当前不要求在开发机安装这些工具。

| 根 npm 命令                     | 产物 / 行为                                     |
| ------------------------------- | ----------------------------------------------- |
| `mobile:android`                | development 编译、安装、启动 Metro              |
| `mobile:ios`                    | development 编译、安装、启动 Metro              |
| `mobile:build:android:debug`    | 调试 APK，运行时连接 Metro                      |
| `mobile:build:android:emulator` | 测试签名 Release APK，内置 JS，仅限 development |
| `mobile:build:android:preview`  | 签名 Release APK，包含 JS，可独立运行           |
| `mobile:build:android:release`  | 签名 AAB，供商店提交，不能直接安装              |
| `mobile:build:ios:simulator`    | Release `.app.zip`，包含 JS，仅供对应架构模拟器 |
| `mobile:build:ios:development`  | Development 签名 IPA，连接 Metro                |
| `mobile:build:ios:device`       | Ad Hoc / App Store 签名 IPA，包含 JS            |

```sh
npm run mobile:build:android:debug -- --env development --api http://10.0.2.2:8787
npm run mobile:build:android:preview -- --api https://YOUR-TEST-WORKER --build-number 101
npm run mobile:build:android:release -- --build-number 102
npm run mobile:build:ios:simulator -- --env development --api http://127.0.0.1:8787
npm run mobile:build:ios:development -- --api http://192.168.1.20:8787 --build-number 103
npm run mobile:build:ios:device -- --env preview --api https://YOUR-TEST-WORKER --build-number 104 --export-method ad-hoc
npm run mobile:build:ios:device -- --env production --build-number 105 --export-method app-store
```

参数统一支持 `--env development|preview|production`、`--api`、`--build-number`、`--output`。对应环境变量为 `MOBILE_ENV`、`EXPO_PUBLIC_API_URL`、`MOBILE_BUILD_NUMBER`、`MOBILE_OUTPUT_DIR`；命令行参数优先。API 必须是无路径、无尾斜杠的 origin，preview/production 要求 HTTPS；仅 production 默认连接 `https://hgt.mmstudio.games`。`--help` 查看完整参数。

包标识：production 为 `games.mmstudio.turtlesoup`，其余分别加 `.preview` / `.development`，可并存。每次分发使用递增 build number；本地和 CI 共用同一个序列，不要分别从 1 开始。移动端版本取 `mobile/package.json`，独立于 Web 版本。

输出默认在 `artifacts/mobile/`：安装包、构建清单 `.json`、`.sha256`。清单记录版本、build、commit、API、环境、签名方式和工具链。签名缺失会明确失败。

## 签名

Android preview/release 的本地环境变量：

```sh
export MOBILE_KEYSTORE=/absolute/path/to/test-or-release.keystore
export MOBILE_KEYSTORE_PASSWORD='...'
export MOBILE_KEY_ALIAS='...'
export MOBILE_KEY_PASSWORD='...'
```

内部测试和正式发布各自固定同一把密钥，才可持续覆盖安装。普通 debug 构建在缺少 debug.keystore 时生成临时调试密钥；不同 CI 构建的 debug APK 不保证可覆盖安装。需要保留数据反复升级时用固定签名的 preview 包。

iOS 本地需要 `IOS_CERTIFICATE_PATH`（P12）、`IOS_CERTIFICATE_PASSWORD`、`IOS_PROFILE_PATH`（描述文件）。Development、Ad Hoc、App Store 的证书/描述文件类型和包标识必须匹配。前两者要求描述文件包含测试设备；App Store IPA 用于上传，不能当作直接安装包。脚本创建临时 keychain，结束时恢复原配置并清除临时凭据，不会上传商店。

GitHub `Mobile package` 使用 `mobile-development` / `mobile-preview` / `mobile-production` 环境。配置相应 environment secrets：

- Android：`MOBILE_KEYSTORE_BASE64`、`MOBILE_KEYSTORE_PASSWORD`、`MOBILE_KEY_ALIAS`、`MOBILE_KEY_PASSWORD`
- iOS：`IOS_CERTIFICATE_BASE64`、`IOS_CERTIFICATE_PASSWORD`、`IOS_PROFILE_BASE64`

签名文件只在 runner 临时目录展开并清理，artifact 只上传安装包与公开构建信息。仓库和 artifact 均不保存密钥、P12 或描述文件。没有配置 Apple 签名时仍可跑 simulator CI，不能据此声称 iPhone 真机已通过。

## GitHub 工作流

`Mobile checks` 在 PR、main 与开发分支运行：Web/Worker 回归、移动类型/依赖边界检查、JS 打包、Android 测试 APK 和 iOS simulator 编译及模拟器检查。CI 直接调用上表中的 npm 命令。

`Mobile package` 可手动选择平台、development/preview/release、API 和 build number，或推送与移动版本匹配的 `mobile-v*` 标签生成生产商店输入。标签构建需要预先设置生产环境变量 `MOBILE_RELEASE_BUILD_NUMBER` 为新的分发编号。Web 的 `v*` 标签不触发移动打包。产物在 Actions run 的 Artifacts 中保留 14 天；工作流不创建商店发布。正式分发前要下载并保存产物、校验和与签名备份。

原生工程已纳入 Git。日常 CI 不运行 prebuild。修改 Expo config / 原生依赖时执行 `npm run mobile:native:sync`，审阅并提交 `ios/`、`android/` diff。首次或显式升级 Pods 时，在 CI 选择 bootstrap，回收 `Podfile.lock` / `Gemfile.lock` 并提交；常规构建使用 `pod install --deployment`。

iOS 固定为 GitHub `macos-26` / Xcode `26.6`。当前 `expo-modules-jsi@57.1.0` 的构造器注解在 Xcode 26 编译失败（[上游问题 #50067](https://github.com/expo/expo/issues/50067)）；公共构建脚本在编译前应用版本和源码校验的兼容补丁，Xcode 27 保留原注解。升级 Expo 时需审阅并移除已失效的补丁。依赖锁文件已经从 CI 回收，普通构建不会自动重新解析版本。

CI 的 Android 检查使用 `npm run mobile:build:android:emulator -- --api http://127.0.0.1:8787 --architectures arm64-v8a,x86_64`：Release 内置 JS、明确使用测试签名、限定 development 环境，不需要发布 keystore。该 APK 可安装，但 API 指向测试 fixture。正式 preview / release 入口仍要求签名配置。`mobile:build:android:debug` 保留为连接 Metro 的开发客户端。

`npm run mobile:smoke:android` 在已启动的 Android 模拟器安装测试 APK，清空该模拟器的开发版应用数据，通过 fixture 验证首页、提问、回答和杀进程后的 SQLite 恢复，并保存截图/日志。`npm run mobile:smoke:ios` 创建独立 iPhone 模拟器，验证内置 JS 启动和首页 API 加载，结束后删除该模拟器。两者均不访问真实 AI、邮箱或玩家数据；当前 iOS 自动化只覆盖启动。

仅修改 smoke 脚本时，可手动运行 `Mobile checks` 并传入 `reuse_native_run`。它下载该次构建的原生产物，校验 commit、SHA-256 和测试环境，并拒绝复用任何应用源码或构建输入发生变化的包。原始编译 commit 与本次检查 commit 分别记录在 artifact 清单中；默认 push/PR 仍完整编译。

## 存档与验收边界

移动存档使用 SQLite 按局持久化，游戏、待同步操作、游客归属在同一事务提交；游客和账号数据隔离。凭据只放 SecureStore；冷启动校验身份后才上传。断网可看已有档案和保留草稿，AI 判读仍需联网。发送中断不自动重放，手动重试复用原问题和轮数。反馈附版本、平台及对局快照。

现有云端协议仍有最多 200 局、客户端时间戳覆盖、无跨设备删除墓碑的限制；尚未提供多端同时编辑合并。提交 App 商店前仍需验证 iPhone / Android 真机安装、覆盖升级、键盘、字号、后台恢复和长期网络中断。当前构建/测试的实际状态以 [实施计划](../docs/mobile-app-plan.md) 与对应 Actions run 为准。
