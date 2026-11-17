'use strict';
// 生成课件设计包里的 KaTeX：从 node_modules/katex 取官方发布的文件，字体只留 woff2 并内嵌进 CSS，
// 输出到 electron/agent-kit/kit/vendor（随软件发，任务运行时不再依赖 node_modules）。
// 用法：node scripts/make-kit.cjs（升级 katex 后重跑一次，把生成的文件一起提交）
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'node_modules', 'katex', 'dist');
const out = path.join(root, 'electron', 'agent-kit', 'kit', 'vendor');
fs.mkdirSync(out, { recursive: true });

const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'katex', 'package.json'), 'utf8')).version;
let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
// src:url(a.woff2) format("woff2"),url(a.woff) format("woff"),url(a.ttf) format("truetype") → 只留内嵌的 woff2
css = css.replace(/src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)(?:,url\([^)]*\) format\("[^"]*"\))*/g, (_, name) => {
  const b64 = fs.readFileSync(path.join(dist, 'fonts', name + '.woff2')).toString('base64');
  return `src:url(data:font/woff2;base64,${b64}) format("woff2")`;
});
if (/url\(fonts\//.test(css)) throw new Error('还有没内嵌的字体');
const head = `/* KaTeX ${version} (MIT License, https://katex.org) — fonts embedded as woff2 */\n`;
fs.writeFileSync(path.join(out, 'katex.min.css'), head + css);
const js = (f) => fs.readFileSync(path.join(dist, f), 'utf8');
fs.writeFileSync(path.join(out, 'katex.min.js'), `/* KaTeX ${version} (MIT License) */\n` + js('katex.min.js'));
fs.writeFileSync(path.join(out, 'auto-render.min.js'), `/* KaTeX ${version} auto-render (MIT License) */\n` + js('contrib/auto-render.min.js'));
fs.writeFileSync(path.join(out, 'mhchem.min.js'), `/* KaTeX ${version} mhchem (Apache-2.0 / MIT) */\n` + js('contrib/mhchem.min.js'));
fs.writeFileSync(path.join(out, 'VERSION'), `katex ${version}\n`);
for (const f of fs.readdirSync(out)) console.log(f.padEnd(22), (fs.statSync(path.join(out, f)).size / 1024).toFixed(1) + ' KB');
