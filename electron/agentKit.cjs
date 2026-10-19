'use strict';
// 内置给 Codex / Claude 的工作手册：一段固定的开发者指令 + 一组技能（每种常用成品一份 SKILL.md）。
// 每个任务启动时把技能放进任务文件夹（以点开头的隐藏目录，不算成果），CLI 自己就能发现；
// 任务点名技能时，提示词开头再明确让它先读那份 SKILL.md，确保马上聚焦。
const fs = require('node:fs');
const path = require('node:path');

const KIT = path.join(__dirname, 'agent-kit');
const SKILL_ROOT = { codex: path.join('.agents', 'skills'), claude: path.join('.claude', 'skills') };

function skills() {
  try {
    return fs.readdirSync(path.join(KIT, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(KIT, 'skills', d.name, 'SKILL.md'))).map((d) => d.name).sort();
  } catch { return []; }
}

let cached = '';
function instructions() {
  if (!cached) cached = fs.readFileSync(path.join(KIT, 'instructions.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  return cached;
}

const skillFile = (engine, id) => path.join(SKILL_ROOT[engine] || SKILL_ROOT.codex, id, 'SKILL.md').replace(/\\/g, '/');

/** 把技能复制进任务文件夹；每轮都调用，已有且一样的就跳过（导播台升级后旧任务也能拿到新版技能） */
function installKit(work, engine) {
  const dest = path.join(work, SKILL_ROOT[engine] || SKILL_ROOT.codex);
  for (const id of skills()) {
    const src = path.join(KIT, 'skills', id, 'SKILL.md'), to = path.join(dest, id, 'SKILL.md');
    const body = fs.readFileSync(src);
    try { if (fs.readFileSync(to).equals(body)) continue; } catch { /* 还没有 */ }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, body);
  }
  return dest;
}

/** 点名了技能时，放在老师写的要求前面的那句话 */
function skillLead(engine, id) {
  if (!id || !skills().includes(id)) return '';
  const also = ['practice-set', 'homework', 'quiz-paper'].includes(id) ? `和 ${skillFile(engine, 'question-json')}` : '';
  return `先读技能文件 ${skillFile(engine, id)}${also}，严格按其中的流程和格式完成下面的任务。\n\n`;
}

module.exports = { skills, instructions, installKit, skillLead, skillFile };
