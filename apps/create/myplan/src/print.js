import { themes, paperSizes, validateSchedule } from './model.js';
import { illustrationSVG, illustrationURL } from './illustrations.js';
import { cropPhoto, rasterizeSVG } from './images.js';

let assetsPromise, measuringDoc;
function base64(buffer) { let out=''; const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out); }
async function printAssets(){
 if(!assetsPromise)assetsPromise=(async()=>{
   await import('../vendor/jspdf.umd.min.js');
   const response=await fetch(new URL('../vendor/NotoSans-Regular.ttf',import.meta.url));
   if(!response.ok)throw new Error('The print font could not load. Reconnect and try again.');
   const bytes=await response.arrayBuffer(), encoded=base64(bytes);
   const font=new FontFace('MyPlanNoto',bytes);await font.load();document.fonts.add(font);
   const jsPDF=globalThis.jspdf?.jsPDF;if(!jsPDF)throw new Error('The PDF tool could not load. Refresh and try again.');
   const makeDoc=(paper)=>{const p=paperSizes[paper];const doc=new jsPDF({orientation:'portrait',unit:'pt',format:[p.width,p.height],compress:true,putOnlyUsedFonts:true});doc.addFileToVFS('NotoSans-Regular.ttf',encoded);doc.addFont('NotoSans-Regular.ttf','MyPlanNoto','normal');doc.setFont('MyPlanNoto','normal');return doc;};
   measuringDoc=makeDoc('letter');return {makeDoc,encoded};
 })().catch(error=>{assetsPromise=null;throw error;});
 return assetsPromise;
}
function width(text,size){if(measuringDoc){measuringDoc.setFontSize(size);return measuringDoc.getTextWidth(text);}return [...text].reduce((sum,c)=>sum+(/[ilI.,'! ]/.test(c)?.3:/[MW@]/.test(c)?.9:.59)*size,0);}
export function wrapText(text,maxWidth,size){
 if(!text)return [];
 const lines=[];for(const paragraph of text.split(/\r?\n/)){let line='';for(const word of paragraph.trim().split(/\s+/)){const trial=line?`${line} ${word}`:word;if(width(trial,size)<=maxWidth){line=trial;continue;}if(line){lines.push(line);line='';}if(width(word,size)>maxWidth){let chunk='';for(const char of word){if(chunk&&width(chunk+char,size)>maxWidth){lines.push(chunk);chunk='';}chunk+=char;}line=chunk;}else line=word;}lines.push(line);}return lines;
}
/** All coordinates are PDF points. Preview and PDF consume this exact layout. */
export function inspectLayout(input){
 const schedule=validateSchedule(input),paper=paperSizes[schedule.print.paper],large=schedule.print.paper==='tabloid';
 const margin=large?38:28,gap=large?18:12,titleSize=large?34:27,labelSize=large?22:17,captionSize=large?14:11.5;
 const titleLines=wrapText(schedule.title||'Our plan',paper.width-margin*2,titleSize),titleHeight=titleLines.length*titleSize*1.2;
 const top=margin+titleHeight+22, bottom=paper.height-margin;
 const maxSteps=large?15:8, columns=schedule.steps.length>8?3:2,rows=Math.max(1,Math.ceil(schedule.steps.length/columns));
 const rewardHeight=schedule.reward?(large?118:92):0,available=bottom-top-(rewardHeight?rewardHeight+gap:0);
 const cardW=(paper.width-margin*2-gap*(columns-1))/columns,cardH=(available-gap*(rows-1))/rows;
 const issues=[];if(!schedule.steps.length)issues.push('Add at least one step before printing.');
 if(schedule.steps.length>maxSteps)issues.push(large?'This page has room for up to 15 steps. Split this routine into two saved schedules.':'Switch to the 11 × 17 inch wall sheet, or use at most eight steps.');
 if(titleLines.length>2)issues.push('Shorten the title to keep the page easy to read.');
 const cards=schedule.steps.map((step,i)=>{
  const pad=large?13:10,numberSize=large?22:18,textW=cardW-pad*2;
  const labelLines=wrapText(step.label,textW,labelSize),captionLines=wrapText(step.caption,textW,captionSize);
  const textH=labelLines.length*labelSize*1.2+(captionLines.length?6+captionLines.length*captionSize*1.3:0);
  const imageH=cardH-pad*2-textH-10, x=margin+(i%columns)*(cardW+gap),y=top+Math.floor(i/columns)*(cardH+gap);
  if(!step.label.trim())issues.push(`Give step ${i+1} a short label.`);
  if(labelLines.length>2||captionLines.length>3||imageH<(large?102:72))issues.push(`Step ${i+1} needs more room. Shorten its label or caption${large?', or split the routine.':', or choose 11 × 17 inches.'}`);
  return {step,number:i+1,x,y,width:cardW,height:cardH,pad,numberSize,labelLines,captionLines,image:{x:x+pad,y:y+pad,width:cardW-pad*2,height:Math.max(1,imageH)},labelY:y+pad+Math.max(1,imageH)+10+labelSize,captionY:y+pad+Math.max(1,imageH)+10+labelLines.length*labelSize*1.2+6+captionSize};
 });
 let reward=null;if(schedule.reward){const r=schedule.reward,x=margin,y=bottom-rewardHeight,pad=large?14:10,pictureSize=rewardHeight-pad*2,textX=x+pictureSize+pad*2,textW=paper.width-margin*2-pictureSize-pad*3;const labelLines=wrapText(r.label||'A special reward',textW,labelSize),captionLines=wrapText(r.caption,textW,captionSize);if(labelLines.length>2||captionLines.length>2||pad+captionSize+8+labelLines.length*labelSize*1.2+(captionLines.length?6+captionLines.length*captionSize*1.3:0)>rewardHeight-pad)issues.push('Shorten the reward text, or choose the larger paper size.');reward={step:r,x,y,width:paper.width-margin*2,height:rewardHeight,pad,image:{x:x+pad,y:y+pad,width:pictureSize,height:pictureSize},textX,labelLines,captionLines,labelY:y+pad+captionSize+8+labelSize,captionY:y+pad+captionSize+8+labelLines.length*labelSize*1.2+6+captionSize};}
 return {ok:issues.length===0,issues:[...new Set(issues)],schedule,paper,theme:themes[schedule.print.theme],margin,titleSize,titleLines,labelSize,captionSize,cards,reward};
}
function escape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function textSVG(lines,x,y,size,color,anchor='start',lineHeight=1.2){return lines.map((t,i)=>`<text x="${x}" y="${y+i*size*lineHeight}" font-family="MyPlanNoto, sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}">${escape(t)}</text>`).join('');}
// Blob identity is immutable and scoped by the caller's account cache. Weak keys
// release all results when that cache is cleared; each photo retains at most 3 crops.
const previewPhotos = new WeakMap();
async function pictureURL(picture, resolvePhoto, image) {
  if (picture.kind === 'illustration') return illustrationURL(picture.id);
  const asset = await resolvePhoto(picture.assetId);
  if (!asset?.blob) throw new Error('A picture is missing. Reconnect to sync it, or replace this picture.');
  const width = Math.ceil(image.width * 3), height = Math.ceil(image.height * 3);
  const crop = picture.crop || { x: .5, y: .5, zoom: 1 };
  const key = [width, height, crop.x, crop.y, crop.zoom].join(':');
  let variants = previewPhotos.get(asset.blob);
  if (!variants) { variants = new Map(); previewPhotos.set(asset.blob, variants); }
  if (variants.has(key)) {
    const cached = variants.get(key);
    variants.delete(key); variants.set(key, cached);
    return cached;
  }
  const pending = cropPhoto(asset, crop, width, height)
    .then(canvas => canvas.toDataURL('image/jpeg', .9));
  variants.set(key, pending);
  while (variants.size > 3) variants.delete(variants.keys().next().value);
  try { return await pending; }
  catch (error) {
    if (variants.get(key) === pending) variants.delete(key);
    throw error;
  }
}
function imageSVG(url,r){return `<image href="${escape(url)}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" preserveAspectRatio="xMidYMid meet"/>`;}
export async function renderPreview(schedule,resolvePhoto){
 const {encoded}=await printAssets();const layout=inspectLayout(schedule),{paper,margin,theme,titleSize,titleLines,labelSize,captionSize}=layout;
 let body=`<rect width="${paper.width}" height="${paper.height}" fill="white"/>${textSVG(titleLines,margin,margin+titleSize,titleSize,'#263e3a')}`;
 if(!layout.ok){body+=textSVG(['Let’s make a little more room.'],margin,margin+titleSize*titleLines.length*1.2+65,20,theme.accent);const msg=wrapText(layout.issues[0],paper.width-margin*2,15);body+=textSVG(msg,margin,margin+titleSize*titleLines.length*1.2+96,15,'#475956');}
 else for(const card of layout.cards){body+=`<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="10" fill="white" stroke="#dce5df"/>`;body+=imageSVG(await pictureURL(card.step.picture,resolvePhoto,card.image),card.image);body+=`<circle cx="${card.x+card.pad+card.numberSize/2}" cy="${card.y+card.pad+card.numberSize/2}" r="${card.numberSize/2+3}" fill="${theme.accent}"/>`;body+=textSVG([card.number],card.x+card.pad+card.numberSize/2,card.y+card.pad+card.numberSize*.8,card.numberSize*.68,'white','middle');body+=textSVG(card.labelLines,card.x+card.pad,card.labelY,labelSize,'#263e3a');body+=textSVG(card.captionLines,card.x+card.pad,card.captionY,captionSize,'#52645f','start',1.3);}
 if(layout.ok&&layout.reward){const r=layout.reward;body+=`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="10" fill="${theme.soft}"/>`;body+=imageSVG(await pictureURL(r.step.picture,resolvePhoto,r.image),r.image);body+=textSVG(['A SPECIAL REWARD'],r.textX,r.y+r.pad+captionSize,captionSize,theme.accent);body+=textSVG(r.labelLines,r.textX,r.labelY,labelSize,'#263e3a');body+=textSVG(r.captionLines,r.textX,r.captionY,captionSize,'#52645f','start',1.3);}
 const host=document.createElement('div');host.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paper.width} ${paper.height}" width="${paper.width}" height="${paper.height}" role="img" aria-label="${escape(schedule.title||'Our plan')} printable schedule"><defs><style>@font-face{font-family:MyPlanNoto;src:url(data:font/ttf;base64,${encoded}) format('truetype')}</style></defs>${body}</svg>`;const svg=host.firstElementChild;svg.dataset.layoutValid=String(layout.ok);return svg;
}
function pdfText(doc,lines,x,y,size,color,lineHeight=1.2,align='left'){doc.setFontSize(size);doc.setTextColor(color);for(let i=0;i<lines.length;i++)doc.text(String(lines[i]),x,y+i*size*lineHeight,{align});}
async function pdfPicture(doc,picture,r,resolvePhoto){const canvas=picture.kind==='illustration'?await rasterizeSVG(illustrationSVG(picture.id),1000,900):await cropPhoto(await resolvePhoto(picture.assetId),picture.crop,Math.ceil(r.width*4),Math.ceil(r.height*4));let target={...r};if(picture.kind==='illustration'){const ratio=1000/900;if(r.width/r.height>ratio){target.width=r.height*ratio;target.x+= (r.width-target.width)/2;}else{target.height=r.width/ratio;target.y+=(r.height-target.height)/2;}}doc.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',target.x,target.y,target.width,target.height);}
export async function createPdf(schedule,resolvePhoto){
 const {makeDoc}=await printAssets(),l=inspectLayout(schedule);if(!l.ok)throw new Error(l.issues.join(' '));const doc=makeDoc(schedule.print.paper);
 // Never silently substitute missing glyphs in a child's name or routine text.
 const cmap=doc.getFont().metadata?.cmap?.unicode?.codeMap;const allText=[schedule.title,...schedule.steps.flatMap(s=>[s.label,s.caption]),...(schedule.reward?[schedule.reward.label,schedule.reward.caption]:[])].join('');
 if (cmap && [...allText].some(c => c.charCodeAt(0) > 31 && !cmap[c.codePointAt(0)])) {
   const message = 'A character in this routine is not supported by the print font. Remove emoji or use a supported spelling before downloading. Your editable schedule is still saved.';
   const error = new Error(message);
   error.userMessage = message;
   throw error;
 }
 pdfText(doc,l.titleLines,l.margin,l.margin+l.titleSize,l.titleSize,'#263e3a');
 for(const c of l.cards){doc.setDrawColor('#dce5df');doc.setFillColor('#ffffff');doc.roundedRect(c.x,c.y,c.width,c.height,10,10,'FD');await pdfPicture(doc,c.step.picture,c.image,resolvePhoto);doc.setFillColor(l.theme.accent);doc.circle(c.x+c.pad+c.numberSize/2,c.y+c.pad+c.numberSize/2,c.numberSize/2+3,'F');pdfText(doc,[c.number],c.x+c.pad+c.numberSize/2,c.y+c.pad+c.numberSize*.8,c.numberSize*.68,'#ffffff',1.2,'center');pdfText(doc,c.labelLines,c.x+c.pad,c.labelY,l.labelSize,'#263e3a');pdfText(doc,c.captionLines,c.x+c.pad,c.captionY,l.captionSize,'#52645f',1.3);}
 if(l.reward){const r=l.reward;doc.setFillColor(l.theme.soft);doc.roundedRect(r.x,r.y,r.width,r.height,10,10,'F');await pdfPicture(doc,r.step.picture,r.image,resolvePhoto);pdfText(doc,['A SPECIAL REWARD'],r.textX,r.y+r.pad+l.captionSize,l.captionSize,l.theme.accent);pdfText(doc,r.labelLines,r.textX,r.labelY,l.labelSize,'#263e3a');pdfText(doc,r.captionLines,r.textX,r.captionY,l.captionSize,'#52645f',1.3);}
 // Content stays on this single page; no private title, names or text in metadata.
 doc.setProperties({title:'My Plan routine',subject:'Reusable visual routine',creator:'Kapework My Plan'});
 return doc.output('blob');
}
