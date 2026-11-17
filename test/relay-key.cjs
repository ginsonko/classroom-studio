// 真实 AI 测试用：在内存里读出老师配好的 AI 接口（只读 ai.json 和解密用的 Local State，不复制到任何地方），
// 交给测试进程的环境变量 CS_TEST_RELAY_KEY / CS_TEST_RELAY_BASE / CS_TEST_RELAY_MODEL。绝不打印 Key。
// Electron 的 safeStorage 在 Windows 上就是 Chromium 的 os_crypt：Local State 里有一把用 DPAPI 包起来的 AES 密钥，
// 数据是 "v10" + 12 字节 nonce + 密文 + 16 字节 tag（AES-256-GCM）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REAL = process.env.CS_REAL_DATA || String.raw`H:\ClassroomStudioData`;

function dpapi(buf) {
  const ps = 'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: buf.toString('base64'), windowsHide: true, encoding: 'utf8' });
  return Buffer.from(out.trim(), 'base64');
}

/** { baseUrl, model, key }；没配置时 key 为空 */
function readRelay(real = REAL) {
  const cfg = JSON.parse(fs.readFileSync(path.join(real, 'ai.json'), 'utf8'));
  const baseUrl = String(cfg.baseUrl || 'https://api.yinziapi.top/v1').replace(/\/+$/, '');
  if (!cfg.key) return { baseUrl, model: cfg.model || '', key: '' };
  const raw = Buffer.from(cfg.key, 'base64');
  if (cfg.enc !== 'safe') return { baseUrl, model: cfg.model || '', key: raw.toString('utf8') };
  const state = JSON.parse(fs.readFileSync(path.join(real, 'browser', 'Local State'), 'utf8'));
  const wrapped = Buffer.from(state.os_crypt.encrypted_key, 'base64');
  if (wrapped.subarray(0, 5).toString() !== 'DPAPI') throw new Error('Local State 的密钥格式不认识');
  const aes = dpapi(wrapped.subarray(5));
  if (raw.subarray(0, 3).toString() !== 'v10') throw new Error('ai.json 的密文格式不认识');
  const nonce = raw.subarray(3, 15), body = raw.subarray(15, raw.length - 16), tag = raw.subarray(raw.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', aes, nonce); d.setAuthTag(tag);
  return { baseUrl, model: cfg.model || '', key: Buffer.concat([d.update(body), d.final()]).toString('utf8') };
}

/** 子进程环境：Key 只在这里 */
function relayEnv(real = REAL) {
  const r = readRelay(real);
  return { CS_TEST_RELAY_KEY: r.key, CS_TEST_RELAY_BASE: r.baseUrl, CS_TEST_RELAY_MODEL: r.model };
}

module.exports = { readRelay, relayEnv };
if (require.main === module) { const r = readRelay(); console.log(JSON.stringify({ baseUrl: r.baseUrl, model: r.model, hasKey: !!r.key, len: r.key.length })); }
