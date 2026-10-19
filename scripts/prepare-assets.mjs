import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
for(const name of ['cmaps','standard_fonts','wasm'])await fs.cp(path.join(root,'node_modules/pdfjs-dist',name),path.join(root,'public/pdfjs',name),{recursive:true});
console.log('PDF offline fonts and decoders ready.');
