const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const id=()=>crypto.randomUUID();
const within=(base,target)=>{const r=path.relative(base,target);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
async function atomicJSON(file,value){
 await fs.promises.mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+id();
 const h=await fs.promises.open(temp,'wx');try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}
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
module.exports={id,within,atomicJSON,readJSON,cleanTemps};
