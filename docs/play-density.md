# 紧凑游玩界面：A 批注式问答

2026-09-29，用户比较 A / B / C 后选择“都 A 吧”：桌面、手机、单人、同桌采用 A；网页 / PWA、iOS、Android 一起实现。

## 决定

- 每次提问与它的回答合在一组，轮次置于页边，判定保留是／否／半／无关／中。
- 桌面单人左侧使用窄案卷栏。同桌保留独立桌聊侧栏，双方草稿独立。
- 手机收起汤面，按需打开；同桌提问与讨论在同一条时间线中，输入框旁选择发送对象。
- 显示有用标记，暂时无用、引用、判读明细等收进更多操作；标记筛选与判定筛选可组合，点击记录跳转时恢复完整时间线。
- 保留米白纸张、中文衬线、朱红与判定印章。正文不依靠缩成极小字获得密度；发送按钮保持 44px，长输入可展开。
- iOS / Android 的私人标记仅写本机存储，按账号、单人／同桌、案卷 ID 隔离。网页继续使用既有 localStorage 协议，不上传标记。

## 边界

这次重组展示，不改 Jev 请求历史、房间事件协议、排队、揭晓投票和共同案卷。回答按问题 ID 配对；历史分页先取到回答时保留独立回答，问题取回后合并。等待回答、失败重试、独立系统消息也保留。

B 的折叠结果清单、C 的手机问答／讨论分页未采纳。试验页面已完成选择任务，删除运行代码，仅保留本决策。

## 验证

先运行 `npm run rooms:preview`，再运行：

```sh
npm run lint
npm test
node scripts/test-personal-marks-web.mjs
node scripts/test-play-density-web.mjs
npm run rooms:test:web
npm run ios:test
npm run rooms:test:ios-ui
# Android 先 assembleDebug assembleDebugAndroidTest，再连接模拟器：
npm run rooms:test:android
```

网页验证账号隔离、持久化、跨标签同步、历史分页、引用、判读明细、筛选跳转、长输入、中文输入法确认、键盘视口、窄屏和深色。原生测试使用隔离的本地房间运行时，覆盖提问、讨论、记录、私人标记及单人游玩。实际截图保存在 `.build/play-density/` 和 `.build/rooms/`，不进入生产路由。
