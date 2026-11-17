'use strict';
/**
 * 汇总 electron/agent-kit/examples/<技能>/_showcase/card.json → examples/manifest.json
 *
 * 用法：
 *   node scripts/showcase-manifest.cjs            # 汇总现有卡片写 manifest.json，缺卡报提示，坏引用报错退出
 *   node scripts/showcase-manifest.cjs --strict   # 要求 9 类全部齐全、所有引用存在且总体积 ≤ 15 MB，否则退出码 1
 */
const fs = require('node:fs');
const path = require('node:path');

const TOPIC = '高一物理 · 超重与失重（人教版必修一）';
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const VALID_KINDS = new Set(['html', 'pdf', 'pptx', 'docx', 'png', 'plugin']);

const FIXED_ORDER = [
  ['html', 'courseware-html'],
  ['ppt', 'lecture-slides'],
  ['quiz', 'practice-set'],
  ['homework', 'homework'],
  ['test', 'quiz-paper'],
  ['notes', 'lesson-notes'],
  ['plan', 'lesson-plan'],
  ['plugin', 'plugin-dev'],
  ['free', 'custom'],
];

function walkBytes(dir) {
  let total = 0;
  let files = 0;
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store' || e.name === 'Thumbs.db') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = walkBytes(p);
      total += sub.bytes;
      files += sub.files;
    } else if (e.isFile()) {
      total += fs.statSync(p).size;
      files += 1;
    }
  }
  return { bytes: total, files };
}

function checkRelRef(examplesDir, rel, { expectDir = false, forbidShowcase = false } = {}) {
  if (typeof rel !== 'string' || !rel.trim()) return '路径为空';
  if (rel.includes('\\')) return `路径必须使用正斜杠 "/"：${rel}`;
  if (rel.startsWith('/') || rel.includes(':') || rel.split('/').some((s) => !s || s === '.' || s === '..')) {
    return `非法相对路径：${rel}`;
  }
  if (forbidShowcase && rel.split('/').includes('_showcase')) {
    return `styleRef 不能引用 _showcase 目录：${rel}`;
  }
  const abs = path.resolve(examplesDir, ...rel.split('/'));
  if (!fs.existsSync(abs)) return `引用文件不存在：${rel}`;
  const st = fs.statSync(abs);
  if (expectDir) {
    if (!st.isDirectory()) return `插件路径应为文件夹：${rel}`;
    if (!fs.existsSync(path.join(abs, 'plugin.json'))) return `插件文件夹缺少 plugin.json：${rel}`;
  } else {
    if (!st.isFile()) return `引用路径不是普通文件：${rel}`;
    if (st.size === 0) return `引用文件为空（0 字节）：${rel}`;
  }
  return '';
}

function validateCard(examplesDir, expectedId, expectedSkill, card) {
  const errors = [];
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return ['card.json 不是对象'];
  }
  if (card.id !== expectedId) errors.push(`${expectedSkill}: id 应为 "${expectedId}"，实际为 "${card.id}"`);
  if (card.skill !== expectedSkill) errors.push(`${expectedSkill}: skill 应为 "${expectedSkill}"，实际为 "${card.skill}"`);
  for (const k of ['label', 'one', 'formats', 'cost']) {
    if (typeof card[k] !== 'string' || !card[k].trim()) errors.push(`${expectedSkill}: 缺少非空字符串字段 ${k}`);
  }
  if (typeof card.cost === 'string' && !card.cost.includes('仅估算')) {
    errors.push(`${expectedSkill}: cost 需标注「仅估算」（实际：${card.cost}）`);
  }
  if (!Array.isArray(card.highlights) || card.highlights.length < 3) {
    errors.push(`${expectedSkill}: highlights 至少需要 3 条亮点`);
  }
  if (!Array.isArray(card.when) || card.when.length < 2) {
    errors.push(`${expectedSkill}: when 至少需要 2 个适用场景`);
  }

  // preview
  const p = card.preview;
  if (!p || typeof p !== 'object') {
    errors.push(`${expectedSkill}: 缺少 preview 对象`);
  } else if (p.type === 'video') {
    for (const f of ['src', 'poster']) {
      const err = checkRelRef(examplesDir, p[f]);
      if (err) errors.push(`${expectedSkill} preview.${f}: ${err}`);
    }
  } else if (p.type === 'slides') {
    if (!Array.isArray(p.images) || p.images.length < 3) {
      errors.push(`${expectedSkill} preview.images: 轮播图至少需要 3 张`);
    } else {
      p.images.forEach((img, i) => {
        const err = checkRelRef(examplesDir, img);
        if (err) errors.push(`${expectedSkill} preview.images[${i}]: ${err}`);
      });
    }
  } else {
    errors.push(`${expectedSkill}: preview.type 必须是 "video" 或 "slides"`);
  }

  // full
  if (!Array.isArray(card.full) || !card.full.length) {
    errors.push(`${expectedSkill}: full 至少需要 1 个完整示例条目`);
  } else {
    card.full.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') {
        errors.push(`${expectedSkill} full[${i}]: 不是对象`);
        return;
      }
      if (!entry.label || typeof entry.label !== 'string') errors.push(`${expectedSkill} full[${i}]: 缺少 label`);
      if (!VALID_KINDS.has(entry.kind)) errors.push(`${expectedSkill} full[${i}]: 不支持的 kind "${entry.kind}"`);
      const err = checkRelRef(examplesDir, entry.file, { expectDir: entry.kind === 'plugin' });
      if (err) errors.push(`${expectedSkill} full[${i}].file: ${err}`);
    });
  }

  // styleRef
  if (!Array.isArray(card.styleRef) || !card.styleRef.length) {
    errors.push(`${expectedSkill}: styleRef 至少需要 1 个源文件参考路径`);
  } else {
    card.styleRef.forEach((ref, i) => {
      const err = checkRelRef(examplesDir, ref, { forbidShowcase: true });
      if (err) errors.push(`${expectedSkill} styleRef[${i}]: ${err}`);
    });
  }

  return errors;
}

function buildManifest({
  examplesDir = path.resolve(__dirname, '..', 'electron', 'agent-kit', 'examples'),
  write = true,
  strict = false,
} = {}) {
  const items = [];
  const missingCards = [];
  const errors = [];
  const folderStats = [];

  for (const [expectedId, folder] of FIXED_ORDER) {
    const dir = path.join(examplesDir, folder);
    const cardPath = path.join(dir, '_showcase', 'card.json');
    const allStat = walkBytes(dir);
    const showStat = walkBytes(path.join(dir, '_showcase'));
    folderStats.push({
      id: expectedId,
      skill: folder,
      totalBytes: allStat.bytes,
      showcaseBytes: showStat.bytes,
      sourceBytes: allStat.bytes - showStat.bytes,
      hasCard: fs.existsSync(cardPath),
    });

    if (!fs.existsSync(cardPath)) {
      missingCards.push(folder);
      continue;
    }

    let card;
    try {
      card = JSON.parse(fs.readFileSync(cardPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      errors.push(`${folder}/_showcase/card.json JSON 解析失败：${e.message}`);
      continue;
    }

    const cardErrs = validateCard(examplesDir, expectedId, folder, card);
    errors.push(...cardErrs);
    items.push(card);
  }

  const manifest = {
    version: 1,
    topic: TOPIC,
    items,
  };

  const outPath = path.join(examplesDir, 'manifest.json');
  if (write) {
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  const total = walkBytes(examplesDir);
  if (total.bytes > MAX_TOTAL_BYTES) {
    errors.push(`examples 目录总体积超标：${(total.bytes / 1024 / 1024).toFixed(2)} MB > 15.00 MB`);
  }
  if (strict && missingCards.length) {
    errors.push(`尚缺 ${missingCards.length} 个类型的 _showcase/card.json：${missingCards.join('、')}`);
  }

  return {
    ok: errors.length === 0 && (!strict || missingCards.length === 0),
    manifest,
    outPath,
    itemsCount: items.length,
    missingCards,
    errors,
    totalBytes: total.bytes,
    totalFiles: total.files,
    maxBytes: MAX_TOTAL_BYTES,
    folderStats,
  };
}

module.exports = { buildManifest, FIXED_ORDER, TOPIC, MAX_TOTAL_BYTES };

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  const noWrite = process.argv.includes('--no-write');
  const r = buildManifest({ write: !noWrite, strict });

  console.log(`=== Showcase Manifest 汇总 (${r.itemsCount}/${FIXED_ORDER.length}) ===`);
  for (const st of r.folderStats) {
    const mark = st.hasCard ? '✓' : '…';
    console.log(
      `  ${mark} ${st.id.padEnd(8)} ${st.skill.padEnd(16)} 总计 ${(st.totalBytes / 1024).toFixed(1).padStart(7)} KB` +
      ` （源 ${(st.sourceBytes / 1024).toFixed(1).padStart(6)} KB + _showcase ${(st.showcaseBytes / 1024).toFixed(1).padStart(7)} KB）`
    );
  }
  console.log(`合计体积：${(r.totalBytes / 1024 / 1024).toFixed(2)} MB / ${(r.maxBytes / 1024 / 1024).toFixed(2)} MB（共 ${r.totalFiles} 个文件）`);
  if (!noWrite) console.log(`已写出：${r.outPath}`);
  if (r.missingCards.length) {
    console.log(`${strict ? 'ERROR' : 'WARN'} 尚未就绪的 card.json（${r.missingCards.length} 个）：${r.missingCards.join(', ')}`);
  }
  if (r.errors.length) {
    console.error('校验发现问题：\n  - ' + r.errors.join('\n  - '));
    process.exit(1);
  }
}
