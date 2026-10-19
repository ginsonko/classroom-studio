import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const destination=path.resolve(root,`../release/最强网课教辅系统-${version}`);
// A release directory is a reproducible build artifact. Remove the previous
// candidate before copying so obsolete hashed assets cannot survive a rebuild.
await fs.rm(destination,{recursive:true,force:true});
await fs.mkdir(destination,{recursive:true});
await fs.cp(path.join(root,'node_modules/electron/dist'),destination,{recursive:true});
await fs.rename(path.join(destination,'electron.exe'),path.join(destination,'ClassroomStudio.exe')).catch(async e=>{if(e.code==='EEXIST'){await fs.copyFile(path.join(destination,'electron.exe'),path.join(destination,'ClassroomStudio.exe'));}else throw e;});
const appDir=path.join(destination,'resources/app');await fs.mkdir(appDir,{recursive:true});
for(const name of ['dist','electron','bin'])await fs.cp(path.join(root,name),path.join(appDir,name),{recursive:true});
await fs.writeFile(path.join(appDir,'package.json'),JSON.stringify({name:'classroom-studio',version,main:'electron/main.cjs',private:true},null,2));
console.log(destination);
