# iOS nightly 构建

`iOS nightly` 每天 00:00 UTC 在 `macos-26` runner 上运行，也可以从 Actions 手动触发。它先执行 Swift 原生合约检查、Web 回归测试和前端构建，再编译未签名的 iOS Simulator App。

构建结果会生成 `TurtleSoup-<commit>-iOS-Simulator.app.zip`、SHA-256 校验文件和构建清单，并上传为 14 天有效的 Actions artifact。计划任务成功后会更新固定的 `ios-nightly` prerelease；旧 release、tag 和资产会被替换，因此下载链接始终指向最新成功构建。

这是模拟器包，不是可安装到真机的 IPA。真机签名需要 Apple Team 和 provisioning profile，仍使用现有 `npm run ios:install` 流程；nightly workflow 不读取签名凭据。

手动运行时默认只构建并上传 artifact。勾选 `publish` 后才会更新滚动 prerelease。
