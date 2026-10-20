'use strict';
// 内置给 Codex / Claude 的工作手册：一段固定的开发者指令 + 一组技能（每种常用成品一份 SKILL.md）。
// 每个任务启动时把技能放进任务文件夹（以点开头的隐藏目录，不算成果），CLI 自己就能发现；
// 任务点名技能时，提示词开头再明确让它先读那份 SKILL.md，确保马上聚焦。
const fs = require('node:fs');
const path = require('node:path');

const KIT = path.join(__dirname, 'agent-kit');
const SKILL_ROOT = { codex: path.join('.agents', 'skills'), claude: path.join('.claude', 'skills') };

// 插件带来的技能：[{ key, dir }]，由主进程注入（只算启用中的插件）
let extra = () => [];
function setExtra(fn) { extra = typeof fn === 'function' ? fn : () => []; }
function extraSkills() { try { return extra().filter((s) => s && s.key && fs.existsSync(path.join(s.dir, 'SKILL.md'))); } catch { return []; } }

function builtin() {
  try {
    return fs.readdirSync(path.join(KIT, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(KIT, 'skills', d.name, 'SKILL.md'))).map((d) => d.name).sort();
  } catch { return []; }
}
function skills() { return [...builtin(), ...extraSkills().map((s) => s.key)]; }

/** 整个技能文件夹复制过去（技能可以带参考文档、示例、脚本），内容一样的文件跳过 */
function copyFile(from, to) {
  const body = fs.readFileSync(from);
  try { if (fs.readFileSync(to).equals(body)) return; } catch { /* 还没有 */ }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, body);
}
function copyDir(src, dest) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(from, to);
    else if (e.isFile()) copyFile(from, to);
  }
}

const cached = {};
// 安装软件 / 依赖的规矩跟着老师选的权限走：完全访问时缺什么就装什么，不要拒绝
const RULES = {
  safe: '- 当前是「安全模式」：不能联网，也不要安装任何软件或依赖。只在核对数字、检查文件时才运行命令。缺工具时换一种不需要它的做法，并在回复里告诉老师可以把权限调到「常用权限」或「完全访问」。',
  full: '- 当前是「常用权限」：可以运行命令、联网查资料和下载素材。确实需要某个工具或库时，只能装在当前文件夹里（例如 pip install --target .\\_deps、在当前文件夹里 npm install），不要改动系统和全局环境；装不上就换一种不需要它的做法，不要卡住。',
  danger: '- 当前是「完全访问」，老师已经同意你安装需要的软件和依赖：缺什么（Python 包、npm 包、命令行工具、字体等）就直接装，装好后接着把任务做完，不要因为"不能安装"而拒绝或停下来。国内网络优先用镜像：pip 加 -i https://mirrors.cloud.tencent.com/pypi/simple/（不通时换 https://mirrors.aliyun.com/pypi/simple/），npm 加 --registry=https://registry.npmmirror.com。不要卸载或改动和任务无关的软件，不要碰老师的个人文件；回复里说明装了什么。',
};
const PLUGIN_RULES = {
  safe: RULES.safe,
  full: '- 当前是「常用权限」：可以运行命令、联网查资料。插件需要的第三方库（例如图表、公式渲染）可以下载后放进 plugin 文件夹本地引用，并在 plugin.json 的说明里注明来源和许可证；不要改动系统和全局环境。',
  danger: '- 当前是「完全访问」，老师已经同意你安装需要的软件和依赖：做插件时缺工具（比如用来生成素材、压缩图片的程序）可以直接装，国内网络优先用镜像（pip 用 https://mirrors.cloud.tencent.com/pypi/simple/ 或 https://mirrors.aliyun.com/pypi/simple/，npm 用 https://registry.npmmirror.com）。插件需要的第三方库下载后放进 plugin 文件夹本地引用，注明来源和许可证。不要卸载或改动和任务无关的软件，回复里说明装了什么。',
};
/** kind = 'plugin' 时是 AI 工坊做插件用的那份；perm 是任务的权限（safe / full / danger） */
function instructions(kind = '', perm = 'full') {
  const file = kind === 'plugin' ? 'plugin-instructions.md' : 'instructions.md';
  if (!cached[file]) cached[file] = fs.readFileSync(path.join(KIT, file), 'utf8').replace(/\r\n/g, '\n').trim();
  const rules = kind === 'plugin' ? PLUGIN_RULES : RULES;
  return cached[file].replace('{{权限}}', rules[perm] || rules.full);
}

// 插件技能的参考资料（SDK、样式、示例插件）只维护 plugin-kit 那一份，装技能时一起带过去
const PLUGIN_KIT = path.join(__dirname, 'plugin-kit');
function addPluginReference(skillDir) {
  if (!fs.existsSync(skillDir)) return;
  for (const f of ['sdk.js', 'ui.css']) { try { copyFile(path.join(PLUGIN_KIT, f), path.join(skillDir, 'reference', f)); } catch { /* 缺文件就算了 */ } }
  try { copyDir(path.join(PLUGIN_KIT, 'examples'), path.join(skillDir, 'examples')); } catch { /* 没带示例 */ }
}

const skillFile = (engine, id) => path.join(SKILL_ROOT[engine] || SKILL_ROOT.codex, id, 'SKILL.md').replace(/\\/g, '/');

/** 把技能复制进任务文件夹；每轮都调用，已有且一样的就跳过（导播台升级后旧任务也能拿到新版技能） */
function installKit(work, engine) {
  const dest = path.join(work, SKILL_ROOT[engine] || SKILL_ROOT.codex);
  for (const id of builtin()) copyDir(path.join(KIT, 'skills', id), path.join(dest, id));
  addPluginReference(path.join(dest, 'plugin-dev'));
  for (const s of extraSkills()) copyDir(s.dir, path.join(dest, s.key));
  return dest;
}

/** 点名了技能时，放在老师写的要求前面的那句话 */
function skillLead(engine, id) {
  if (!id || !skills().includes(id)) return '';
  const also = ['practice-set', 'homework', 'quiz-paper'].includes(id) ? `和 ${skillFile(engine, 'question-json')}` : '';
  return `先读技能文件 ${skillFile(engine, id)}${also}，严格按其中的流程和格式完成下面的任务。\n\n`;
}

module.exports = { skills, instructions, installKit, skillLead, skillFile, setExtra };
