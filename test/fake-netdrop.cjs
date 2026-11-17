// 测试用的假 Codex / Claude CLI：模拟网络断连。提示词里写 DROP<n> 时前 n 轮都报网络断连退出，之后正常完成；
// 写 FATAL402 时报余额不足（确定性错误，导播台不该重试）。每次启动都把参数记进 args.log。
const fs = require('node:fs');
if (process.argv[2] === '--version') { console.log('fake-netdrop 1.0.0'); process.exit(0); }
const isClaude = process.argv[2] === '-p';
fs.appendFileSync('args.log', JSON.stringify(process.argv.slice(2)) + '\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let text = '';
if (isClaude) {
  process.stdin.on('data', (c) => {
    text += c;
    const i = text.indexOf('\n');
    if (i < 0) return;
    const line = text.slice(0, i);
    const runs = fs.readFileSync('args.log', 'utf8').trim().split('\n').length;
    let promptText = line;
    try { promptText = JSON.parse(line).message.content[0].text; } catch { /* 保持原样 */ }
    const first = fs.existsSync('first-prompt.txt') ? fs.readFileSync('first-prompt.txt', 'utf8') : (fs.writeFileSync('first-prompt.txt', promptText), promptText);
    const drop = Number(/DROP(\d+)/.exec(first)?.[1] || 0);
    out({ type: 'system', subtype: 'init', session_id: 'cl-net', model: 'claude-opus-5-5' });
    if (/FATAL402/.test(first)) {
      out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'cl-net', usage: {}, result: '402 Payment Required: 余额不足' });
      process.exit(1);
    }
    if (runs <= drop) {
      out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'cl-net', usage: {}, result: 'fetch failed: ECONNRESET' });
      process.exit(1);
    }
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Claude 做好了（第 ' + runs + ' 次启动）' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, session_id: 'cl-net', total_cost_usd: 0.01, usage: { input_tokens: 80, output_tokens: 20 }, result: 'ok' });
    process.exit(0);
  });
} else {
  process.stdin.on('data', (c) => { text += c; });
  process.stdin.on('end', () => {
    const runs = fs.readFileSync('args.log', 'utf8').trim().split('\n').length;
    const first = fs.existsSync('first-prompt.txt') ? fs.readFileSync('first-prompt.txt', 'utf8') : (fs.writeFileSync('first-prompt.txt', text), text);
    const drop = Number(/DROP(\d+)/.exec(first)?.[1] || 0);
    out({ type: 'thread.started', thread_id: 'th-net' });
    out({ type: 'turn.started' });
    if (/FATAL402/.test(first)) {
      out({ type: 'turn.failed', error: { message: 'unexpected status 402 Payment Required: 余额不足' } });
      process.stderr.write('ERROR: unexpected status 402 Payment Required: 余额不足\n');
      process.exit(1);
    }
    if (runs <= drop) {
      out({ type: 'error', message: 'stream disconnected before completion: error sending request (ECONNRESET)' });
      out({ type: 'turn.failed', error: { message: 'stream disconnected before completion' } });
      process.stderr.write('ERROR: stream disconnected before completion\n');
      process.exit(1);
    }
    out({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: '做好了（第 ' + runs + ' 次启动）' } });
    out({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
  });
}
