# 海龟汤 · iPhone 测试 App

这是 SwiftUI 原生 iPhone 客户端，最低 iOS 17；由 UIKit scene 承载 SwiftUI 根视图。
广场、每日、动态、我的、作者主页、讨论、写汤、邮箱登录和推理对话均为原生视图，没有 WebView 页面。
底部使用系统 `TabView`，页面使用 `NavigationStack`，并支持系统键盘避让、分享、下拉刷新和深浅外观。
视觉与网页保持一致：暖纸色、宋体正文、台账细线和朱红印章。`BrandStyle.swift` 集中管理与 `src/index.css` 对应的色值和字体层级；
网页同款 Noto Serif SC 与 JetBrains Mono 随 App 打包，支持动态字体，不依赖系统中文衬线回退或联网下载。字体来源及许可证见 `TurtleSoup/Fonts/README.md`。
题库、每日汤、主持和账号直接请求 `https://hgt.mmstudio.games/api/`；需要联网，不会把模型密钥或汤底打进安装包。

案卷以 JSON 原子写入 App 的 Application Support，每个账号和游客各有独立文件；待同步状态也会保留。
登录后通过现有 `/api/me/saves` 协议同步，携带 `X-Save-Owner`，按 `updatedAt` 合并，避免旧进度覆盖新进度。
登录 Cookie 交由 URLSession 的持久化 Cookie 存储管理。读取损坏案卷时保留原文件，停止覆盖。
原生案卷与 Safari、早期 0.1 WebView 预览壳的本机记录独立；已同步的案卷可在原生版登录同一账号恢复。
重新安装到同一个 App ID 可用于续签；删除 App 会删除其本机数据，请先确认云端同步完成。

广场按最新、精选、热门浏览汤友的作品，支持搜索、作者主页、点赞和留言。讨论默认折叠并提示可能涉及汤底；
留言需要登录，可按服务器返回的权限删除留言，也可举报不当内容。游客点赞沿用本机玩家标识，登录后沿用账号身份。
「写汤」支持汤面、汤底、提示、难度、标签和公开/私藏，草稿按账号自动留在本机；提交前明确确认可见范围。
「动态」读取现有作者互动接口并显示未读数量，打开后标记已读；没有系统推送、关注或私信功能。
「我的」包含自己的作者主页、作品和案卷；账号切换会清理互动缓存和私有页面，旧请求不能恢复上一账号的权限。
每日历史与语言标记、问答与重试、线索笔记、结案/揭晓、登录和存档同步均保留。
作品编辑、个人资料编辑和管理后台仍使用网页端。

刷新被 SwiftUI / URLSession 取消时不会显示错误。每日已有内容时，断网只在列表末尾提供轻量重试提示，不覆盖已加载的汤。

## 第一次准备

1. 安装完整 Xcode，并完成首次启动的平台组件安装。
2. 在 **Xcode → Settings → Apple Accounts** 登录自己的 Apple 账号；免费账号显示为 **Personal Team**。
3. 用线连接 iPhone、解锁并选择“信任此电脑”。在手机 **设置 → 隐私与安全性 → 开发者模式** 中启用开发者模式，按提示重启并确认。
4. 运行 `npm run ios:open`，在 TurtleSoup target 的 **Signing & Capabilities** 中选择 Personal Team；保持 **Automatically manage signing** 开启。

也可以复制 `ios/Signing.example.xcconfig` 到 `ios/Signing.local.xcconfig`，填入自己的 `DEVELOPMENT_TEAM`。
这个本地文件、构建产物和 Xcode 用户设置均不进 Git。不需要导出私钥或上传 Apple 账号凭据。

## CLI 构建与安装

在仓库根目录执行；不需要 CocoaPods、XcodeGen 或额外的原生依赖。
未签名构建直接编译 iPhone target；签名安装使用 scheme 和选定的真机 destination，以便正确注册设备。

```sh
npm run ios:doctor
npm run ios:test
npm run ios:build
npm run ios:install -- --team YOURTEAMID
```

`ios:build` 仅验证 iPhone 编译，输出**未签名**的 `.build/ios/Build/Products/Debug-iphoneos/TurtleSoup.app`，不能直接装到手机。
`ios:install` 使用 Xcode 账号自动创建 / 更新开发证书与描述文件，注册目标设备，再验签、安装并启动。
已在工程或本地 xcconfig 设置 Team 时，可以省略 `--team`；也支持 `IOS_DEVELOPMENT_TEAM` 环境变量。

只有一台可用 iPhone 时会自动选择。多台设备时指定设备名称或 UDID：

```sh
npm run ios:install -- --team YOURTEAMID --device '你的 iPhone 名称'
```

默认包名是 `games.mmstudio.turtlesoup.preview`。若 Apple 提示已被占用，可添加
`--bundle-id cn.yourname.turtlesoup.preview`；之后续签应保持相同包名，以使用同一个 App 数据容器。
首次安装后若提示不受信任，在手机 **设置 → 通用 → VPN 与设备管理** 中信任自己的开发者账号。

Personal Team 的免费描述文件有效期为 **7 天**，到期后重新执行安装命令续签。
这是个人真机测试流程，不是 TestFlight 或 App Store 分发。

## 原生验证

`npm run ios:test` 在 Mac 上运行无网络的 Swift 合约检查，覆盖每日语言、揭晓锁定、问答请求、存档合并、账号隔离、损坏文件保护、取消刷新、社群权限隔离、草稿和发布协议。

安装 iOS 模拟器运行环境后，可执行原生 UI 测试：

```sh
xcodebuild -project ios/TurtleSoup.xcodeproj -scheme TurtleSoup \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath .build/ios-simulator -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
```

UI 测试包含两个流程并留存截图：线上只读验证广场、作者主页、讨论入口、登录、每日和续案；
隔离测试验证草稿恢复、发布、点赞、留言、删除和动态。测试不会向线上写入测试作品或互动。
`CommunityPreviewProtocol.swift` 仅在 Debug 模拟器构建中编译，需测试进程显式设置 `NATIVE_UI_FIXTURE=community` 才启用。
它拦截全部请求，未声明的路径直接在本地失败，不会回退到真实服务；真机构建不含此测试服务器。
线上登录与正式发布仍需使用者在 App 中操作，模拟验证不能替代账号真实权限与网络状态。

参考：[Apple Personal Team 说明](https://developer.apple.com/help/account/basics/about-your-developer-account)、
[启用开发者模式](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)。
