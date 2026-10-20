---
name: plugin-dev
description: 按插件协议 cs-plugin/1 为「最强网课教辅系统」导播台做插件（浮层小工具、学生画面互动页、黑板图形库、教师页面、AI 技能、导出模板）。
---

# 做导播台插件（cs-plugin/1）

插件 = `plugin` 文件夹里的一组普通文件：`plugin.json` + 网页（HTML/CSS/JS）+ 图片。导播台把它放在独立沙盒里运行：拿不到电脑文件和 API Key，只能通过 `window.cs` 接口请导播台办事。

参考资料（就在本技能文件夹里，动手前至少看一个相近的示例）：
- `reference/sdk.js`：`window.cs` 接口的完整源码（导播台自动注入，插件里不要再引用它）
- `reference/ui.css`：统一样式，插件网页用 `<link rel="stylesheet" href="/__cs/ui.css">` 引用
- `examples/random-picker`：浮层面板 + 存数据 + 写黑板
- `examples/class-timer`：浮层面板 + 投到学生画面的大屏页面（两页通过 storage 同步）
- `examples/math-solids`：黑板图形库（只有 SVG，没有代码）

## 1. 文件夹结构

```
plugin/
  plugin.json     必须
  index.html      面板 / 页面（名字随意，在 plugin.json 里引用）
  icon.svg        插件图标（建议 64×64 的简洁 SVG）
  img/…           图片素材（可选）
  skills/<id>/SKILL.md   AI 技能（可选）
```

限制：最多 600 个文件、总共 40 MB、单个文件 16 MB；不能有 exe/bat/ps1/sh/dll 等可执行文件和快捷方式。所有路径写相对路径，用 `/` 分隔。

## 2. plugin.json

```json
{
  "protocol": "cs-plugin/1",
  "id": "dice-roller",
  "name": "课堂骰子",
  "version": "1.0.0",
  "author": "AI 工坊",
  "description": "一句话说明给老师看",
  "icon": "icon.svg",
  "subjects": ["math"],
  "permissions": ["board"],
  "network": [],
  "contributes": {
    "panels": [{ "id": "main", "title": "骰子", "entry": "index.html", "where": ["console", "dock"], "width": 360, "height": 420 }]
  }
}
```

- `id`：小写字母、数字、短横线，2–40 个字符，装上后不要再改（改了会变成另一个插件）。
- `version`：`1.0.0` 格式。修改已有插件时把最后一位加一。
- `name` 最多 30 字；`description` 最多 300 字。
- `subjects`（可选）：physics、math、chem、bio、chinese、english、history、geo、politics、science。
- `network`（可选）：插件网页需要访问的域名，只写域名（如 `api.example.com`），最多 10 个；不写就完全不能联网。
- `contributes` 至少一项，下面六种可以组合。

### 扩展点

| 键 | 效果 | 字段 |
|---|---|---|
| `panels` | 导播台顶栏「插件」按钮里的浮动面板；`dock` 表示浮层（老师上课用的小窗）里也有 | `id` `title`(≤20字) `entry`(html) `where`: ["console","dock"] `width` 240–900 `height` 160–800 |
| `lessons` | 学生画面页面：老师在插件菜单里一键投到学生画面，像课件一样能批注 | `id` `title` `entry`(html) `subject`(可选) |
| `pages` | 学情页里多一个标签页（教师自己用的工具页，宽屏） | `id` `title`(≤12字) `entry`(html) |
| `shapes` | 黑板绘图库里按学科多一组图形 | `subject` `group`(组名) `items`: [{ `name`, `file`(svg/png/jpg/webp), `width`(可选) }] |
| `skills` | AI 备课里多一种任务 | `id` `label`(≤12字) `hint` `formats`(["docx","pdf","pptx"] 选) `prompt`(可用 `{主题}`)；同时要有 `skills/<id>/SKILL.md` |
| `templates` | 作业/试卷/错题本/教案导出 PDF 时的样式 | `id` `title` `css`(css 文件) `kinds`: homework/paper/wrongbook/lesson/all |

图形库的 SVG：线条一律用 `stroke="currentColor"`、`fill="none"`（导播台会换成黑板笔的颜色），看不见的棱用 `stroke-dasharray`。参照 `examples/math-solids/shapes`。

### 权限（permissions）

只申请真正要调用的：

| 权限 | 能做什么 |
|---|---|
| `student` | `cs.student.current()` 读当前学生的名字、年级、学科 |
| `board` | `cs.board.addText / addImage / addSvg` 往黑板上放东西 |
| `present` | `cs.present.open(页面)` 把插件里的页面投到学生画面 |
| `bank.read` | `cs.bank.list()` 读题库 |
| `bank.write` | `cs.bank.add()` 往题库收件箱加题（老师核对后才入库） |
| `ai` | `cs.ai.chat / ask` 调用 AI 文字、看图（花费记入老师的账本） |
| `ai.image` | `cs.ai.image` 生成图片（花费记入账本） |
| `files` | `cs.files.pick()` 请老师选文件，插件拿到内容 |

`app.info`、`storage.*`、`ui.*` 不需要权限。

## 3. window.cs 接口

所有调用都返回 Promise，失败时 reject 一个 `Error`（message 是中文原因）。页面一开始就能用 `cs`，需要上下文时 `await cs.ready`。

```js
await cs.ready;                       // → cs.context：{ where, subject, scheme, theme, plugin }
// where：console 导播台面板 / dock 浮层 / page 教师页面 / lesson 学生画面 / preview AI 工坊预览
cs.on('theme', () => {});             // 老师换皮肤时触发（CSS 变量已自动更新）
await cs.app.info();                  // { app, protocol, where, subject, role }
await cs.student.current();           // { id, name, grade, subject }
await cs.board.addText('文字', { size: 'l', color: 'ink' });   // size: s/m/l/xl；color: ink 或 #rrggbb
await cs.board.addImage('img/a.png'); // 插件自己的文件，或 data:image/... 地址
await cs.board.addSvg('<svg …>…</svg>');
await cs.present.open('screen.html', { title: '大号计时' });
await cs.bank.list({ query: '浮力', subject: 'physics', limit: 50 });  // [{ id, stem, answer, analysis, qtype, difficulty, points }]
await cs.bank.add({ stem, answer, analysis, qtype: '选择题', difficulty: 3 });
const text = await cs.ai.ask('用一句话解释浮力');                // 字符串
const r = await cs.ai.chat([{ role: 'user', content: '…' }], { json: true, maxTokens: 2000 }); // { content, model }
const img = await cs.ai.image('一只橙色的猫，扁平插画', { size: '1024x1024' });       // { image: 'data:image/png;base64,…' }
const files = await cs.files.pick({ accept: 'image', multiple: false });   // accept: image/text/pdf/doc；[{ name, size, type, dataUrl, text? }]
await cs.storage.set('key', 任意可转 JSON 的值);  await cs.storage.get('key');  // 插件自己的数据（总共 2 MB），同一插件的各个页面共用
await cs.storage.remove('key');  await cs.storage.keys();
await cs.ui.toast('已写到黑板');  cs.ui.close();  cs.ui.resize(400, 500);
```

学生画面（where = lesson）里只能用 `app.info`、`storage.get/keys`、`ui.toast`：学生画面的页面通常只负责显示，由老师面板写 storage、学生页面每 0.5–1 秒读一次来同步（见 class-timer）。

## 4. 界面风格

- 引用 `/__cs/ui.css`，用里面的类：`.cs-wrap`（页面容器）、`.cs-card`、`.cs-row`、`.cs-grow`、`.cs-muted`、`.cs-primary`（主按钮）、`.cs-danger`、`.cs-big`（大号数字）、`.cs-chip`。
- 颜色只用变量：`--cs-bg / --cs-bg-2 / --cs-bg-3 / --cs-line / --cs-fg / --cs-fg-2 / --cs-fg-3 / --cs-accent / --cs-accent-soft / --cs-ok / --cs-warn / --cs-danger`，深色、浅色皮肤都好看。
- 面板很窄（宽 340–420 像素）：一屏放下，不要横向滚动；按钮至少 32 像素高。
- 学生画面页面（lessons）是全屏大屏：字号用 vw/vh，背景深色、对比强，动画流畅（requestAnimationFrame / CSS 动画 / Canvas / SVG 都可以）。
- 互动课件、实验动画：提供「播放 / 暂停 / 重来 / 下一步」按钮和可拖的参数滑块；每一步配简短的中文说明。
- 不要引用外部脚本、字体、CDN；需要的库请自己写一个精简版。

## 5. 素材图片

需要插图、背景时，优先用 SVG 自己画。确实需要 AI 生成的图片时，在当前文件夹（plugin 的上一级）写 `素材需求.json`：

```json
[{ "file": "img/lab-bg.png", "prompt": "实验室桌面俯视图，扁平插画风格，浅色背景，无文字", "size": "1536x1024" }]
```

导播台会在这一轮结束后用老师的 AI 接口生成，存到 `plugin/img/lab-bg.png`（已经存在的不会重复生成，一轮最多 6 张，花费记入账本）。代码里直接按这个路径引用；生成完成前图片会暂时显示不出来，属正常。

## 6. 自检清单（写完逐条核对）

1. `plugin.json` 是合法 JSON，`protocol`、`id`、`name`、`version`、`contributes` 都有，引用的每个文件都存在。
2. 每个 HTML 都有 `<meta charset="utf-8">` 和 `<title>`，引用了 `/__cs/ui.css`。
3. 用到的每个 `cs.*` 接口都申请了对应权限，没用到的权限不申请。
4. 所有调用都处理了失败（`.catch` 或 try/catch），出错时在页面上用中文提示。
5. 没有外部网址（除非写在 `network` 里），没有 `alert()` 弹窗，没有 `console.log` 刷屏。
6. 改已有插件时 `version` 加一、`id` 不变。

每轮结束导播台会自动校验，并在右侧实时预览；老师满意后点「装上」，插件就出现在导播台里。
