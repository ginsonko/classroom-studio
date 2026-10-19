// Loaded only by the desktop test flag; exercises the real application APIs.
import {useStore,flushStore,publicState,inkKey} from './store';
import {host} from './host';
import {fileEntry,prepareMaterial} from './library';
import {openMaterial} from '../doc/actions';
import {bus} from './bus';
import {useStudy,flushStudy} from './studyStore';
import * as studyAi from './studyAi';
import * as studyLogic from './studyLogic';
import {useRun,useSkills} from './skills';
import * as demos from '../demos';
import * as autopilot from './autopilot';
import * as catalog from './catalog';
import {useLib,refreshLibrary,importPaths,removeLoose} from './useLib';
import {useRecording} from './recording';
const aiMods=async()=>({ai:await import('./ai'),manim:await import('./manim'),formula:await import('./formulaAi'),s3d:await import('../scene3d/material')});
if(host.test)Object.assign(window,{__studioQA:{useStore,flushStore,publicState,inkKey,host,fileEntry,prepareMaterial,openMaterial,bus,useStudy,flushStudy,studyAi,studyLogic,useRun,useSkills,demos,aiMods,autopilot,catalog,useLib,refreshLibrary,importPaths,removeLoose,useRecording}});
