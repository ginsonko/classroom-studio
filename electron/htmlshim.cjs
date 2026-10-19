// 本地网页课件经 lesson:// 打开时，Chromium 不给自定义协议存 cookie，
// 依赖 cookie 记设置/登录状态的课件会每次回到初始状态。这里在页面最前面补一个
// 用本页 localStorage 模拟的 document.cookie（原生 cookie 可用时不替换）。
const SHIM = `<script>(function(){try{document.cookie='__cs_probe=1';if(document.cookie.indexOf('__cs_probe=1')>=0)return}catch(e){}
var K='__cs_cookie__';function load(){try{return JSON.parse(localStorage.getItem(K)||'{}')}catch(e){return{}}}
function save(o){try{localStorage.setItem(K,JSON.stringify(o))}catch(e){}}
Object.defineProperty(document,'cookie',{configurable:true,get:function(){var o=load(),n=Date.now(),a=[];for(var k in o){if(o[k].e&&o[k].e<n)continue;a.push(k+'='+o[k].v)}return a.join('; ')},
set:function(s){var p=String(s).split(';'),kv=p[0],i=kv.indexOf('=');if(i<0)return;var k=kv.slice(0,i).trim(),v=kv.slice(i+1).trim(),e=0;
for(var j=1;j<p.length;j++){var q=p[j].trim(),l=q.toLowerCase();if(l.indexOf('max-age=')===0)e=Date.now()+Number(q.slice(8))*1000;else if(l.indexOf('expires=')===0&&!e)e=Date.parse(q.slice(8))||0}
var o=load();if(e&&e<=Date.now())delete o[k];else o[k]={v:v,e:e};save(o)}})})();</script>`;

// 导播台把预加载 / 切走的网页课件停在画面外，这时课件要静音。初始状态看 window.name（父页面在加载前设好），
// 之后父页面用 postMessage({__cs:'mute',on}) 切换。只改 muted，不暂停，切回来时课件还在原来的进度。
const MUTE = `<script>(function(){var M=window.name==='cs-muted',C=[];
function one(m){if(M){if(!m.__csm){m.__csm=1;m.__csw=m.muted;m.muted=true}}else if(m.__csm){m.__csm=0;m.muted=m.__csw}}
function all(){try{document.querySelectorAll('audio,video').forEach(one)}catch(e){}C.forEach(function(c){try{M?c.suspend():c.resume()}catch(e){}})}
try{var P=HTMLMediaElement.prototype,play=P.play;P.play=function(){one(this);return play.apply(this,arguments)}}catch(e){}
['AudioContext','webkitAudioContext'].forEach(function(n){var A=window[n];if(!A)return;try{window[n]=class extends A{constructor(...a){super(...a);C.push(this);if(M)try{this.suspend()}catch(e){}}}}catch(e){}});
document.addEventListener('play',function(e){if(e.target&&e.target.tagName)one(e.target)},true);document.addEventListener('DOMContentLoaded',function(){if(M)all()});
window.addEventListener('message',function(e){var d=e.data;if(e.source===parent&&d&&d.__cs==='mute'){M=!!d.on;all()}});})();</script>`;

/** 把脚本插在 <head> 之后（找不到就在 <html> 或 doctype 之后），不能放在 doctype 前面，否则页面进入怪异模式 */
function injectCookieShim(buf) {
  // latin1 一字节对一字符，位置可以直接用于原始字节；UTF-8 / GBK 课件都是 ASCII 兼容的
  const head = buf.subarray(0, 8192).toString('latin1');
  if (/^\xff\xfe|^\xfe\xff/.test(head)) return buf; // UTF-16 不处理
  let at = -1;
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) { const m = re.exec(head); if (m) { at = m.index + m[0].length; break; } }
  if (at < 0) at = 0;
  return Buffer.concat([buf.subarray(0, at), Buffer.from(SHIM + MUTE, 'utf8'), buf.subarray(at)]);
}

module.exports = { injectCookieShim, MUTE };
