#!/usr/bin/env node
// 把官方 Codex CLI（Windows x64 原生版）放进 bin/codex，打包时随 bin 一起进安装包。
//   node scripts/fetch-codex.mjs [--version 0.163.0] [--tgz 本地包.tgz]
// 不写版本就用 npm 上的最新版；已经是这个版本时什么也不做。
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stageCodex } = require('../electron/codexDist.cjs');
const root = path.resolve(import.meta.dirname, '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

try {
  const ver = await stageCodex({
    version: arg('--version') || process.env.CS_CODEX_VERSION,
    tgz: arg('--tgz') ? path.resolve(arg('--tgz')) : '',
    out: path.join(root, 'bin', 'codex'),
    onProgress: (m) => console.log(m),
  });
  console.log(`Codex CLI ${ver} staged in bin/codex`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
