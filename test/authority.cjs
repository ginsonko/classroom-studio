const {test}=require('node:test');const assert=require('node:assert/strict');
const {projection,authorizeMessage,applyMessage}=require('../electron/gate.cjs');
const stroke=(id,author='teacher',layer='public')=>({id,author,layer,tool:'pen',pts:[.1,.2,.5,.3,.4,.5],size:3,color:'ink'});
const state=()=>({pgm:{materialId:'board',page:0},pgmMat:{id:'board',title:'Public'},drawAuthor:'student',studentTools:'open',ink:{'board#0':[stroke('t'),stroke('s','student'),stroke('private','teacher','private')],'secret-doc#0':[stroke('other')]},notes:{answer:'private answer'},reader:{answer:'secret'}});
test('a new public window receives only published non-private ink, no teacher local fields',()=>{const s=projection(state());assert.deepEqual(Object.keys(s.ink),['board#0']);assert.deepEqual(s.ink['board#0'].map(x=>x.id),['t','s']);assert.equal(s.notes,undefined);assert.equal(s.reader,undefined);});
test('student cannot publish another material, impersonate teacher or erase teacher work',()=>{const s=state();assert.equal(authorizeMessage('student',{t:'shared',patch:{pgmMat:{id:'answer'},drawAuthor:'teacher',notes:{x:'y'}}},s),null);const msg=authorizeMessage('student',{t:'edit',key:'board#0',remove:['t','s','private'],upsert:[stroke('new','teacher')]},s);assert.deepEqual(msg.remove,['s']);assert.equal(msg.upsert[0].author,'student');});
test('locked tools reject forged annotation and history, and private live strokes are removed',()=>{const s=state();s.studentTools='locked';assert.equal(authorizeMessage('student',{t:'history',key:'board#0',actor:'teacher'},s),null);assert.equal(authorizeMessage('student',{t:'stroke',key:'board#0',stroke:stroke('x')},s),null);assert.equal(authorizeMessage('teacher',{t:'live',key:'board#0',from:'x',stroke:stroke('x','teacher','private')},s).stroke,null);});
test('duplicate final stroke cannot duplicate persisted ink, edits retain unaffected authors',()=>{const s=state();const msg={t:'edit',key:'board#0',remove:['s'],upsert:[stroke('t')],actor:'teacher'};applyMessage(s,msg);applyMessage(s,msg);assert.deepEqual(s.ink['board#0'].map(x=>x.id),['t','private']);});
test('wrong-page writes and invalid coordinates do not enter classroom state',()=>{const s=state();assert.equal(authorizeMessage('student',{t:'stroke',key:'secret-doc#0',stroke:stroke('x')},s),null);assert.equal(authorizeMessage('student',{t:'stroke',key:'board#0',stroke:{...stroke('x'),pts:[NaN]}},s),null);});

test('student may take the pen only for itself and only while student tools are open',()=>{const s={...state(),drawAuthor:'teacher',studentTools:'open'};assert.deepEqual(authorizeMessage('student',{t:'shared',patch:{drawAuthor:'student'}},s)?.patch,{drawAuthor:'student'});assert.equal(authorizeMessage('student',{t:'shared',patch:{drawAuthor:'teacher'}},{...s,drawAuthor:'student'}),null);assert.equal(authorizeMessage('student',{t:'shared',patch:{drawAuthor:'student'}},{...s,studentTools:'locked'}),null);});
test('0.9.1 desk: ink of every open window is projected; students switch only among open windows and cannot inject content',()=>{
 const s={...state(),desk:[{id:'board',mat:{id:'board',title:'Public'},view:{materialId:'board',page:0},rect:[0,0,1,1],mode:'max',z:0,at:0},{id:'doc',mat:{id:'doc',title:'Doc',pages:[{}]},view:{materialId:'doc',page:3},rect:[.2,.1,.5,.5],mode:'normal',z:2,at:5}],ink:{'board#0':[stroke('t')],'doc#3':[stroke('d')],'secret-doc#0':[stroke('x')]}};
 assert.deepEqual(Object.keys(projection(s).ink).sort(),['board#0','doc#3']);
 const ok=authorizeMessage('student',{t:'shared',patch:{pgmMat:{id:'doc',title:'Forged',pages:[]},pgm:{materialId:'doc',page:3},desk:s.desk.map(w=>({...w,mat:{id:w.id,title:'Forged'},rect:[9,9,9,9]}))}},s);
 assert.equal(ok.patch.pgmMat.title,'Doc');assert.equal(ok.patch.desk[1].mat.title,'Doc');assert.deepEqual(ok.patch.desk[1].rect,[.95,.95,1,1]);
 assert.equal(authorizeMessage('student',{t:'shared',patch:{pgmMat:{id:'answer'},pgm:{materialId:'answer',page:0}}},s),null);
 const injected=authorizeMessage('student',{t:'shared',patch:{desk:[...s.desk,{id:'answer',mat:{id:'answer'},view:{materialId:'answer',page:0}}]}},s);
 assert.deepEqual(injected.patch.desk.map(w=>w.id),['board','doc']);
 assert.equal(authorizeMessage('student',{t:'shared',patch:{pgm:{materialId:'board',page:1}}},{...s,studentTools:'locked'}),null);
 assert.equal(authorizeMessage('student',{t:'shared',patch:{pgm:{materialId:'board',page:1}}},s).patch.pgm.page,1);
});
test('1.2.2 PPT step toggle syncs from teacher, dock and open student tools; value is always boolean; projected to new windows',()=>{
 const s={...state(),drawAuthor:'teacher',studentTools:'open'};
 assert.deepEqual(authorizeMessage('teacher',{t:'shared',patch:{slideSteps:false}},s).patch,{slideSteps:false});
 assert.deepEqual(authorizeMessage('dock',{t:'shared',patch:{slideSteps:'x'}},s).patch,{slideSteps:true});
 assert.deepEqual(authorizeMessage('student',{t:'shared',patch:{slideSteps:false,pgm:{materialId:'board',page:0,build:[0,0]}}},s).patch,{slideSteps:false,pgm:{materialId:'board',page:0,build:[0,0]}});
 assert.equal(authorizeMessage('student',{t:'shared',patch:{slideSteps:false}},{...s,studentTools:'locked',drawAuthor:'student'}),null);
 assert.equal(projection({...s,slideSteps:false}).slideSteps,false);
});
