const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const id=()=>crypto.randomUUID();
const within=(base,target)=>{const r=path.relative(base,target);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
async function atomicJSON(file,value){return atomicWrite(file,()=>JSON.stringify(value));}
async function atomicWrite(file,text){
 await fs.promises.mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+id();
 const h=await fs.promises.open(temp,'wx');try{await h.writeFile(text());await h.sync();}finally{await h.close();}
 try{
  try{await fs.promises.copyFile(file,file+'.bak');}catch(e){if(e.code!=='ENOENT')throw e;}
  // Windows 上杀毒软件/索引服务会短暂占用刚写入的文件，rename 报 EPERM/EBUSY；稍等重试即可
  for(let i=0;;i++){try{await fs.promises.rename(temp,file);break;}catch(e){if(i>=12||!['EPERM','EBUSY','EACCES'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,40+i*40));}}
 }catch(e){await fs.promises.unlink(temp).catch(()=>{});throw e;}
}
/** 清理上次异常退出留下的临时文件（只删 <name>.tmp-<uuid>，且至少 10 分钟前写入） */
function cleanTemps(file){
 const dir=path.dirname(file),base=path.basename(file)+'.tmp-';
 try{for(const n of fs.readdirSync(dir))if(n.startsWith(base)&&/^[0-9a-f-]{36}$/.test(n.slice(base.length))){const p=path.join(dir,n);if(Date.now()-fs.statSync(p).mtimeMs>600000)fs.unlinkSync(p);}}catch{}
}
async function readJSON(file,fallback){for(const name of [file,file+'.bak'])try{return JSON.parse(await fs.promises.readFile(name,'utf8'));}catch{}return fallback;}
// 课堂存档里笔迹和撤销记录占了绝大部分（写满几十页后有 20 MB），每写一笔都整份 JSON.stringify 会把主进程卡住
// 几百毫秒，而 Windows 上笔和鼠标的输入要先经过主进程的界面线程才到画布。主进程里这些对象只整个替换、不就地修改
// （applyMessage 生成新数组和新笔迹，教师窗口每次发来的也是新对象），所以按对象缓存它们的 JSON，下次存盘直接复用。
// 缓存的是 UTF-8 编码后的 Buffer：拼成一个 20 MB 的字符串再编码本身也要上百毫秒（路径里有中文时是双字节字符串），
// 而 Buffer.concat 只是一次内存复制。
const pieces=new WeakMap();
const skip=v=>v===undefined||typeof v==='function'||typeof v==='symbol';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=s=>Buffer.from(s,'utf8');
const whole=v=>text(JSON.stringify(v)??'null');
const piece=v=>{if(v===null||typeof v!=='object')return whole(v);let b=pieces.get(v);if(b===undefined){b=whole(v);pieces.set(v,b);}return b;};
const COMMA=text(','),NUL=text('null');
function list(a,out){out.push(text('['));a.forEach((x,i)=>{if(i)out.push(COMMA);out.push(skip(x)?NUL:piece(x));});out.push(text(']'));}
function record(o,out,f){out.push(text('{'));let first=true;for(const k of Object.keys(o)){const v=o[k];if(skip(v))continue;out.push(text((first?'':',')+JSON.stringify(k)+':'));first=false;f(v,k,out);}out.push(text('}'));}
const put=(v,_k,out)=>out.push(whole(v));
const lists=(v,_k,out)=>Array.isArray(v)?list(v,out):put(v,_k,out);
/** 和 Buffer.from(JSON.stringify(ws)) 逐字节相同；shared.ink 每页的每一笔、history 每条撤销记录按对象缓存 */
function workspaceJSON(ws){
 const out=[];
 record(ws,out,(v,k,o)=>{
  if(k==='shared'&&plain(v))return record(v,o,(x,kk,oo)=>kk==='ink'&&plain(x)?record(x,oo,lists):put(x,kk,oo));
  if(k==='history'&&plain(v))return record(v,o,(h,hk,oo)=>plain(h)?record(h,oo,lists):put(h,hk,oo));
  put(v,k,o);
 });
 return Buffer.concat(out);
}
module.exports={id,within,atomicJSON,atomicWrite,workspaceJSON,readJSON,cleanTemps};
