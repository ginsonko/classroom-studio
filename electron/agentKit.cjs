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
/** kind = 'plugin' 时是 AI 工坊做插件用的那份 */
function instructions(kind = '') {
  const file = kind === 'plugin' ? 'plugin-instructions.md' : 'instructions.md';
  if (!cached[file]) cached[file] = fs.readFileSync(path.join(KIT, file), 'utf8').replace(/\r\n/g, '\n').trim();
  return cached[file];
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
