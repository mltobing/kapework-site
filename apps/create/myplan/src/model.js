import { illustrationIds } from './illustrations.js';
export const themes = Object.freeze({ sage:{label:'Garden green',accent:'#467264',soft:'#eaf1eb'}, peach:{label:'Warm peach',accent:'#a4583f',soft:'#fbede5'}, sky:{label:'Soft blue',accent:'#426e8a',soft:'#eaf1f7'} });
export const paperSizes = Object.freeze({letter:{label:'US Letter · 8½ × 11 in',width:612,height:792},tabloid:{label:'Large wall sheet · 11 × 17 in',width:792,height:1224}});
export const LIMITS = Object.freeze({title:80,label:60,caption:140,steps:24});
export function createStep(label='New step', illustration='star') { return {id:crypto.randomUUID(),label,caption:'',picture:{kind:'illustration',id:illustration}}; }
const routines = {
 morning:['Our school morning',[['Wake up','wake'],['Relax in the living room','relax'],['Sister goes to school','school'],['Brush teeth','teeth'],['Get dressed','clothes'],['Pack the bag','bag'],['Shoes on','shoes'],['Leave for school','leave']]],
 home:['Coming home',[['Shoes and socks off','socks'],['Wash hands','hands'],['Unpack homework and water','unpack'],['Homework','homework'],['Fun time','play'],['Dinner','dinner']]],
 bedtime:['Our bedtime',[['Bath','bath'],['Brush teeth','teeth'],['Pajamas','pajamas'],['Play time','play'],['Get into bed','bed'],['Read a story','read'],['Prayers','prayers'],['Sleep','sleep']]],
 blank:['Our plan',[]],
};
export function createRoutine(key='blank') { const [title,steps]=routines[key]||routines.blank;return {id:crypto.randomUUID(),title,steps:steps.map(([label,icon])=>createStep(label,icon)),reward:null,print:{paper:'letter',theme:'sage'}}; }
export const createSchedule=createRoutine;
export function duplicateSchedule(schedule) {const copy=validateSchedule(schedule);copy.id=crypto.randomUUID();copy.title=`${copy.title.slice(0,73)} (copy)`;copy.steps.forEach(s=>s.id=crypto.randomUUID());return copy;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded=(v,max,name)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v))throw new Error(`Invalid ${name}.`);return v;};
const validId=(v)=>{if(typeof v!=='string'||!uuid.test(v))throw new Error('Invalid schedule or picture identifier.');return v;};
function picture(v){if(!v||typeof v!=='object')throw new Error('Each step needs a picture.');if(v.kind==='illustration'&&illustrationIds.includes(v.id))return {kind:'illustration',id:v.id};if(v.kind==='photo'){const crop=v.crop||{x:.5,y:.5,zoom:1};if(![crop.x,crop.y,crop.zoom].every(Number.isFinite)||crop.x<0||crop.x>1||crop.y<0||crop.y>1||crop.zoom<1||crop.zoom>3)throw new Error('Invalid picture crop.');return {kind:'photo',assetId:validId(v.assetId),crop:{x:crop.x,y:crop.y,zoom:crop.zoom}};}throw new Error('Unknown illustration or picture type.');}
function step(v,withId=true){if(!v||typeof v!=='object')throw new Error('Invalid step.');return {...(withId?{id:validId(v.id)}:{}),label:bounded(v.label,LIMITS.label,'step label'),caption:bounded(v.caption??'',LIMITS.caption,'caption'),picture:picture(v.picture)};}
export function validateSchedule(v){if(!v||typeof v!=='object'||!Array.isArray(v.steps)||v.steps.length>LIMITS.steps)throw new Error('Invalid schedule; use at most 24 steps.');if(!v.print||!Object.hasOwn(paperSizes,v.print.paper)||!Object.hasOwn(themes,v.print.theme))throw new Error('Invalid print settings.');const steps=v.steps.map(s=>step(s));if(new Set(steps.map(s=>s.id)).size!==steps.length)throw new Error('Step identifiers must be unique.');return {id:validId(v.id),title:bounded(v.title,LIMITS.title,'title'),steps,reward:v.reward==null?null:step(v.reward,false),print:{paper:v.print.paper,theme:v.print.theme}};}
