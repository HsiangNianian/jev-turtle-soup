# 参与贡献 · Contributing

感谢你来一起改进海龟汤调查局。Bug 修复、玩法与交互改进、翻译、测试和文档都欢迎；Issue 和 PR 可以使用中文或英文。

## 提交问题

在 [Issues](https://github.com/HsiangNianian/jev-turtle-soup/issues) 中说明预期行为、实际结果和复现步骤，并附上平台、浏览器或 App 版本。界面问题请附截图；推理问题请附题目链接与具体提问，把汤底放进折叠的剧透区。账号信息、验证码和模型密钥请勿放入公开反馈。

涉及单局提问的判读问题，也可以先用游戏内的反馈入口，便于关联对应记录。

## 开发流程

1. Fork 仓库，从最新 `main` 创建改动分支。环境准备见 [开发指南](docs/development.md)。
2. 保持一次 PR 聚焦一个问题。较大的新玩法或协议变更，先开 Issue 说明用户场景与方案。
3. 为行为变更补充有意义的回归覆盖。纯文档、文案或小型样式修改不需要机械增加单元测试。
4. 在 PR 中写清楚问题、改动后的行为和实际完成的验证；界面变更附电脑／手机及深浅外观截图。

```bash
npm test
npm run lint
npm run build
# 修改 Worker、绑定或服务端依赖时，再检查打包：
npm run deploy:dry-run
```

多人变更使用 [隔离同桌环境](docs/rooms.md#可复现检查) 验证真实 WebSocket 流程；原生变更按 [iOS](ios/README.md) 或 [Android](android/README.md) 文档验证。请说明未覆盖的平台，不把模拟结果写成真机或线上验证。

## 项目约定

- **保持调查局的视觉。** 暖纸色、墨色、朱红、衬线字体与台账细线是共同语言；网页与原生端各用适合平台的交互。
- **服务端管理规则。** 客户端不能决定判读、权限、揭晓状态或同桌成员身份；未授权时不返回答案。
- **留住玩家的进度。** 修改存档、账号切换、离线恢复或重连逻辑时，覆盖原有数据的兼容和失败恢复。
- **使用隔离数据验证。** 本地预览提供假账号与模型替身；不要向生产环境写入测试作品、互动或群发邮件。
- **说明影响范围。** 网页功能不自动等于原生端已支持；协议或 schema 变化请写明兼容与迁移方法。
- **同步文档。** 产品行为变化时更新中英 README 与对应专题文档；版本号和发布由维护者统一处理。

## English quick guide

Issues and pull requests are welcome in English or Chinese. Describe the problem, expected behavior, reproduction steps, and platform/version. Put puzzle solutions behind a spoiler disclosure and omit credentials or personal account information.

Fork from `main`, keep the change focused, and include relevant checks and screenshots. Run the commands above for code changes; use the isolated room preview for multiplayer work. Preserve the paper-and-ink design, server-controlled permissions, and existing player saves. Explain any untested platforms or migration requirements.

## 授权说明

仓库目前尚未声明项目级许可证，请勿从其他仓库的许可证推定本项目的授权。第三方字体的授权随文件保留，见 [iOS 字体说明](ios/TurtleSoup/Fonts/README.md) 与 [Android 字体授权](android/app/src/main/assets/licenses)。
