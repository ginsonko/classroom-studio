# 样板成品与示例小卡片素材（examples）

统一主题：**高一物理「超重与失重」（人教版 2019 必修第一册）**。九种任务类型围绕同一知识点各做一套标杆成品，同时承担两项职责：
1. **给 AI 工坊当样板**：任务启动时，`electron/agentKit.cjs` 的 `installKit` 把 `examples/` 复制到任务文件夹 `.cs-kit/examples/`（自动**跳过 `_showcase` 目录**，不把视频、轮播图和大体积导出件拷进每次任务）。技能里的「样板：`.cs-kit/examples/<技能名>/`」与「照这个风格做」（`styleRef`）都引用这里的源文件。
2. **给老师看示例小卡片与完整离线预览**：工坊新任务页右侧示例卡、老师预监抽屉与小羽示例推荐卡读取 `examples/manifest.json` 及各子目录的 `_showcase/`。

## 目录与固定顺序

| 序号 | 模板 `id` | 目录（`skill`） | 源文件（复制进 `.cs-kit/examples/`） | `_showcase/`（仅供界面展示与预监） |
|---|---|---|---|---|
| 1 | `html` | `courseware-html` | `超重与失重.html`（引用设计包的源文件）、`说明.md` | 单文件 `超重与失重.html`、`preview.webm`、`poster.webp`、`card.json` |
| 2 | `ppt` | `lecture-slides` | `超重与失重-课件.md`、`配图/*`、`说明.md` | `超重与失重-课件.pptx`、`.pdf`、`shot-1..4.webp`、`card.json` |
| 3 | `quiz` | `practice-set` | 练习 / 答案 / 学生长图 `.md`、`题库.json`、`说明.md` | 导出的 `.docx` / `.pdf` / 长图 `.png`、`shot-1..N.webp`、`card.json` |
| 4 | `homework` | `homework` | 作业 / 答案 / 学生长图 `.md`、`题库.json`、`说明.md` | 导出的 `.docx` / `.pdf` / 长图 `.png`、`shot-1..N.webp`、`card.json` |
| 5 | `test` | `quiz-paper` | 测验 / 答案 `.md`、`题库.json`、`说明.md` | 导出的 `.docx` / `.pdf`、`shot-1..N.webp`、`card.json` |
| 6 | `notes` | `lesson-notes` | `超重与失重-讲义.md`、`说明.md` | 导出的 `.docx` / `.pdf`、`shot-1..N.webp`、`card.json` |
| 7 | `plan` | `lesson-plan` | `超重与失重-教案.md`、`说明.md` | 导出的 `.docx` / `.pdf`、`shot-1..N.webp`、`card.json` |
| 8 | `plugin` | `plugin-dev` | `elevator-scale/`（插件源码）、`说明.md` | `elevator-scale/`（试玩副本）、`preview.webm`、`poster.webp`、`card.json` |
| 9 | `free` | `custom` | 学情长图排版 HTML、力学模型速查源 HTML、太空电梯小游戏 HTML、`说明.md` | 诊断长图 `.png`、打包后的两个单文件 `.html`、`shot-1..3.webp`、`card.json` |

## 维护与校验脚本

- **录制互动预览与截取轮播图**：`npx electron test/quiet.cjs scripts/showcase-capture.cjs`（支持 `--only <技能>` 或 `--shots <技能>`）。
- **汇总 `manifest.json` 并统计体积**：`node scripts/showcase-manifest.cjs`（加 `--strict` 强制检查 9 类齐全且总体积 ≤ 15 MB）。
- **全量示例自动化验收**：`npx electron test/quiet.cjs test/v170-showcase.cjs`（检查 manifest、体积上限、HTML 横竖屏 `htmlProbe`、插件 `pluginSpec`、题库导入解析、文档成品与 `installKit` 跳过 `_showcase`）。
