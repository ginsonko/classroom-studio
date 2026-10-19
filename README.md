# 最强网课教辅系统

一对一网课老师的上课、录课、备课一体化桌面软件。在腾讯会议里共享「课堂展示」窗口，学生看到的是干净的课件和黑板；老师这边有自己的导播台：预览、批注、遮答案、AI 讲题、自动录课，学生都看不到。

- 官网与下载：<https://classroom.yinziapi.top>
- GitHub 下载：[Releases](https://github.com/ginsonko/classroom-studio/releases/latest)
- 交流与反馈：QQ 群 **1035471769**
- 授权：个人老师免费（包括自己的收费家教课）；公司、学校、培训机构等单位使用需授权，见 [LICENSE](LICENSE)

## 主要功能

| 场景 | 能做什么 |
| --- | --- |
| 上课 | 老师端预览 → 一键切给学生；资料库支持拼音首字母搜索；PDF / PPT / Word / 图片 / 视频 / 网页课件；多窗口并排、黑板；本课流程一键上屏 |
| 批注 | 压感钢笔（超细到粗 + 自由粗细）、荧光笔、形状、物理器材库（力学/场/电路）、手写公式识别；学生也能在自己窗口上写 |
| 答案遮挡 | 自动识别答案页（PDF 文字层、PPT 文本、本机 OCR），学生端默认遮住，浮层里「揭晓 / 收回」 |
| AI 助手 | 讲这道题、画到黑板、做成可调参数的物理/数学/化学演示、讲解动画（Manim）；兼容任何 OpenAI 格式接口 |
| 演示库 | 33 个不用 AI 的互动演示：追及相遇、传送带、板块模型、圆周运动、函数图像、圆锥曲线、滴定曲线…… |
| 录课回放 | 上课自动录学生窗口 + 麦克风 + 电脑声音，下课转 MP4，按学生归档 |
| 学情 | 截屏收题、错题本、知识网络、一键组作业、课后总结发家长（企业微信 / 邮件 / 长图） |
| 备课 | AI 工作室：内置 Codex CLI，生成互动课件、讲课 PPT、练习题、测验卷、教案，题目可直接导入题库 |
| 自动更新 | 只下载变化的部分，随时可以跳过，从不强制 |

软件内按 <kbd>F1</kbd> 或左栏「帮助」打开完整说明书。

## 安装

**Windows 10/11（x64）**：下载 `最强网课教辅系统-<版本>-win-x64.zip`，解压到一个固定位置（例如 `D:\最强网课教辅系统`），双击 `ClassroomStudio.exe`。

**macOS（Apple 芯片 arm64 / Intel x64）**：下载对应的 `mac-arm64` 或 `mac-x64` 压缩包，解压后右键「安装并打开.command」→ 打开。macOS 版没有苹果开发者签名、尚未实机测试，和 Windows 版的差别见压缩包里的「先看我-macOS安装说明.txt」。

## 从源码运行

需要 Node.js 22+。

```bash
npm install
npm run dev          # 浏览器预览（使用 public/mock 里的示例资料）
npm run build && npm start   # 桌面版
```

桌面版用到的外部程序放在 `bin/`（不在仓库里）：

- `node scripts/fetch-codex.mjs`：下载官方 Codex CLI 到 `bin/codex`（AI 工作室用）。
- Windows 录课需要 `bin/ffmpeg.exe`，可从 <https://www.gyan.dev/ffmpeg/builds/> 下载 full build 放进去。

## 打包发布

```bash
npm run typecheck
node scripts/release.mjs                    # Windows x64 + macOS arm64/x64
node scripts/release.mjs --only win32-x64   # 只打一个平台
```

输出在 `../release/dist-<版本>/`：完整安装包、`update/` 下按部分（app / codex / ffmpeg / runtime）拆开的更新包，以及用 Ed25519 签名的 `latest.json`。签名私钥不在仓库里，自己打包需要生成自己的密钥并替换 `electron/updater.cjs` 里的公钥。

## 目录

```
electron/   主进程：窗口、课件转换、录课、AI、更新
src/        界面（React）：teacher 老师端、stage 学生窗口、dock 浮层、help 说明书
public/     浏览器预览用的示例资料（原创示例题，由 scripts/make-sample-mock.cjs 生成）
scripts/    打包、发布、示例资料生成
test/       自动化测试（大多在 Electron 里离屏运行）
```

## 第三方组件

Electron（MIT）、OpenAI Codex CLI（Apache-2.0）、FFmpeg（GPL v3，作为独立程序调用）、pdf.js（Apache-2.0）、React、three.js、KaTeX、MathJax 等，均按各自的许可协议使用。
