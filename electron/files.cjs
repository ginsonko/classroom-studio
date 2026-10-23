const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {within,atomicJSON,readJSON}=require('./core.cjs');
const {runProcess}=require('./recording.cjs');
const pptSteps=require('./pptSteps.cjs');
const STEPS_V=1;
const EXT={'.pdf':'pdf','.zml':'pdf','.ppt':'slides','.pptx':'slides','.doc':'word','.docx':'word','.rtf':'word','.md':'word','.markdown':'word','.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.bmp':'image','.gif':'image','.svg':'image','.html':'html','.htm':'html','.mp4':'video','.webm':'video','.m4v':'video','.mov':'video','.wmv':'video','.avi':'video','.asf':'video','.mpg':'video','.flv':'video','.rm':'video','.rmvb':'video','.mp3':'audio','.wav':'audio','.ogg':'audio','.m4a':'audio','.swf':'flash','.zip':'archive','.rar':'archive'};
const normal=p=>path.resolve(p).replaceAll('\\','/');
class Files{
 constructor(cache){this.cache=cache;this.roots=new Set();this.tokens=new Map();this.urls=new Map();this.scans=new Map();this.queue=Promise.resolve();}
 authorize(p,dir=false){const actual=fs.realpathSync(p);this.roots.add(dir?actual:path.dirname(actual));return normal(actual);}
 allowed(p){const actual=fs.realpathSync(p);if(![...this.roots].some(root=>within(root,actual))&&!within(this.cache,actual))throw Error('请先在资料库选择这个文件或所在目录');return actual;}
 url(p){
  if(/^https?:\/\//i.test(p))return new URL(p).href;
  if(/^lesson:/i.test(p))return p;
  const actual=this.allowed(p);if(this.urls.has(actual))return this.urls.get(actual);
  const root=path.dirname(actual),token=crypto.randomBytes(18).toString('hex');this.tokens.set(token,root);
  const url='lesson://'+token+'/'+encodeURIComponent(path.basename(actual));this.urls.set(actual,url);return url;
 }
 resolve(url){const u=new URL(url),root=this.tokens.get(u.hostname);if(!root)throw Error('资源入口已失效');const rel=decodeURIComponent(u.pathname).replace(/^\//,'');if(rel.includes('\0')||rel.includes('\\')||rel.includes(':'))throw Error('资源路径不正确');const file=path.resolve(root,rel);if(!within(root,file))throw Error('超出课件目录');const real=fs.realpathSync(file);if(!within(root,real))throw Error('文件链接超出课件目录');return real;}
 async listDir(folder){const actual=this.allowed(folder),out=[];for(const e of await fs.promises.readdir(actual,{withFileTypes:true})){if(e.isSymbolicLink())continue;try{const file=path.join(actual,e.name),s=await fs.promises.stat(file);out.push({name:e.name,path:normal(file),dir:e.isDirectory(),size:s.size,mtime:s.mtimeMs});}catch{}}return out;}
 /** 一批文件的修改时间（资料整理按文件时间归档用）；没授权或不存在的跳过 */
 async stat(list){const out=[];for(const p of (Array.isArray(list)?list:[]).slice(0,2000)){try{const actual=this.allowed(String(p)),s=await fs.promises.stat(actual);if(s.isFile())out.push({path:String(p),mtime:s.mtimeMs,size:s.size});}catch{}}return out;}
 /** 读小的纯文本文件（家长聊天记录、要求清单）：只限 txt / md / csv，200KB 以内 */
 async readText(p){const actual=this.allowed(String(p||''));if(!/\.(txt|md|csv)$/i.test(actual))throw Error('只能读取 txt / md / csv 文本文件');const s=await fs.promises.stat(actual);if(s.size>200*1024)throw Error('文本文件超过 200KB，请只保留需要的部分');const buf=await fs.promises.readFile(actual);const utf8=buf.toString('utf8');if(utf8.includes('\uFFFD')){try{return new TextDecoder('gbk').decode(buf);}catch{}}return utf8.replace(/^\uFEFF/,'');}
 async scan(root,{force=false}={}){
  const actual=this.authorize(root,true);if(!force&&this.scans.has(actual))return this.scans.get(actual);
  let visited=0;const read=async folder=>{const result={n:path.basename(folder),d:[],f:[]};const entries=await fs.promises.readdir(folder,{withFileTypes:true});for(const e of entries){if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules','$RECYCLE.BIN','System Volume Information'].includes(e.name))continue;const file=path.join(folder,e.name);try{if(e.isDirectory()){const child=await read(file);if(child.d.length||child.f.length)result.d.push(child);}else if(e.isFile()){const kind=EXT[path.extname(e.name).toLowerCase()];if(kind){const st=await fs.promises.stat(file);result.f.push([e.name,kind,st.size]);}}}catch{}if(++visited%250===0)await new Promise(r=>setImmediate(r));}return result;};
  const promise=read(actual);this.scans.set(actual,promise);try{return await promise;}catch(e){this.scans.delete(actual);throw e;}
 }
  /**
   * PPT 每页文字及位置（用来识别答案页）。先取文本框文字；整页是图片的幻灯片再用 Windows 自带 OCR 读已导出的图片。
   * 旧缓存没有 texts.json 时只读打开一次补齐，不重新导出图片。结果缓存在同一个转换目录里。
   */
  async slideTexts(input){
  const actual=this.allowed(input),stat=await fs.promises.stat(actual),ext=path.extname(actual).toLowerCase();
  if(!['.ppt','.pptx'].includes(ext))return null;
  const key=crypto.createHash('sha256').update(actual.toLowerCase()+'|'+stat.size+'|'+stat.mtimeMs+'|slides-v3').digest('hex');const dir=path.join(this.cache,'documents',key,'slides'),file=path.join(dir,'texts.json'),ocrFile=path.join(dir,'ocr.json');
  const lines=x=>(Array.isArray(x)?x:x&&typeof x==='object'?[x]:[]).filter(l=>l&&typeof l.t==='string').slice(0,120).map(l=>({t:l.t.slice(0,300),y:Number.isFinite(Number(l.y))?Number(l.y):undefined}));
  const readTexts=async()=>{const v=await readJSON(file,null);return Array.isArray(v)?v.map(x=>({lines:lines(x)})):null;};
  const readOcr=async()=>{const v=await readJSON(ocrFile,null);if(!v||typeof v!=='object')return null;return new Map((Array.isArray(v)?v:[v]).map(x=>[Number(x?.p),lines(x?.lines)]));};
  const merge=(pages,ocr)=>pages.map((p,i)=>p.lines.length?p:{lines:ocr?.get(i+1)??[]});
  const ps=(script,args,timeout)=>runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,script),...args],{timeout});
  // 其他系统没有 PowerPoint 自动化和系统 OCR：只用内置排版转换时顺手写下的 texts.json
  if(process.platform!=='win32')return readTexts();
  // 1.0.2 之前 ppt-export.ps1 误用整数版 Math.Min，y 只会是 0 或 1；这类旧缓存只重读文字，不重新导出图片
  const fixed=path.join(dir,'texts-y.ok');
  const stale=p=>!!p&&!fs.existsSync(fixed)&&p.some(x=>x.lines.length>1)&&p.every(x=>x.lines.every(l=>l.y===undefined||l.y===0||l.y===1));
  const pages=await readTexts(),ocr=await readOcr();if(pages&&!stale(pages)&&(ocr||pages.every(p=>p.lines.length)))return merge(pages,ocr);
  const job=this.queue.catch(()=>{}).then(async()=>{
   let pages=await readTexts();
   if(stale(pages)){try{await ps('ppt-export.ps1',['-InputFile',actual,'-OutputDir',dir,'-TextOnly'],120000);pages=await readTexts();}catch{}await fs.promises.writeFile(fixed,'').catch(()=>{});}
   if(!pages){await fs.promises.mkdir(dir,{recursive:true});await ps('ppt-export.ps1',['-InputFile',actual,'-OutputDir',dir,'-TextOnly'],120000);pages=await readTexts();if(!pages)return null;}
   let ocr=await readOcr();
   const need=pages.map((_,i)=>i+1).filter(n=>!pages[n-1].lines.length&&fs.existsSync(path.join(dir,`slide-${String(n).padStart(4,'0')}.png`)));
   if(!ocr&&need.length){try{await ps('ocr-slides.ps1',['-Dir',dir,'-Pages',need.join(','),'-OutputFile',ocrFile],240000);}catch{}ocr=await readOcr();}
   return merge(pages,ocr);
  });
  this.queue=job;return job;
 }
  /**
   * PPT 分步：读 PPTX 里的单击动画，生成分步副本，用转换这份课件的同一种方式出图（失败时用内置排版）。
   * 返回 { pages: [{ page, clicks, frames: [{ click, wait, path?, w?, h?, pdf?, index? }] }] }，没有图的帧就是整页原图。
   * 课件要先 convert 过；结果缓存在同一个转换目录的 steps/ 里。
   */
  async slideSteps(input){
  const actual=this.allowed(input),stat=await fs.promises.stat(actual),ext=path.extname(actual).toLowerCase();
  if(ext!=='.pptx')return {pages:[]};
  const key=crypto.createHash('sha256').update(actual.toLowerCase()+'|'+stat.size+'|'+stat.mtimeMs+'|slides-v3').digest('hex');const folder=path.join(this.cache,'documents',key),dir=path.join(folder,'steps'),file=path.join(dir,'steps.json');
  const out=r=>({pages:(r.pages||[]).map(p=>({...p,frames:p.frames.map(f=>({...f,...(f.path?{path:normal(f.path)}:{}),...(f.pdf?{pdf:normal(f.pdf)}:{})}))}))});
  const valid=r=>r&&r.v===STEPS_V&&Array.isArray(r.pages)&&r.pages.every(p=>p.frames.every(f=>!f.path||fs.existsSync(f.path))&&p.frames.every(f=>!f.pdf||fs.existsSync(f.pdf)));
  const ready=await readJSON(file,null);if(valid(ready))return out(ready);
  const manifest=await readJSON(path.join(folder,'manifest.json'),null);if(!manifest)throw Error('请先打开这份课件');
  const job=this.queue.catch(()=>{}).then(async()=>{
   const again=await readJSON(file,null);if(valid(again))return again;
   await fs.promises.rm(dir,{recursive:true,force:true});await fs.promises.mkdir(dir,{recursive:true});
   const save=async r=>{await atomicJSON(file,{v:STEPS_V,...r});return {v:STEPS_V,...r};};
   let a;try{a=pptSteps.analyze(await fs.promises.readFile(actual));}catch(e){return save({pages:[],error:String(e?.message||e).slice(0,200)});}
   if(!a.slides.length)return save({pages:[]});
   const {deck,frames,index}=a.build();
   const pages=shots=>index.map(s=>({page:s.page,clicks:s.clicks,frames:s.frames.map(f=>({click:f.click,wait:f.wait,...(f.at>=0?shots[f.at]:{})}))}));
   if(!frames)return save({pages:pages([])});
   const deckFile=path.join(dir,'steps.pptx');await fs.promises.writeFile(deckFile,deck);
   try{
    let shots=null,engine=manifest.engine;
    if(engine==='local-office-slides'&&process.platform==='win32'){
     try{
      const img=path.join(dir,'img');await fs.promises.mkdir(img,{recursive:true});
      await runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'ppt-export.ps1'),'-InputFile',deckFile,'-OutputDir',img],{timeout:Math.max(240000,frames*1500)});
      const m=await readJSON(path.join(img,'manifest.json'),null);
      const list=Array.from({length:frames},(_,i)=>({path:path.join(img,`slide-${String(i+1).padStart(4,'0')}.png`),w:Number(m?.width)||1600,h:Number(m?.height)||900}));
      if(list.every(x=>fs.existsSync(x.path)))shots=list;
     }catch{}
     engine='内置排版';
    }
    if(!shots){
     if(!this.office)throw Error('当前系统不能生成分步画面');
     const r=await this.office.convertWith(engine,{input:deckFile,ext:'.pptx',folder:path.join(dir,'conv')});
     if(r.render==='images'&&r.images?.length===frames)shots=r.images;
     else if(r.render==='pdf'&&r.pdf)shots=Array.from({length:frames},(_,i)=>({pdf:r.pdf,index:i}));
     else throw Error('分步画面数量不对');
    }
    return save({engine:manifest.engine,pages:pages(shots)});
   }catch(e){return save({pages:[],error:String(e?.message||e).slice(0,200)});}
   finally{await fs.promises.rm(deckFile,{force:true}).catch(()=>{});}
  });
  this.queue=job;return out(await job);
 }
  /** 题库导入：几张 PNG（data URL）用 Windows 自带 OCR 读出每行文字和上沿位置；其他系统返回 null，交给 AI 看图 */
  async ocrImages(list){
  if(process.platform!=='win32')return null;
  const imgs=(Array.isArray(list)?list:[]).slice(0,60).map(s=>/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(s||''))?.[1]).filter(Boolean);
  if(!imgs.length)return [];
  const dir=path.join(this.cache,'ocr-'+crypto.randomBytes(6).toString('hex'));await fs.promises.mkdir(dir,{recursive:true});
  try{
   for(const [i,b] of imgs.entries())await fs.promises.writeFile(path.join(dir,`slide-${String(i+1).padStart(4,'0')}.png`),Buffer.from(b,'base64'));
   const out=path.join(dir,'ocr.json');
   const job=this.queue.catch(()=>{}).then(()=>runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'ocr-slides.ps1'),'-Dir',dir,'-Pages',imgs.map((_,i)=>i+1).join(','),'-OutputFile',out],{timeout:60000+imgs.length*20000}));
   this.queue=job.catch(()=>{});await job;
   const v=await readJSON(out,[]);const by=new Map((Array.isArray(v)?v:[v]).map(x=>[Number(x?.p),(Array.isArray(x?.lines)?x.lines:x?.lines?[x.lines]:[]).filter(l=>typeof l?.t==='string').map(l=>({t:l.t.slice(0,500),y:Number(l.y),b:Number(l.b),ws:(Array.isArray(l.ws)?l.ws:[]).filter(w=>Array.isArray(w)&&typeof w[0]==='string'&&Number.isFinite(Number(w[1]))).slice(0,4).map(w=>[w[0].slice(0,20),Number(w[1])])}))]));
   return imgs.map((_,i)=>({lines:by.get(i+1)??[]}));
  }finally{await fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{});}
 }
  async convert(input,progress){
  const actual=this.allowed(input),stat=await fs.promises.stat(actual),ext=path.extname(actual).toLowerCase();
  if(['.pdf','.zml'].includes(ext)){const h=await fs.promises.open(actual,'r');try{const buf=Buffer.alloc(1024);const {bytesRead}=await h.read(buf,0,buf.length,0);if(!buf.subarray(0,bytesRead).includes(Buffer.from('%PDF-')))throw Error('这份文件不是有效 PDF');}finally{await h.close();}return {render:'pdf',pdf:normal(actual),cached:true,engine:'passthrough'};}
  const md=['.md','.markdown'].includes(ext);
  if(!md&&!['.ppt','.pptx','.doc','.docx','.rtf'].includes(ext))throw Error('此格式暂不能转换为文档');
  const mode=['.ppt','.pptx'].includes(ext)?'slides':md?'md-v1':'pdf';
  const extra=md?'|'+await require('./mdInline.cjs').stamp(actual).catch(()=>''):'';
  const key=crypto.createHash('sha256').update(actual.toLowerCase()+'|'+stat.size+'|'+stat.mtimeMs+'|'+mode+'-v3'+extra).digest('hex');const folder=path.join(this.cache,'documents',key),pdf=path.join(folder,'document.pdf');
  const out=r=>({...r,pdf:r.pdf?normal(r.pdf):undefined,images:r.images?.map(x=>({...x,path:normal(x.path)}))});
  const existing=await readJSON(path.join(folder,'manifest.json'),null);if(existing&&(existing.render==='images'?existing.images?.length&&existing.images.every(x=>fs.existsSync(x.path)):existing.pdf&&fs.existsSync(existing.pdf)))return {...out(existing),cached:true};
  progress({stage:'queued',message:'等待本机文档转换'});
  // Windows 用 Office / WPS 自动化；其他系统（或 Windows 上没装 Office / WPS）交给 office.cjs 的多级转换
  const fallback=async()=>{const r={...await this.office.convert({input:actual,ext,folder,progress}),cached:false};await atomicJSON(path.join(folder,'manifest.json'),r);progress({stage:'done',done:r.images?.length??1,total:r.images?.length??1});return out(r);};
  // Markdown 不经过 Office / WPS：直接内置排版
  if(process.platform!=='win32'||md){
   if(!this.office)throw Error('当前系统还不能转换 PPT / Word，请先另存为 PDF 后再打开。');
   const job=this.queue.catch(()=>{}).then(async()=>{await fs.promises.mkdir(folder,{recursive:true});return fallback();});this.queue=job;return job;
  }
  const job=this.queue.catch(()=>{}).then(async()=>{await fs.promises.mkdir(folder,{recursive:true});progress({stage:'opening',message:'只读打开文档'});
   try{return await this.windowsOffice(actual,mode,folder,pdf,progress);}
   catch(e){if(!this.office)throw e;try{return await fallback();}catch{throw e;}}
  });this.queue=job;return job;
 }
 async windowsOffice(actual,mode,folder,pdf,progress){
   if(mode==='slides'){
    const imageDir=path.join(folder,'slides');await fs.promises.mkdir(imageDir,{recursive:true});
    await runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'ppt-export.ps1'),'-InputFile',actual,'-OutputDir',imageDir],{timeout:240000});
    const manifest=await readJSON(path.join(imageDir,'manifest.json'),null);const expected=Number(manifest?.count||0),images=[];
    if(!Number.isInteger(expected)||expected<1)throw Error('PowerPoint 没有可导出的幻灯片。请检查文件是否为空，或在 PowerPoint/WPS 中另存为 PDF 后打开。');
    for(let i=1;i<=expected;i++){const file=path.join(imageDir,`slide-${String(i).padStart(4,'0')}.png`);if(fs.existsSync(file)&&(await fs.promises.stat(file)).size>=100)images.push({path:normal(file),w:Number(manifest.width)||1600,h:Number(manifest.height)||900});}
    if(images.length!==expected)throw Error(`PowerPoint 仅导出了 ${images.length}/${expected} 张有效幻灯片。请检查 Office/WPS 转换状态，或另存为 PDF 后打开。`);
    const result={render:'images',images,cached:false,engine:'local-office-slides'};await atomicJSON(path.join(folder,'manifest.json'),result);progress({stage:'done',done:images.length,total:images.length});return result;
   }
   await runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'office-export.ps1'),'-InputFile',actual,'-OutputFile',pdf],{timeout:240000});const s=await fs.promises.stat(pdf);if(s.size<1000)throw Error('文档转换没有生成有效 PDF 页面。');const result={render:'pdf',pdf:normal(pdf),cached:false,engine:'local-office'};await atomicJSON(path.join(folder,'manifest.json'),result);progress({stage:'done',done:1,total:1});return result;
 }
}
module.exports={Files,EXT,normal,pathToFileURL};
