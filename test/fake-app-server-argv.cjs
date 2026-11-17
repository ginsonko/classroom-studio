// 包一层假 app-server：先把启动参数和档位相关的环境变量记到 FAKE_ARGV，再照常跑 fake-app-server.cjs
const fs = require('node:fs');
if (process.env.FAKE_ARGV && process.argv.includes('app-server')) fs.appendFileSync(process.env.FAKE_ARGV, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), home: process.env.CODEX_HOME || '' }) + '\n');
require('./fake-app-server.cjs');
