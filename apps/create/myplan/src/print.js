import { themes, paperSizes, validateSchedule, getStepIllustration } from './model.js';
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
const labelLineHeight = 1.2, captionLineHeight = 1.3, captionGap = 3;
function rowText(step, textWidth, labelSize, captionSize) {
 const labelLines = wrapText(step.label, textWidth, labelSize);
 const captionLines = wrapText(step.caption, textWidth, captionSize);
 const height = labelLines.length * labelSize * labelLineHeight
   + (captionLines.length ? captionGap + captionLines.length * captionSize * captionLineHeight : 0);
 return { labelLines, captionLines, height };
}
function textPosition(text, top, labelSize, captionSize) {
 return {labelY:top+labelSize,
   captionY:top+text.labelLines.length*labelSize*labelLineHeight+captionGap+captionSize};
}
/** PDF points throughout. The preview, PDF and crop editor share these rectangles.
 * `image` is always a square PHOTO slot; `illustration` is rendered for every row.
 * Fonts never shrink to fit. A reward and long text can reduce printable capacity.
 */
export function inspectLayout(input) {
 const schedule = validateSchedule(input), paper = paperSizes[schedule.print.paper];
 const large = schedule.print.paper === 'tabloid';
 const margin = large ? 36 : 28, gap = large ? 14 : 12;
 const titleSize = large ? 36 : 30, labelSize = large ? 30 : 22, captionSize = large ? 14 : 11.5;
 const numberSize = large ? 25 : 20, numberRadius = large ? 21 : 17;
 const maxSteps = large ? 16 : 12, minimumImageSize = large ? 48 : 40;
 const titleLines = wrapText(schedule.title || 'Our plan', paper.width-margin*2, titleSize);
 const top = margin + titleLines.length*titleSize*1.2 + 20, bottom = paper.height-margin;
 const rewardHeight = schedule.reward ? (large ? 120 : 96) : 0;
 const rowHeight = (bottom-top-(rewardHeight ? rewardHeight+gap : 0))/Math.max(1,schedule.steps.length);
 const rowWidth = paper.width-margin*2;
 const imageSize = Math.max(1,Math.min(large ? 132 : 96,rowHeight-(large ? 16 : 14)));
 const hasPhotos = schedule.steps.some(step => step.picture.kind === 'photo');
 const numberColumn = numberRadius*2, textX = margin+numberColumn+gap;
 const photoX = paper.width-margin-imageSize;
 const illustrationX = hasPhotos ? photoX-gap-imageSize : photoX;
 const textWidth = Math.max(1,illustrationX-gap-textX);
 const issues = [];
 if (!schedule.steps.length) issues.push('Add at least one step before printing.');
 if (schedule.steps.length > maxSteps) issues.push(large
   ? 'This page has room for up to 16 rows. Split this routine into two saved schedules.'
   : 'Switch to the 11 × 17 inch wall sheet, or use at most 12 steps.');
 if (titleLines.length > 2) issues.push('Shorten the title to keep the page easy to read.');
 if (schedule.steps.length && imageSize < minimumImageSize) issues.push(large
   ? 'The pictures need more room. Use fewer steps, shorten the title, or put the reward in a separate routine.'
   : 'The pictures need more room. Choose 11 × 17 inches, use fewer steps, or shorten the title.');
 const cards = schedule.steps.map((step,i) => {
   const y = top+i*rowHeight, imageY = y+(rowHeight-imageSize)/2;
   const text = rowText(step,textWidth,labelSize,captionSize);
   if (!step.label.trim()) issues.push(`Give step ${i+1} a short label.`);
   if (text.labelLines.length>2 || text.captionLines.length>2 || text.height>rowHeight-10) {
     issues.push(`Step ${i+1} needs more room. Shorten its label or caption${large
       ? ', or split the routine.' : ', or choose 11 × 17 inches.'}`);
   }
   return {step,number:i+1,x:margin,y,width:rowWidth,height:rowHeight,
     textX,textWidth,labelLines:text.labelLines,captionLines:text.captionLines,
     ...textPosition(text,y+(rowHeight-text.height)/2,labelSize,captionSize),
     numberX:margin+numberRadius,numberY:y+rowHeight/2+numberSize*.35,
     numberCenterY:y+rowHeight/2,numberRadius,numberSize,
     illustrationId:getStepIllustration(step),
     illustration:{x:illustrationX,y:imageY,width:imageSize,height:imageSize},
     image:{x:photoX,y:imageY,width:imageSize,height:imageSize},
   };
 });
 let reward = null;
 if (schedule.reward) {
   const step = schedule.reward, y = bottom-rewardHeight, pad = large ? 14 : 12;
   const size = rewardHeight-pad*2, photoX = paper.width-margin-pad-size;
   const illustrationX = step.picture.kind==='photo' ? photoX-gap-size : photoX;
   const textX = margin+pad, textWidth = Math.max(1,illustrationX-gap-textX);
   const text = rowText({...step,label:step.label||'A special reward'},textWidth,labelSize,captionSize);
   const headingSize = large ? 12 : 10, headingHeight = headingSize*1.3+5;
   if (text.labelLines.length>2 || text.captionLines.length>2 || headingHeight+text.height>rewardHeight-pad*2) {
     issues.push('Shorten the reward label or explanation, or choose the larger paper size.');
   }
   const textTop = y+(rewardHeight-headingHeight-text.height)/2;
   reward = {step,x:margin,y,width:rowWidth,height:rewardHeight,pad,textX,textWidth,
     headingSize,headingY:textTop+headingSize,
     labelLines:text.labelLines,captionLines:text.captionLines,
     ...textPosition(text,textTop+headingHeight,labelSize,captionSize),
     illustrationId:getStepIllustration(step),
     illustration:{x:illustrationX,y:y+pad,width:size,height:size},
     image:{x:photoX,y:y+pad,width:size,height:size},
   };
 }
 return {ok:issues.length===0,issues:[...new Set(issues)],schedule,paper,
   theme:themes[schedule.print.theme],margin,titleSize,titleLines,labelSize,captionSize,
   maxSteps,minimumImageSize,hasPhotos,cards,reward};
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
async function rowImagesSVG(row,resolvePhoto) {
 let output=imageSVG(illustrationURL(row.illustrationId),row.illustration);
 if(row.step.picture.kind==='photo')output+=imageSVG(await pictureURL(row.step.picture,resolvePhoto,row.image),row.image);
 return output;
}
export async function renderPreview(schedule,resolvePhoto){
 const {encoded}=await printAssets();const layout=inspectLayout(schedule),{paper,margin,theme,titleSize,titleLines,labelSize,captionSize}=layout;
 let body=`<rect width="${paper.width}" height="${paper.height}" fill="white"/>${textSVG(titleLines,margin,margin+titleSize,titleSize,'#263e3a')}`;
 if(!layout.ok){body+=textSVG(['Let’s make a little more room.'],margin,margin+titleSize*titleLines.length*1.2+65,20,theme.accent);const msg=wrapText(layout.issues[0],paper.width-margin*2,15);body+=textSVG(msg,margin,margin+titleSize*titleLines.length*1.2+96,15,'#475956');}
 else for(const card of layout.cards){
   body+=`<line x1="${card.x}" y1="${card.y+card.height}" x2="${card.x+card.width}" y2="${card.y+card.height}" stroke="#dce5df" stroke-width="0.7"/>`;
   body+=`<circle cx="${card.numberX}" cy="${card.numberCenterY}" r="${card.numberRadius}" fill="${theme.soft}"/>`;
   body+=textSVG([card.number],card.numberX,card.numberY,card.numberSize,theme.accent,'middle');
   body+=textSVG(card.labelLines,card.textX,card.labelY,labelSize,'#263e3a');
   body+=textSVG(card.captionLines,card.textX,card.captionY,captionSize,'#52645f','start',captionLineHeight);
   body+=await rowImagesSVG(card,resolvePhoto);
 }
 if(layout.ok&&layout.reward){
   const r=layout.reward;
   body+=`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="white" stroke="${theme.accent}" stroke-width="1"/>`;
   body+=textSVG(['A SPECIAL REWARD'],r.textX,r.headingY,r.headingSize,theme.accent);
   body+=textSVG(r.labelLines,r.textX,r.labelY,labelSize,'#263e3a');
   body+=textSVG(r.captionLines,r.textX,r.captionY,captionSize,'#52645f','start',captionLineHeight);
   body+=await rowImagesSVG(r,resolvePhoto);
 }
 const host=document.createElement('div');host.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paper.width} ${paper.height}" width="${paper.width}" height="${paper.height}" role="img" aria-label="${escape(schedule.title||'Our plan')} printable schedule"><defs><style>@font-face{font-family:MyPlanNoto;src:url(data:font/ttf;base64,${encoded}) format('truetype')}</style></defs>${body}</svg>`;const svg=host.firstElementChild;svg.dataset.layoutValid=String(layout.ok);return svg;
}
function pdfText(doc,lines,x,y,size,color,lineHeight=1.2,align='left'){doc.setFontSize(size);doc.setTextColor(color);for(let i=0;i<lines.length;i++)doc.text(String(lines[i]),x,y+i*size*lineHeight,{align});}
async function pdfPicture(doc,picture,r,resolvePhoto){const canvas=picture.kind==='illustration'?await rasterizeSVG(illustrationSVG(picture.id),1000,900):await cropPhoto(await resolvePhoto(picture.assetId),picture.crop,Math.ceil(r.width*4),Math.ceil(r.height*4));let target={...r};if(picture.kind==='illustration'){const ratio=1000/900;if(r.width/r.height>ratio){target.width=r.height*ratio;target.x+= (r.width-target.width)/2;}else{target.height=r.width/ratio;target.y+=(r.height-target.height)/2;}}doc.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',target.x,target.y,target.width,target.height);}
async function pdfRowImages(doc,row,resolvePhoto) {
 await pdfPicture(doc,{kind:'illustration',id:row.illustrationId},row.illustration,resolvePhoto);
 if(row.step.picture.kind==='photo')await pdfPicture(doc,row.step.picture,row.image,resolvePhoto);
}
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
 for(const c of l.cards){
   doc.setDrawColor('#dce5df');doc.setLineWidth(.7);doc.line(c.x,c.y+c.height,c.x+c.width,c.y+c.height);
   doc.setFillColor(l.theme.soft);doc.circle(c.numberX,c.numberCenterY,c.numberRadius,'F');
   pdfText(doc,[c.number],c.numberX,c.numberY,c.numberSize,l.theme.accent,1.2,'center');
   pdfText(doc,c.labelLines,c.textX,c.labelY,l.labelSize,'#263e3a');
   pdfText(doc,c.captionLines,c.textX,c.captionY,l.captionSize,'#52645f',captionLineHeight);
   await pdfRowImages(doc,c,resolvePhoto);
 }
 if(l.reward){
   const r=l.reward;doc.setFillColor('#ffffff');doc.setDrawColor(l.theme.accent);doc.setLineWidth(1);
   doc.roundedRect(r.x,r.y,r.width,r.height,8,8,'FD');
   pdfText(doc,['A SPECIAL REWARD'],r.textX,r.headingY,r.headingSize,l.theme.accent);
   pdfText(doc,r.labelLines,r.textX,r.labelY,l.labelSize,'#263e3a');
   pdfText(doc,r.captionLines,r.textX,r.captionY,l.captionSize,'#52645f',captionLineHeight);
   await pdfRowImages(doc,r,resolvePhoto);
 }
 // Content stays on this single page; no private title, names or text in metadata.
 doc.setProperties({title:'My Plan routine',subject:'Reusable visual routine',creator:'Kapework My Plan'});
 return doc.output('blob');
}
