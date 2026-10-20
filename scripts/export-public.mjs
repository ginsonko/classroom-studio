// 把要公开的源码同步到一个干净目录（GitHub 仓库的工作区），并扫描有没有密钥、个人路径、私人资料。
//   node scripts/export-public.mjs <目标目录>
// 目标目录里除了 .git 之外的内容都会被替换。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || target === root || root.startsWith(target + path.sep)) { console.error('用法：node scripts/export-public.mjs <目标目录>'); process.exit(2); }

const INCLUDE = ['src', 'electron', 'public', 'scripts', 'test', 'build', 'index.html', 'export.html', 'office.html', 'motion.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'LICENSE', 'README.md'];
// 内部用的实测脚本、旧版启动器、本机截图脚本：带本机路径或真实资料，不公开
const EXCLUDE = [/^test\/real(\/|$)/, /^test\/[^/]*-shots\.ps1$/, /^test\/live-dock-click\.ps1$/, /^scripts\/launchers\.ps1$/, /^test\/film-shoot\.cjs$/];
const GITIGNORE = ['node_modules/', 'dist/', '.out/', 'bin/', '*.pem', '*.log', ''].join('\n');

const LEAKS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
  [/\bsk-(?!yinzitest|barekey|…)[A-Za-z0-9]{20,}/, 'API Key'],
  [/C:[\\/]Users[\\/]Administrator/i, '本机用户目录'],
];
// 学生姓名、机构名这类私人词放在仓库外：每行一个
const words = path.join(os.homedir(), '.classroom-studio-release', 'private-words.txt');
if (fs.existsSync(words)) for (const w of fs.readFileSync(words, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) LEAKS.push([new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '私人词']);

fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(target)) if (name !== '.git') fs.rmSync(path.join(target, name), { recursive: true, force: true });

const found = [];
let count = 0;
const copy = (rel) => {
  if (EXCLUDE.some((re) => re.test(rel))) return;
  const src = path.join(root, rel), st = fs.statSync(src);
  if (st.isDirectory()) { for (const n of fs.readdirSync(src)) copy(rel + '/' + n); return; }
  const dst = path.join(target, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  count++;
  if (st.size < 4 * 1048576 && !/\.(png|jpe?g|ico|icns|woff2?|ttf|wasm)$/i.test(rel)) {
    const text = fs.readFileSync(src, 'utf8');
    for (const [re, what] of LEAKS) if (re.test(text)) found.push(`${rel}：${what}（${text.match(re)[0].slice(0, 40)}）`);
  }
};
for (const rel of INCLUDE) copy(rel);
// 软件读 raw.githubusercontent.com/…/main/mirrors.json 作为加速代理名单的备用源
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mirrors = path.resolve(root, '../release/dist-' + version, 'mirrors.json');
if (fs.existsSync(mirrors)) { fs.copyFileSync(mirrors, path.join(target, 'mirrors.json')); count++; }
else console.warn('没找到 ' + mirrors + '，公开仓库的 mirrors.json 不会更新');
fs.writeFileSync(path.join(target, '.gitignore'), GITIGNORE);
fs.writeFileSync(path.join(target, '.gitattributes'), '* text=auto eol=lf\n*.png binary\n*.ico binary\n*.icns binary\n*.wasm binary\n');

console.log(`已复制 ${count} 个文件到 ${target}`);
if (found.length) { console.error('发现疑似泄露，请处理后再公开：\n  ' + found.join('\n  ')); process.exit(1); }
console.log('泄露扫描通过');
