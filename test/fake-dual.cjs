// 测试用：同一个假 Codex 既当小羽的 app-server（记下启动参数），又当 AI 工坊的 exec（记下每轮参数）
if (process.argv.includes('app-server')) require('./fake-app-server-argv.cjs');
else require('./fake-agent.cjs');
