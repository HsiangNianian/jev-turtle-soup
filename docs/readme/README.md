# README 视觉素材

- `banner.svg` / `banner-dark.svg`：纸面案卷、朱红印章与静态文字。中英文 README 共用，通过 `<picture>` 跟随查看者的深浅偏好。无外部资源、脚本或动画。
- `home.jpg` / `home-dark.jpg` / `home-mobile.jpg`：2026-10-08 捕获的 v0.43.0 在线首页，使用访客会话。
- `room.jpg`：v0.43.0 隔离本地房间的真实界面，使用演示账号与模拟主持人。
- 填空示例复用 `../ui-redesign/after-cloze.jpg`，避免重复保存相同截图。

SVG 文字使用项目内的 Noto Serif SC 与 JetBrains Mono 转成路径，避免 GitHub 或不同操作系统替换中文字体。字体授权见 [字体说明](../../ios/TurtleSoup/Fonts/README.md)。标题和内容也保留在 SVG 的 `title`、`desc` 与注释中。

## 修改封面

调整 `generate-banner.py` 的文案、坐标与颜色，然后在仓库根目录运行：

```bash
python3 -m venv .build/readme-art
.build/readme-art/bin/pip install fonttools
.build/readme-art/bin/python docs/readme/generate-banner.py
```

FontTools 仅用于重新生成文档插图，不是应用构建依赖。截图需使用实际界面；更新后同时检查中文／英文、电脑／手机和深浅主题的 README 渲染。
