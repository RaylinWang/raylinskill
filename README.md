# raylinskill

一些自用的 Claude Code skill，顺手公开。

## 当前包含

| Skill | 一句话说明 | 触发词 |
|---|---|---|
| [download-video](./download-video) | 用 yt-dlp 下载视频（小红书 / 抖音 / YouTube / B站 / 快手 / Twitter 等） | `/下载视频`、`/download-video`、贴链接 |
| [video-to-text](./video-to-text) | 本地视频转中文文字报告：`mlx_whisper` 转录 + 语义分段 + 双人角色推断 + 核心观点总结 | `/视频转文字`、`/video-to-text` |
| [koubo-pipeline](./koubo-pipeline) | 真人口播视频动效流水线：转码 → 转录校对 → 分镜卡 → 静帧审批 → 4K 渲染归档 | `/口播剪辑` |
| [jianbihua](./jianbihua) | 固定 IP 形象的简笔画、教学插图、Q 版贴纸生图（自带角色参考图与风格 DNA） | `/简笔画` |
| [chapter-progress-bar](./chapter-progress-bar) | 给口播 / 教程视频加章节进度条：4 种样式，配色可换，手绘小人和真人表情用你自己的形象；Agent 直接叠进视频，或导出透明 MOV / 绿幕 MP4；自动避开抖音 / TikTok / 小红书安全区 | 「加进度条」「章节进度条」 |

## 安装

skill 平铺在仓库根目录，每个目录是一个独立 skill。挑你想要的拷到 Claude Code 的 skills 目录即可：

```bash
git clone https://github.com/RaylinWang/raylinskill.git
cp -r raylinskill/download-video ~/.claude/skills/
cp -r raylinskill/video-to-text  ~/.claude/skills/
```

或者只拿一个：

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/RaylinWang/raylinskill.git
cd raylinskill
git sparse-checkout set video-to-text
cp -r video-to-text ~/.claude/skills/
```

装完重启 Claude Code，输入 `/` 就能看到。

## 依赖

- **download-video**：`yt-dlp`
  ```bash
  brew install yt-dlp
  ```
- **video-to-text**：Whisper（MLX 版）+ `ffmpeg`
  ```bash
  uv tool install --python 3.12 mlx-whisper
  brew install ffmpeg
  ```

- **chapter-progress-bar**：Google Chrome（或 Edge / Chromium）、Node.js 22+、`ffmpeg`
  ```bash
  brew install node ffmpeg
  ```

## 兼容性

- Claude Code（终端 CLI）
- macOS 为主；Linux 应该也能跑，未测
- video-to-text 依赖 MLX，仅 Apple Silicon
- chapter-progress-bar：macOS 已测；Windows、Linux 按跨平台写的，未实机测。在 Claude 桌面端里出片要在终端里跑（沙盒里起不了 Chrome）

## License

MIT，随便用。改了告诉我一声更好，不告诉也行。
