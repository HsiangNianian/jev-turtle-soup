# 独立移动客户端实施计划

日期：2026-09-23。代码基线：`bd055e0` / Web `v0.33.8`。
状态：开发分支 `codex/mobile-app` 已实现客户端、共享核心、Bearer 会话扩展、本地 npm 构建入口及 GitHub 工作流；正在验证原生编译，尚未完成真机签名和安装验收。实际命令与配置见 [mobile/README.md](../mobile/README.md)。以下保留实施范围和验收要求。

当前验收范围（已确认）：Android 与 iOS 模拟器。iPhone 真机签名和商店分发留待后续配置，不作为本阶段完成条件；本地签名构建脚本仍保留。

目标是在同一仓库新增可独立安装的 iOS / Android App。采用 Expo + React Native，沿用 Workers、D1、KV 和现有题库。**按最新决定，现阶段原生编译运行在 GitHub Actions 托管 runner；同时必须交付可在本地执行的完整 npm 构建脚本，CI 调用同一套脚本。本机暂以代码、JS 检查、Worker 与 Metro 开发为主。不依赖 EAS Build、EAS Submit 或 EAS Update。**

首个可交付版本要完成：打开今日汤 → 提问 → 查看线索 → 保存 → 关闭 App → 恢复同一局。内部测试版进一步覆盖题库、邮箱登录、云存档与反馈。模型判读继续每次读取当前汤底独立判断，不恢复历史问句判读复用。

## 1. 已确定的工程方案

| 事项     | 方案                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| 客户端   | Expo + React Native + TypeScript，新增 `mobile/`                                |
| 导航     | Expo Router 原生 Stack 与原生 Tabs；具体 API 与选定 SDK 对齐                    |
| 后端     | 现有 Worker `/api/*`；客户端公开接口与服务端代码明确分包                        |
| 样式     | 原生组件 + `StyleSheet` + 共享品牌 tokens；系统导航、菜单和弹层                 |
| 凭据     | `expo-secure-store` 保存会话 token；服务端继续校验签名和 KV 会话                |
| 存档     | `expo-sqlite` 按局持久化；游戏、队列、账号归属在同一事务原子提交                |
| 工作区   | npm workspaces，沿用 npm 和根 lockfile；Web 目录不搬迁                          |
| 原生工程 | 初次 Prebuild 后将 `mobile/ios`、`mobile/android` 纳入 Git；CI 编译已提交的工程 |
| 编译     | GitHub 托管 runner：Android 用 Linux + Gradle，iOS 用 macOS + Xcode             |
| 发布边界 | 首轮输出 CI artifacts 与内部安装包；应用商店上传另设发布步骤                    |

Expo 应用可使用标准 Android SDK / Xcode 工具链编译。本计划把工具链放到 GitHub runner，日常 JS 开发仍可使用 Metro；修改 JS 不必重新编译已安装的原生调试客户端，修改原生依赖或配置才重新触发 CI。[Expo 调试构建与 Metro](https://docs.expo.dev/guides/local-app-development/)

原生目录提交后，CI 不运行 `prebuild --clean`。新增原生依赖、变更 app config 或升级 SDK 时，由开发分支显式同步原生工程并提交 diff；包含 Gradle Wrapper、Podfile.lock、Gemfile.lock 和共享 Xcode scheme，排除 Pods、构建产物、用户设置与签名文件。Prebuild 是工程生成工具，原生配置变更需要随生成结果一同评审。[Expo 原生工程说明](https://docs.expo.dev/workflow/continuous-native-generation/)

M0 的首次工程生成和原生依赖解析也可在专用 CI 初始化任务完成，将原生源码与 lockfile 作为 artifact 回收并评审提交；不要求本机先安装 Xcode。初始化任务允许创建首份 Podfile.lock，提交后常规 CI 才使用 `pod install --deployment`。后续更新采用同样的显式流程，普通检查不悄悄重写锁文件或自动推送源码。

M0 选择当时正式发布且相互兼容的 Expo、React Native、React、Node、JDK、Xcode 与 CocoaPods 组合并锁定；不预填未经构建验证的版本。React 与原生依赖只允许移动 bundle 内各有一份，原生依赖声明在 `mobile/package.json`。共享 core 不依赖 React。[Expo monorepo 指引](https://docs.expo.dev/guides/monorepos/)

## 2. 仓库布局与复用边界

```text
src/                         现有 Web 界面与浏览器适配器
worker/                      现有 Worker 路由
shared/                      现有服务端业务；不能整体作为客户端共享包
packages/client-core/        公开 DTO、API 客户端、存档核心、纯翻译/游戏函数
mobile/
  app/                       Expo Router screens / layouts
  src/components/            原生 UI 与品牌组件
  src/features/game/         对局控制器与交互状态
  src/platform/              SQLite、SecureStore、网络、前后台适配
  ios/                       已提交的 Xcode 工程
  android/                   已提交的 Gradle 工程
  app.config.ts
  package.json
scripts/mobile/              本地与 CI 共用的检查/编译/打包脚本
.github/workflows/
  mobile-checks.yml           PR 检查、Android 构建、iOS 模拟器构建
  mobile-package.yml          指定版本的独立安装包
```

按真实使用逐步提取 `client-core`，不提前建立通用组件库。保留现有 Web 导出入口作为兼容包装，迁移后跑现有回归。根 TypeScript、Vitest、lint、format 的文件范围要明确，避免扫描 Pods 或 Gradle 产物；Web 的 `npm run build` 继续只生成原有 `dist/`。

| 当前代码                               | 迁移策略                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/api.ts`、各 `*-client.ts`     | 提取 DTO 和可注入 `baseUrl/fetch/getToken` 的 transport，Web 保留相对路径/Cookie           |
| `src/lib/archive.ts`                   | 提取公开存档结构与纯计算；保留 `libraryId`、`dailyDate`、语言和对局状态                    |
| `src/lib/archive-store.ts`             | 提取同步 `StoragePort` 与类，注入 UUID 工厂；浏览器 singleton 和 Web crypto 依赖留在适配器 |
| `src/lib/save-sync.ts`                 | 提取队列核心与 transport/store 接口；平台负责生命周期事件                                  |
| `src/lib/i18n.ts`、`src/locales/`      | 分离字典、翻译函数与 React context / 浏览器语言探测                                        |
| `src/App.tsx`                          | 提取消息/对局状态转换；UI、副作用、浏览器路由分别实现                                      |
| DOM、Radix、Tailwind、`window.history` | 用原生界面与导航重建                                                                       |
| `shared/game.ts`、`shared/auth.ts` 等  | 保留服务端；禁止被移动端运行时代码导入                                                     |

客户端共享包不能间接依赖模型 SDK、密钥配置、数据库或未揭晓汤底。用 import 边界检查与实际 bundle 检查验证，不靠目录名称保证。

## 3. 首版页面与原生交互

主导航为「今日 / 题库 / 档案 / 我的」。Game 进入独立全屏 Stack，隐藏 Tabs。今日先突出今日题与继续进度；题库使用搜索列表与筛选面板；我的包含邮箱登录、主题、语言和同步状态。

```text
Tabs
├─ 今日 ─ 今日详情 ─┐
├─ 题库 ─ 题目详情 ├─ Game ─ 汤面/线索面板
├─ 档案 ─ 恢复同局 ┘       ├─ 结案/揭晓结果
└─ 我的 ─ 登录/设置        └─ 玩家反馈
```

保留米色纸张、朱红强调、档案编号与衬线标题。导航、按钮和对话正文优先采用系统字体；为两种平台保留各自的返回、菜单、键盘与弹层行为。

首版完整保留这些规则：

- 每日同题恢复原存档；题库和每日分别使用现有的 ask/reveal 路径。
- 对局区分进行中、已结案、已揭晓、已中止；恢复后操作权限与原状态一致。
- 当天每日汤的手动揭晓限制由后端执行；往期详情也按玩家状态控制汤底展示。
- 保留提示、已知结论台账、主持人澄清、超时错误、终局结果和反馈入口。
- UI 支持 `zh-CN/en/ja`；题目原作语言、当前界面语言、每条回复的 `replyLocale` 分开保存。
- 汤面/线索可通过可拖动的半屏面板查看；返回手势先关闭面板，再退出对局。
- 输入框跟随键盘；查看历史时新回复不强制拉到底部，显示可点击的新消息提示。
- 保留输入草稿；适配安全区、系统字号、读屏和长中日韩文本，交互目标统一至少 48 个逻辑单位。
- 中文/日文输入法确认候选词不误发送；重试复用原消息，不重复增加消息或轮数。
- 分享使用现有公开每日/题库 URL 和系统分享面板；取消分享不自动执行复制。旧存档缺失 `libraryId` 时保留现有兼容修复。

首轮不迁移投稿、作者编辑、留言、完整动态页和 admin；这些仍可在现有 Web 使用。原生管理员后台不属于本次范围。

## 4. 登录、请求与数据恢复

**原生会话扩展。** 开发分支已在 `worker/index.ts` 实现以下扩展，沿用当前邮箱验证码、签名 sid 和 KV 撤销机制；生产服务需部署相同版本后才能供 App 登录：

1. `POST /api/auth/verify` 接受可选 `sessionMode: "token"`，验证成功返回 `{ user, token, expiresAt }`，token 模式不额外设置 Cookie；未指定时保持现有 Web 行为。
2. 统一鉴权支持 `Authorization: Bearer <token>`；明确提供 Authorization 时按该凭据校验，无效或格式错误时不回退 Cookie 身份。
3. `/api/auth/me`、logout、存档等复用同一会话解析；保留现有过期时间，不在首版引入第二套 refresh-token 服务。
4. token 只写 SecureStore；账户展示缓存不能证明已认证。冷启动在线校验通过后才上传，401 暂停同步并保留本机进度。
5. 注销先停止旧账号请求，清理本机 token；在线时撤销服务器会话。离线注销不能宣称已完成远端撤销，服务器会话仍按现有 TTL 失效。

所有调用经过统一 transport：API base URL、取消信号、结构化错误、Bearer、`X-Save-Owner`。默认只向配置的 API origin 发送凭据。无需为原生客户端放开浏览器的任意来源 CORS。

**存档。** 原型全量 KV 序列化在 200 局、每局 300 条消息时出现明显长任务，已升级为按局 SQLite 存储，仅序列化变更的游戏；所有游戏变更、pending 操作与账号归属在同一事务提交。Web 保留原有 localStorage 适配。回归覆盖单局更新、失败回滚、游客归并、重启恢复和旧 KV 迁移。[SQLite API](https://docs.expo.dev/versions/latest/sdk/sqlite/)

保留游客/各账号隔离、首次登录归并游客记录、generation 取消旧账号请求、逐条同步、退避与失败操作持久化。App 前台激活和网络恢复触发重试；进入后台及时保存，但不假设系统允许无限后台运行。离线可以阅读已有汤面和记录，模型回答仍需联网。

启动恢复在明确的 loading/error 状态下进行。M3 用 200 局与长对话压测同步 JSON 序列化/写盘对输入和滚动的影响；若出现明显长任务，完成按局存储及事务提交的接口升级再进入内部测试，不以假异步绕过原子性。普通偏好使用单独 key，凭据不放存档中。SecureStore 的凭据恢复仍需服务端验证，不能假设卸载后凭据一定消失。[SecureStore 生命周期](https://docs.expo.dev/versions/latest/sdk/securestore/)

Web 的本机游客存档不会自动进入 App；需要在 Web 登录并同步后由 App 登录同一账号获取。首版继承当前云存档限制：最多返回 200 局、按客户端 `updatedAt` 覆盖、删除没有跨设备墓碑。另一台离线设备可能重新上传已删存档，同局并发编辑也没有合并保证。内部验收要复现和记录这两种情况；更广泛分发前单独完成服务端 revision / 删除墓碑方案及 Web 兼容迁移，不把它们描述为已解决。

**请求中断。** 保存玩家输入和发送中状态；杀进程后将未完成提问显示为中断，可手动重试。现有 `seq` 仅为日志上下文，不提供去重保证，首版不自动重放结果未知的提问。每个响应绑定对局、账号 generation 与本次请求，旧响应不能写进新局。

**反馈与诊断。** 复用 `/api/reports` 和现有快照序列化，附上 route、平台、版本、build、locale、对局与消息快照；不包含凭据。移动端提交长对话后，admin 应仍能显示完整或明确标记裁剪的快照。现有每日与题库统计字段、playerKey、seq 等上下文继续传递。设备标识在安装内稳定；每日人品的日期、salt 与生成规则从 `window.location` 中解耦，保留原规则，不把它当作认证凭据。

## 5. 本地编辑与 GitHub 云构建

### 本地环境

当前机器已确认 Node `22.22.2` / npm `10.9.7` 可用；完整 Xcode、Java Runtime、默认 Android SDK 和 CocoaPods 尚未检测到。**这些不作为本阶段前置条件，不安排安装。** Xcode、模拟器、SDK 兼容 JDK、Android SDK 与 CocoaPods 由 M0 在 GitHub runner 配置并锁定。

以下根命令已实现。**本地构建脚本是 M0 的必交付项**，CI 调用这些同源脚本；本机暂不安装原生工具链，构建运行验证先由 CI 完成：

| 命令                                   | 行为                                                               |
| -------------------------------------- | ------------------------------------------------------------------ |
| `npm run mobile:start`                 | 本地启动 Metro，已安装的 CI development build 通过局域网连接       |
| `npm run mobile:android`               | 本地 Expo CLI 调试编译、安装到 Android 设备并启动 Metro            |
| `npm run mobile:ios`                   | 本地 Expo CLI 调试编译、安装到 iOS 模拟器/已配置设备并启动 Metro   |
| `npm run mobile:check`                 | 移动类型、客户端导入边界、全仓核心及平台适配回归测试               |
| `npm run mobile:build:android:debug`   | 本地/CI：仅编译调试 APK，不安装、不启动 Metro                      |
| `npm run mobile:build:android:preview` | 本地/CI：内置 JS 的内部签名 APK                                    |
| `npm run mobile:build:android:release` | 本地/CI：正式签名 AAB                                              |
| `npm run mobile:build:ios:simulator`   | 本地 macOS/CI：内置 JS 的模拟器 `.app.zip`                         |
| `npm run mobile:build:ios:development` | 本地 macOS/CI：带 dev-client 的 Development 签名 IPA               |
| `npm run mobile:build:ios:device`      | 本地 macOS/CI：archive + export；显式选择 Ad Hoc 或 App Store 分发 |

所有脚本先检查依赖并给出准确的安装/配置提示；iOS 构建要求 macOS。接受一致的配置环境、API URL、build number、签名路径与输出目录参数，不依赖 `GITHUB_*` 变量才能运行；CI 仅负责安装工具链、注入 secrets、调用脚本和上传产物。签名打包缺少凭据时明确失败，不自动回退 debug 签名。开发者将来可用同一 keystore/证书在本地构建兼容覆盖安装的产物。

完整 API 本地联调走现有 Wrangler Worker 入口与本地 D1/KV；Vite 中间件只提供部分接口。沿用现有新库/迁移约定，新增固定的本地测试题数据。真机使用可达的局域网地址；CI 模拟器使用 runner 内的 fixture 服务地址，本地 HTTP 放行只存在于开发配置。所有模型密钥和本地验证码开关留在 Worker 环境，App 仅配置公开 API URL。

日常流程：拉取 CI 安装包 → 安装到真机 → 纯 JS 变更连接本机 Metro 热更新；需要独立运行或原生依赖变化时 push 后重新下载 CI 产物。iOS development client 也需要覆盖测试设备的签名配置；配置前可推进 JS、Android 真机与 iOS CI 模拟器检查，不声称已经打通 iPhone 真机调试。

内部 preview 与 production 分别固定 API origin、包标识和显示名；内部包与正式包可并存。默认开发联调本地 Worker，远程共享测试环境在需要时使用独立 D1/KV 配置。正式 HTTPS API 地址不允许静默回退到测试服务。

### CI 触发与产物

开发分支已新增 `mobile-checks.yml` 与 `mobile-package.yml`。用 PR 和 main 的非签名构建尽早发现原生工程问题；签名出包走 `workflow_dispatch` 或移动专用 tag，首个版本拟 `mobile-v0.1.0`。Web `v*` tag 不触发移动发布，移动 tag 不改 Web 版本号。

| 触发                          | 环境/步骤                                                                                             | 产物与用途                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| PR / main                     | Linux：`npm ci`，Web/Worker 回归，mobile checks                                                       | 测试与类型检查结果                               |
| 涉及移动依赖/代码的 PR / main | Linux：Gradle `assembleDebug`                                                                         | 调试 APK，连接 Metro 开发；不是离线独立测试包    |
| 涉及移动依赖/代码的 PR / main | macOS：固定 Xcode，`bundle exec pod install --deployment`，`xcodebuild` simulator Release，无设备签名 | 内置 JS 的 `.app.zip`，仅适用于对应架构的模拟器  |
| 手动内部打包                  | Linux：Gradle Release + 内部签名                                                                      | 内置 JS 的 APK，安装后不依赖 Metro               |
| 手动开发客户端打包            | macOS：Development 签名的 dev-client archive/export                                                   | 调试 IPA，安装到配置内的真机后连接本机 Metro     |
| 手动内部打包                  | macOS：签名 archive + Ad Hoc export                                                                   | `.ipa`，仅供描述文件覆盖的设备安装               |
| `mobile-v*` / 指定发布版本    | 同一原生构建脚本，production 配置                                                                     | Android AAB / iOS App Store 分发 IPA，供后续提交 |

Android Gradle 支持直接构建 APK/AAB；AAB 是商店分发输入，不能当作可直接安装 APK。iOS 真机包需要与分发方式匹配的签名和描述文件，模拟器成功不代表真机签名成功。[Android 命令行构建](https://developer.android.com/build/building-cmdline)、[Expo 本地发布构建](https://docs.expo.dev/guides/local-app-production/)

构建脚本记录并输出版本号、build number、commit SHA、配置环境与工具链版本。原生 build number 单调递增，由固定发布序号产生，CI 重现构建可显式传入；重跑同一产物可以沿用，重新分发必须使用新编号。归档产物使用平台/版本/SHA 命名，附 SHA-256、签名验证结果和构建清单。

工作流约束：

- PR 使用 `pull_request`，检查不读取签名或服务端 secrets；不使用带高权限上下文执行 PR 代码。
- 始终产生最终检查结果；按变更范围跳过原生 job 时，汇总 job 明确成功，避免 required check 一直 pending。共享包、根 lockfile、构建配置变化要触发两平台检查。
- 固定 runner 大版本，并显式选择 Xcode/JDK/SDK/Node/Ruby/CocoaPods；缓存按平台和 lockfile 分开。Actions 实现时锁定已核实的版本/提交。
- 签名任务仅在可信提交运行。移动 tag 必须属于 main 历史；手动任务校验目标 ref。普通 PR 不生成正式签名产物。
- 原生产物默认只上传 Actions artifacts；不自动创建公开 Release、不自动提交商店、不触发 Worker 部署。
- mock/fixture 测试不调用生产数据库、真实邮件或真实模型。UI smoke 使用测试专用 API fixture；发布配置必须禁用 fixture。

### 签名材料

Android 内部测试使用固定测试 keystore，以便覆盖安装保留存档；正式发布使用独立 upload key。CI 通过 GitHub Secrets 写入临时路径；本地脚本支持从环境变量与忽略的签名配置读取同样的字段。不可把每次 runner 随机生成的 debug key 用作稳定分发密钥。

iOS CI 需要签名证书 `.p12`、证书密码、对应 bundle ID / 分发方式的 provisioning profile、Apple team 配置；安装到临时 keychain，任务结束清理。凭据缺失时，只完成明确标记的模拟器构建，真机签名 job 显式失败/报告未配置，不能静默当作签名通过。App Store Connect 上传凭据只有接入上传时才需要。[GitHub macOS 签名说明](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)

## 6. 分阶段实施与验收

| 阶段              | 具体交付                                                                                 | 验收条件                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| M0 工程与构建     | workspace、Expo app、原生工程、CI 锁定工具链、原生导航壳、基础 checks/build CI、开发说明 | GitHub CI 编译两平台空壳；Android 与 iOS 模拟器启动检查；本地 JS 检查及原 Web build/tests/Worker dry-run 通过 |
| M1 公共契约与登录 | client-core transport、公开 DTO、Bearer 兼容、SecureStore、邮箱验证码界面                | Web Cookie 行为不变；App 登录/me/logout；过期、坏 Bearer、Cookie/Bearer 混合身份测试通过                      |
| M2 可玩流程       | 今日与题目详情、Game、提示、台账、汤面面板、结果、反馈、游客 SQLite 存档                 | 两条 ask 路径正确；游戏四态、每日揭晓限制、三语言行为正确；关闭重开恢复同局；反馈快照可读                     |
| M3 存档与页面补全 | 云存档队列适配、前后台恢复、账号切换、题库列表/搜索、档案、主题/语言设置                 | Web→App 接续；游客首次归并；A→退出→B 不串号；断网/401/写盘失败可恢复；大存档不卡输入                          |
| M4 内部测试包     | 原生 UI smoke、签名打包工作流、产物元数据与安装说明                                      | 下载 APK/签名 IPA 真机安装；关闭 Metro 后能完整游玩；覆盖安装保留进度；可定位版本/平台问题                    |

M0 包含上述全部本地 npm 入口和公共构建脚本，签名配置检查与参数契约同时落地；真实签名出包在 M4 配好凭据后验收。CI 不再复制一套 Gradle/Xcode 命令。本机未执行原生构建要在阶段报告中如实注明。

实施依赖为 M0 → M1 → M2 → M3 → M4。M0 完成后，登录后端适配与游戏 UI 可以并行；每阶段保持 Web 回归通过。每阶段按可独立检查的变更拆 commit，不把整个客户端和后端兼容改动压成一个提交。

首个内部版本的必要验收矩阵：

| 场景                                  | 预期                                                   |
| ------------------------------------- | ------------------------------------------------------ |
| 游客今日汤 → 提问 → 杀进程 → 重开     | 恢复同一题、消息、输入和对局状态；未完成请求显示中断   |
| 题库游戏 → 存档恢复 → 再提问          | 使用题库接口和原 libraryId，不误入每日路径             |
| UTC 当日边界与往期题                  | 前后端揭晓权限一致；不因手机时区提前解锁               |
| 发送中返回/切题/切账号                | 迟到响应不会写入新局或其他账号                         |
| 断网 / 429 / 5xx / 401 / 本机写入失败 | 草稿和已保存进度保留；同步状态可解释；恢复后重试不乱序 |
| 登录 A → 退出 → 游客 → 登录 B         | 账号隔离；游客迁移行为与现有约定一致                   |
| Web 保存 → App 同账号登录             | 拉取已确认云存档并继续；不把未返回项当删除             |
| 打开长对话、键盘、汤面面板            | 滚动位置稳定、输入无遮挡、返回顺序正确、字号放大可用   |
| 切换中/英/日及明暗主题                | 历史回复语言不被重写，原作语言标记正确                 |
| 长反馈提交 → admin 查看               | 快照可解析，裁剪明确，带 App 版本与平台                |
| 内部包关闭 Metro、重启设备、覆盖安装  | 内置 JS 正常启动；已落盘进度可恢复；版本可追踪         |

现有 `tests/saves.test.ts`、`save-api.test.ts`、`judge.test.ts`、`reports.test.ts` 等用于共享逻辑回归；新增测试集中覆盖会话传输、持久化失败、账号与请求生命周期。设备验证覆盖一台 iPhone 和一台 Android；只通过 JS 测试或模拟器编译不能替代真机验收。

## 7. 实施时需要落实的信息

- M0 锁定 SDK 和 CI 工具链、最低系统版本、设备/模拟器矩阵、最终 bundle ID / applicationId；本阶段不要求本地原生编译。
- M4 接入 Apple team、签名证书与设备列表，以及 Android 测试/发布 keystore；此前工程与非签名 CI 可以继续推进。
- 远程共享测试环境和商店账号按实际分发需要配置；本地开发与规划不依赖它们。
- 公开分发前另行处理云存档删除与并发规则、商店素材及提交工作；首版不承诺离线 AI、后台持续推理或完全无冲突的多设备编辑。
