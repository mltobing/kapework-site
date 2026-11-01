import { createRoutine, createStep, LIMITS, validateSchedule, getStepIllustration, withPhoto, withIllustration, withoutPhoto } from './model.js';
import { illustrations, illustrationSVG } from './illustrations.js';
import { preparePhoto, cropPhoto, createCropSession } from './images.js';
import { renderPreview, createPdf, inspectLayout } from './print.js';
import { createStore } from './storage.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clone = value => structuredClone(value);
let current = null, screen = 'home', history = [], inputGroup = '', previewVersion = 0;
let previewTimer, photoTarget, lastFocus, lastScroll = 0, modalCleanup = () => {}, libraryVersion = 0;
let store, knownAccountId = null, accountRevision = 0, editorSession = null;
const photoAssets=new Map();
function resolvePhoto(id){
  const revision=accountRevision,key=revision+':'+id;
  if(!photoAssets.has(key)&&photoAssets.size>=32)photoAssets.delete(photoAssets.keys().next().value);
  if(!photoAssets.has(key))photoAssets.set(key,store.getPhoto(id).then(asset=>{if(revision!==accountRevision)throw new Error('Account changed.');return asset;}).catch(error=>{photoAssets.delete(key);throw error;}));
  return photoAssets.get(key);
}
const app = $('#app');
const modal = $('#modal');

function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function notice(message) {
  const el = $('#notice'); el.textContent = message; el.hidden = !message;
}
function errorMessage(error, fallback) {
  // Do not log errors that may contain schedule text or storage URLs.
  return error?.userMessage || (/^(This |Please |The |That |Your |Photo |Image |Backup |Unsupported |Could not |Unable |Not enough )/.test(error?.message || '') ? error.message : fallback);
}
function showError(error, fallback = 'That did not finish. Your existing schedule is still here. Please try again.') {
  notice(errorMessage(error, fallback));
}
function rememberCurrent() {
  try { localStorage.setItem('myplan:last-open', current?.id || ''); } catch { /* IndexedDB remains authoritative. */ }
}
function rememberHistory(group = '') {
  if (!group || inputGroup !== group) {
    history.push(clone(current)); if (history.length > 35) history.shift();
  }
  inputGroup = group;
}
function edit(mutate, { group = '', redraw = false } = {}) {
  if (!current) return;
  rememberHistory(group); mutate(current);
  persist();
  if (redraw) renderEditor(true); else updateUndo();
  queuePreview();
}
function saveEditor() {
  if (!current || !editorSession) return;
  const snapshot = clone(current), editor = editorSession;
  editor.pending++; const intent = ++editor.intent;
  return store.save(snapshot, { editSession: editor.token })
    .then(schedule => { editor.saved = Math.max(editor.saved, intent); return schedule; })
    .finally(() => { editor.pending--; });
}
function persist() {
  const editor = editorSession;
  saveEditor()?.catch(error => { if (editorSession === editor) showError(error, 'Your latest edit could not be saved on this device. Keep this page open and export a backup.'); });
}
function beginEditor(id) { return { token: store.beginEdit(id), pending: 0, intent: 0, saved: 0 }; }
function editorHasUnsavedIntent() { return editorSession && (editorSession.pending || editorSession.saved < editorSession.intent); }
function updateUndo() { const button = $('#undo-button'); if (button) button.disabled = !history.length; }
function undo() {
  if (!history.length) return;
  current = history.pop(); inputGroup = ''; persist(); renderEditor(true); toast('Edit undone.');
}
function openSchedule(schedule) {
  if (!schedule) return;
  current = validateSchedule(schedule); editorSession = beginEditor(schedule.id);
  history = []; inputGroup = ''; screen = 'editor'; rememberCurrent();
  renderEditor(); window.scrollTo(0, 0);
}
async function startRoutine(key) {
  const revision=accountRevision;
  try { const schedule = createRoutine(key); await store.save(schedule); if(revision===accountRevision)openSchedule(schedule); }
  catch (error) { showError(error, 'We could not save a new schedule on this device. Check available storage and try again.'); }
}
function headerAccount(session) { $('#account-button').textContent = session ? 'Account' : 'Sign in'; }

function renderHome() {
  screen = 'home'; current = null; editorSession = null; previewVersion++; $('#notice').hidden = true;
  app.innerHTML = `<div class="home">
    <section class="hero"><div><div class="eyebrow">Small steps. Made together.</div><h1>A little plan.<br>A <em>lovely day.</em></h1><p>Make a picture routine together, one familiar moment at a time. Follow each step from left to right: a number, clear words, an illustration, and your own photo if you like.</p><div class="together-note"><span aria-hidden="true">✦</span><span>Made for your family. Ready for every day.</span></div></div><div class="hero-art" aria-label="Example bedtime routine"><div class="paper-wrap" id="hero-page"></div><div class="sun-badge">${illustrationSVG('star')}</div><div class="art-caption">Your pictures. Your pace. Your plan.</div></div></section>
    <section aria-labelledby="start-heading"><div class="section-heading"><div><h2 id="start-heading">Where shall we start?</h2><p>Every step is yours to change. These are just ideas.</p></div></div><div class="starter-grid">${[
      ['morning','School morning','A gentle start, from waking up to heading out.','wake'],
      ['home','Coming home','Settle in, unpack, and make room for fun.','leave'],
      ['bedtime','Bedtime','Familiar moments for a cosy end to the day.','sleep'],
      ['blank','Start from blank','Any routine, in your own order.','']
    ].map(([key,title,description,icon])=>`<button class="starter" data-starter="${key}"><div class="starter-visual ${icon?'':'plus-art'}">${icon?illustrationSVG(icon):'+'}</div><h3>${title}</h3><p>${description}</p></button>`).join('')}</div></section>
    <div class="home-footer"><p>One reusable page. No daily resets, ticks, or tracking.</p><button class="text-button" id="home-import">Restore an editable backup</button></div></div>`;
  app.querySelectorAll('[data-starter]').forEach(button => button.onclick = () => startRoutine(button.dataset.starter));
  $('#home-import').onclick = () => $('#backup-input').click();
  renderPreview(createRoutine('bedtime'), resolvePhoto).then(svg => { if (screen === 'home') $('#hero-page')?.replaceChildren(svg); }).catch(() => {});
}

function pictureHTML(step, target) {
  const picture=step.picture, hasPhoto=picture.kind==='photo';
  return `<div class="step-pictures"><figure><figcaption>Illustration</figcaption><div class="step-picture">${illustrationSVG(getStepIllustration(step))}</div></figure><figure><figcaption>Your photo <span class="hint">optional</span></figcaption><div class="step-picture ${hasPhoto?'':'empty-photo'}" data-picture-target="${target}">${hasPhoto?'<span class="hint">Loading photo…</span>':'<span class="hint">Add your own example</span>'}</div></figure></div>`;
}
function pictureButtons(target, picture) {
  return `<div class="photo-buttons"><button data-picture="illustration" data-target="${target}">Choose illustration</button><button data-picture="camera" data-target="${target}">Take photo</button><button data-picture="choose" data-target="${target}">Choose photo</button>${picture?.kind === 'photo' ? `<button data-picture="crop" data-target="${target}">Recrop photo</button><button data-picture="remove-photo" data-target="${target}">Remove photo</button>` : ''}</div>`;
}
function stepHTML(step, index) {
  return `<article class="step-card" data-step-id="${step.id}"><div class="step-heading"><span class="step-number">${index+1}</span><h3>Step ${index+1}</h3><button class="remove-step" data-remove="${index}" aria-label="Remove step ${index+1}">Remove</button></div><div class="step-fields"><div><label class="field">Short label<input data-field="label" data-target="${step.id}" value="${esc(step.label)}" maxlength="48" autocomplete="off"></label><label class="field">Caption <span class="hint">Optional · a little more explanation</span><textarea data-field="caption" data-target="${step.id}" rows="2" maxlength="100">${esc(step.caption)}</textarea></label></div>${pictureHTML(step, step.id)}</div>${pictureButtons(step.id,step.picture)}<div class="step-bottom"><div class="move-buttons"><button data-move="${index}" data-direction="-1" ${index===0?'disabled':''} aria-label="Move step ${index+1} up">↑ Move up</button><button data-move="${index}" data-direction="1" ${index===current.steps.length-1?'disabled':''} aria-label="Move step ${index+1} down">↓ Move down</button></div><button class="small" data-move-to="${index}">Move to…</button></div></article>`;
}
function insertHTML(index) { return `<div class="insert-slot"><button data-insert="${index}" ${current.steps.length>=LIMITS.steps?'disabled':''}>＋ ${index === current.steps.length ? 'Add a step' : 'Insert a step here'}</button></div>`; }
function renderEditor(preservePosition = false) {
  screen = 'editor'; const scroll = window.scrollY;
  const routine = current;
  app.innerHTML = `<div class="workspace"><div class="workspace-top"><div class="editor-heading"><div class="eyebrow">Let’s make it yours</div><h1>Our routine</h1></div><button class="secondary small" id="undo-button" ${!history.length?'disabled':''}>↶ Undo</button><button class="secondary small" id="editor-library">My schedules</button></div><div class="workspace-grid"><section class="editor" aria-label="Edit your schedule"><div class="editor-panel"><label class="field title-field">Our schedule is called<input id="schedule-title" value="${esc(routine.title)}" maxlength="64" autocomplete="off"></label><p class="hint">Use a name that feels right for your family.</p></div><div class="editor-section-title"><h2>One step at a time</h2><p>${routine.steps.length} steps</p></div><div id="steps">${insertHTML(0)}${routine.steps.map((step,i)=>stepHTML(step,i)+insertHTML(i+1)).join('')}</div>
    <section class="reward-panel" aria-labelledby="reward-heading"><div class="reward-head"><div><h3 id="reward-heading">A little something to look forward to</h3><p>An optional agreed reward, separate from the steps.</p></div>${routine.reward?'<button id="remove-reward" class="small">Remove</button>':'<button id="add-reward" class="secondary small">＋ Add</button>'}</div>${routine.reward?`<div class="step-fields"><div><label class="field">Reward<input data-field="label" data-target="reward" value="${esc(routine.reward.label)}" maxlength="48"></label><label class="field">What earns it?<textarea rows="2" data-field="caption" data-target="reward" maxlength="100">${esc(routine.reward.caption)}</textarea></label></div>${pictureHTML(routine.reward,'reward')}</div>${pictureButtons('reward',routine.reward.picture)}`:''}</section>
    <section class="editor-panel settings" aria-labelledby="page-settings"><h3 id="page-settings">Make it wall-ready</h3><div class="settings-row"><label class="field">Paper size<select id="paper-size"><option value="letter" ${routine.print.paper==='letter'?'selected':''}>US Letter · 8½ × 11 in</option><option value="tabloid" ${routine.print.paper==='tabloid'?'selected':''}>Large · 11 × 17 in</option></select></label><div><div class="field">Colour theme</div><div class="theme-options">${[['sage','#99b19b','Sage'],['peach','#e8ac8b','Peach'],['sky','#97b5d2','Sky']].map(([theme,color,label])=>`<button class="theme-option" data-theme="${theme}" aria-label="${label} theme" aria-pressed="${routine.print.theme===theme}"><span class="swatch" style="background:${color}"></span>${label}</button>`).join('')}</div></div></div><p class="hint">One step per row, in the same familiar order. Up to 12 on Letter or 16 on the large sheet; longer captions and rewards may need more room.</p><div class="layout-warning" id="editor-layout-warning" hidden></div></section><div class="editor-footer"><button class="secondary" id="backup-export">Export editable backup</button><button class="secondary" id="duplicate-current">Duplicate schedule</button><button class="danger" id="delete-current">Delete schedule</button></div></section>
    <aside class="preview-column" aria-label="Live page preview"><div class="preview-top"><h2>Our schedule</h2><span id="paper-description"></span></div><div class="paper-wrap" id="live-preview"></div><div class="layout-warning" id="layout-warning" hidden></div><div class="preview-actions"><button class="primary" data-export="pdf">Download PDF</button><button class="secondary" data-export="print">Print</button></div><p class="preview-footnote">One page to put up, laminate, and use again.</p></aside></div></div><button class="mobile-preview-button" id="see-schedule">See our schedule <span>Preview & print ↗</span></button>`;
  $('#schedule-title').oninput = event => edit(s => { s.title = event.target.value; }, {group:'title'});
  app.querySelectorAll('[data-field]').forEach(input => {
    input.oninput = () => edit(s => { const step = input.dataset.target === 'reward' ? s.reward : s.steps.find(item => item.id === input.dataset.target); if(step) step[input.dataset.field] = input.value; }, {group:`${input.dataset.target}:${input.dataset.field}`});
    input.onblur = () => { inputGroup = ''; };
  });
  $('#schedule-title').onblur = () => { inputGroup = ''; };
  app.querySelectorAll('[data-insert]').forEach(button => button.onclick = () => {
    if(current.steps.length>=LIMITS.steps){toast('Start another routine for more than 24 steps.');return;}
    const step = createStep(); const index = Number(button.dataset.insert);
    edit(s => s.steps.splice(index,0,step),{redraw:true});
    const field = app.querySelector(`[data-target="${step.id}"][data-field="label"]`); field?.focus(); field?.select();
  });
  app.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { edit(s => s.steps.splice(Number(button.dataset.remove),1),{redraw:true}); toast('Step removed. Use Undo to bring it back.'); });
  app.querySelectorAll('[data-move]').forEach(button => button.onclick = () => moveStep(Number(button.dataset.move),Number(button.dataset.move)+Number(button.dataset.direction)));
  app.querySelectorAll('[data-move-to]').forEach(button => button.onclick = () => choosePosition(Number(button.dataset.moveTo)));
  app.querySelectorAll('[data-picture]').forEach(button => button.onclick = () => choosePicture(button.dataset.picture,button.dataset.target));
  app.querySelectorAll('[data-theme]').forEach(button => button.onclick = () => edit(s=>{s.print.theme=button.dataset.theme;},{redraw:true}));
  $('#paper-size').onchange = event => edit(s=>{s.print.paper=event.target.value;},{redraw:true});
  $('#undo-button').onclick = undo;
  $('#editor-library').onclick = renderLibrary;
  $('#see-schedule').onclick = showPreview;
  $('#add-reward')?.addEventListener('click',()=>edit(s=>{s.reward={label:'Our agreed reward',caption:'When we finish our routine',picture:{kind:'illustration',id:'star'}};},{redraw:true}));
  $('#remove-reward')?.addEventListener('click',()=>edit(s=>{s.reward=null;},{redraw:true}));
  $('#backup-export').onclick = exportBackup;
  $('#duplicate-current').onclick = () => duplicate(current.id);
  $('#delete-current').onclick = () => confirmDelete(current.id);
  wireExports(app);
  fillPictures(); queuePreview();
  if(preservePosition) window.scrollTo(0,scroll);
}
function moveStep(from,to) {
  if(from===to || to<0 || to>=current.steps.length) return;
  edit(s=>{const [step]=s.steps.splice(from,1);s.steps.splice(to,0,step);},{redraw:true});
  toast(`Moved to step ${to+1}.`);
}
function choosePosition(index) {
  openModal('Move this step',`<p class="dialog-copy">Choose where “${esc(current.steps[index].label)}” belongs.</p><label class="field">Position<select id="move-position">${current.steps.map((step,i)=>`<option value="${i}" ${i===index?'selected':''}>${i+1} · ${esc(step.label)}</option>`).join('')}</select></label><div class="dialog-actions"><button class="secondary" data-close>Cancel</button><button class="primary" id="confirm-move">Move step</button></div>`);
  $('#confirm-move').onclick=()=>{const to=Number($('#move-position').value);closeModal();moveStep(index,to);};
}
async function fillPictures() {
  const id=current.id;
  for(const el of app.querySelectorAll('[data-picture-target]')) {
    const target=el.dataset.pictureTarget;
    const step=target==='reward'?current.reward:current.steps.find(s=>s.id===target);
    if(step?.picture.kind!=='photo') continue;
    try { const asset=await resolvePhoto(step.picture.assetId); const canvas=await cropPhoto(asset,step.picture.crop,360,360); if(current?.id===id&&el.isConnected)el.replaceChildren(canvas); }
    catch { if(el.isConnected)el.innerHTML='<span class="hint">Photo unavailable.<br>Retry sync.</span>'; }
  }
}
function queuePreview() { clearTimeout(previewTimer); previewTimer=setTimeout(updatePreview,60); }
async function updatePreview() {
  if(!current || screen!=='editor')return;
  const version=++previewVersion, schedule=clone(current);
  const layout=inspectLayout(schedule);
  const problems=layout.issues || [];
  for(const el of [$('#layout-warning'),$('#editor-layout-warning')].filter(Boolean)) {
    el.hidden=layout.ok;
    el.innerHTML=layout.ok?'':`${problems.map(issue=>esc(typeof issue==='string'?issue:issue.message)).join('<br>')}<div>${schedule.print.paper==='letter'?'<button data-adjust-paper>Use 11 × 17</button>':''}<button data-adjust-labels>Review labels & steps</button></div>`;
    $('[data-adjust-paper]',el)?.addEventListener('click',()=>edit(s=>{s.print.paper='tabloid';},{redraw:true}));
    $('[data-adjust-labels]',el)?.addEventListener('click',()=>{if($('#preview-dialog').open)closePreview();$('#steps')?.scrollIntoView({behavior:'smooth',block:'start'});});
  }
  document.querySelectorAll('[data-export]').forEach(button=>{button.disabled=!layout.ok;});
  if($('#paper-description'))$('#paper-description').textContent=schedule.print.paper==='letter'?'US Letter · portrait':'11 × 17 in · portrait';
  try {
    const svg=await renderPreview(schedule,resolvePhoto);
    if(version!==previewVersion || current?.id!==schedule.id)return;
    $('#live-preview')?.replaceChildren(svg);
    if($('#preview-dialog').open)$('#phone-preview').replaceChildren(svg.cloneNode(true));
  } catch(error) { if(version===previewVersion)showError(error,'The page preview could not load a picture. Your edits are saved; retry sync or replace the picture.'); }
}
function showPreview() {
  lastScroll=window.scrollY;lastFocus=document.activeElement;
  const svg=$('#live-preview svg');if(svg)$('#phone-preview').replaceChildren(svg.cloneNode(true));
  $('#preview-dialog').showModal();document.body.style.overflow='hidden';
  updatePreview();
}
function closePreview() { $('#preview-dialog').close(); }
$('#back-to-edit').onclick=closePreview;
$('#preview-dialog').addEventListener('close',()=>{document.body.style.overflow='';window.scrollTo(0,lastScroll);lastFocus?.focus({preventScroll:true});});
function wireExports(root) { root.querySelectorAll('[data-export]').forEach(button=>button.onclick=()=>output(button.dataset.export,button)); }
wireExports($('#preview-dialog'));
function download(blob,name) {
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.rel='noopener';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function output(kind,button) {
  if(!current)return;
  const snapshot=clone(current), ownerRevision=accountRevision;
  if(!inspectLayout(snapshot).ok){toast('Adjust the page before printing. See the note beside the preview.');return;}
  const label=button.textContent;button.disabled=true;button.textContent=kind==='pdf'?'Making PDF…':'Preparing…';
  try {
    if(kind==='pdf') { const blob=await createPdf(snapshot,resolvePhoto);if(ownerRevision!==accountRevision)return;download(blob,'my-plan.pdf');toast('PDF ready. Look in your browser’s downloads.'); }
    else {
      const svg=await renderPreview(snapshot,resolvePhoto);
      if(ownerRevision!==accountRevision)return;
      let surface=$('#print-surface');if(!surface){surface=document.createElement('div');surface.id='print-surface';surface.style.display='none';document.body.append(surface);}
      surface.replaceChildren(svg);
      let style=$('#print-page-style');if(!style){style=document.createElement('style');style.id='print-page-style';document.head.append(style);}
      const inches=snapshot.print.paper==='letter'?[8.5,11]:[11,17];
      style.textContent=`@page { size: ${inches[0]}in ${inches[1]}in; margin: 0; } @media print { #print-surface { width:${inches[0]}in; height:${inches[1]}in; } }`;
      await document.fonts.ready;
      // Printing the top-level document also works when Safari blocks asynchronous popups.
      const wasPreview=$('#preview-dialog').open;if(wasPreview)closePreview();
      window.print();
    }
  } catch(error) { showError(error,kind==='pdf'?'The PDF could not be created. Your schedule is safe. Please retry.':'Printing could not start. Try Download PDF instead.'); }
  finally { button.disabled=false;button.textContent=label; }
}

function openModal(title,html) {
  if(modal.open)closeModal();
  modal.innerHTML=`<div class="dialog-head"><h2 id="modal-title">${esc(title)}</h2><button data-close aria-label="Close dialog">✕</button></div>${html}`;
  modal.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeModal);
  modal.showModal();
}
function closeModal(){modal.close();}
modal.addEventListener('close',()=>{modalCleanup();modalCleanup=()=>{};});
function targetStep(target){return target==='reward'?current?.reward:current?.steps.find(step=>step.id===target);}
function choosePicture(action,target) {
  if(action==='illustration') {
    openModal('Choose an illustration',`<p class="dialog-copy">Choose the illustration for this step. Your photo stays beside it.</p><div class="illustration-grid">${illustrations.map(item=>`<button class="illustration-choice" data-illustration="${item.id}">${illustrationSVG(item.id)}${esc(item.label)}</button>`).join('')}</div>`);
    modal.querySelectorAll('[data-illustration]').forEach(button=>button.onclick=()=>{const id=button.dataset.illustration;closeModal();edit(()=>{const step=targetStep(target);if(step)step.picture=withIllustration(step,id);},{redraw:true});});
  } else if(action==='remove-photo') {
    edit(()=>{const step=targetStep(target);if(step?.picture.kind==='photo')step.picture=withoutPhoto(step);},{redraw:true});
    toast('Photo removed. Use Undo to bring it back.');
  } else if(action==='crop') {
    const step=targetStep(target);if(!step||step.picture.kind!=='photo')return;
    Promise.resolve().then(async()=>{const id=current.id,revision=accountRevision,picture=clone(step.picture);const asset=await resolvePhoto(picture.assetId);if(current?.id===id&&revision===accountRevision&&targetStep(target)?.picture.assetId===picture.assetId)openCrop(asset,target,picture.crop);}).catch(error=>showError(error,'This photo could not be opened. Retry sync.'));
  } else {
    // Every preceding input event is already queued to IndexedDB. Cancellation changes nothing.
    photoTarget={scheduleId:current.id,target,revision:accountRevision};
    const input=action==='camera'?$('#camera-input'):$('#photo-input');input.value='';input.click();
  }
}
async function receivePhoto(event) {
  const file=event.target.files?.[0];const selection=photoTarget;event.target.value='';
  if(!file || !selection || current?.id!==selection.scheduleId || selection.revision!==accountRevision)return;
  toast('Getting your picture ready…');
  try { const asset=await preparePhoto(file);if(current?.id===selection.scheduleId&&selection.revision===accountRevision)openCrop(asset,selection.target); }
  catch(error){showError(error,'This picture could not be opened. Try a JPEG or PNG, or choose an illustration. Your existing picture is unchanged.');}
}
$('#camera-input').onchange=receivePhoto;$('#photo-input').onchange=receivePhoto;
async function openCrop(asset,target,initial={x:.5,y:.5,zoom:1}) {
  const scheduleId=current.id,revision=accountRevision,crop={...initial};let generation=0,closed=false,cropSession;
  const layout=inspectLayout(current); const image=target==='reward'?layout.reward?.image:layout.cards.find(card=>card.step.id===target)?.image;
  const aspect=image&&image.height>0?image.width/image.height:1;
  openModal('Make the picture fit',`<p class="dialog-copy">Drag to reposition, or use the sliders. This square is the photo frame on your sheet; your illustration stays beside it. The full photo stays available for recropping.</p><div class="crop-display" id="crop-display" aria-label="Crop preview"></div><label class="crop-field">Zoom<input id="crop-zoom" type="range" min="1" max="3" step="0.02" value="${crop.zoom}"></label><label class="crop-field">Left ↔ right<input id="crop-x" type="range" min="0" max="1" step="0.01" value="${crop.x}"></label><label class="crop-field">Top ↔ bottom<input id="crop-y" type="range" min="0" max="1" step="0.01" value="${crop.y}"></label><p class="hint">Your schedule preview will show the final page crop.</p><div class="dialog-actions"><button class="secondary" data-close>Cancel</button><button class="primary" id="use-picture">Use this picture</button></div>`);
  modalCleanup=()=>{closed=true;cropSession?.dispose();};
  $('#crop-display').style.aspectRatio=String(aspect);
  async function draw(){const n=++generation;try{if(!cropSession)return;const canvas=cropSession.render(crop,780,780/aspect);if(!closed&&n===generation)$('#crop-display')?.replaceChildren(canvas);}catch(error){showError(error,'This image could not be cropped. Try another photo.');}}
  ['x','y','zoom'].forEach(key=>$('#crop-'+key).oninput=event=>{crop[key]=Number(event.target.value);draw();});
  let pointer=null;const display=$('#crop-display');
  display.onpointerdown=event=>{pointer={id:event.pointerId,x:event.clientX,y:event.clientY,crop:{...crop}};display.setPointerCapture(event.pointerId);};
  display.onpointermove=event=>{if(!pointer)return;crop.x=Math.max(0,Math.min(1,pointer.crop.x-(event.clientX-pointer.x)/display.clientWidth));crop.y=Math.max(0,Math.min(1,pointer.crop.y-(event.clientY-pointer.y)/display.clientHeight));$('#crop-x').value=crop.x;$('#crop-y').value=crop.y;draw();};
  display.onpointerup=display.onpointercancel=()=>{pointer=null;};
  $('#use-picture').onclick=async()=>{const button=$('#use-picture');button.disabled=true;button.textContent='Saving picture…';try{await store.putPhoto(asset);if(current?.id===scheduleId&&revision===accountRevision&&targetStep(target)){closeModal();edit(()=>{const step=targetStep(target);step.picture=withPhoto(step,{assetId:asset.id,crop:{...crop}});},{redraw:true});toast('Your picture is in the schedule.');}}catch(error){button.disabled=false;button.textContent='Use this picture';showError(error,'The photo could not be saved. Free some device storage and try again. Your previous picture is unchanged.');}};
  try{cropSession=await createCropSession(asset);if(closed){cropSession.dispose();return;}await draw();}catch(error){showError(error,'This photo could not be opened for cropping.');}
}

async function duplicate(id) {
  const revision=accountRevision;app.inert=true;
  try {if(current?.id===id)id=(await saveEditor()).id;await store.flushLocal();if(revision!==accountRevision)return;const copy=await store.duplicate(id);if(revision!==accountRevision)return;openSchedule(copy);toast('A separate copy, ready to make your own.');}
  catch(error){showError(error,'The copy could not be saved. Please try again.');}
  finally {app.inert=false;}
}
function confirmDelete(id) {
  const schedule=store.get(id);if(!schedule)return;
  const deleteSession=current?.id===id ? editorSession.token : store.beginEdit(id);
  openModal('Delete this schedule?',`<p class="dialog-copy">“${esc(schedule.title||'Untitled routine')}” will be removed from your schedules. You can export an editable backup first.</p><div class="dialog-actions"><button class="secondary" data-close>Keep schedule</button><button class="danger" id="confirm-delete">Delete schedule</button></div>`);
  $('#confirm-delete').onclick=async()=>{const button=$('#confirm-delete');button.disabled=true;try{const removed=await store.remove(id,{editSession:deleteSession});closeModal();if(current?.id===id)current=null;renderLibrary();if(removed)toast('Schedule deleted.');else notice('This schedule changed in another tab. The latest version has been kept. Open it before deciding whether to delete it.');}catch(error){button.disabled=false;showError(error,'The schedule could not be deleted. Please try again.');}};
}
async function exportBackup(){if(!current)return;const revision=accountRevision;try{const blob=await store.exportBackup(clone(current));if(revision!==accountRevision)return;download(blob,'my-plan.myplan.json');toast('Editable backup downloaded, including pictures.');}catch(error){showError(error,'The backup could not be created. Retry sync so all pictures are available.');}}
$('#backup-input').onchange=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const revision=accountRevision;try{const schedule=await store.importBackup(file);if(revision!==accountRevision)return;openSchedule(schedule);toast('Backup restored as a separate schedule.');}catch(error){showError(error,'This backup could not be restored. Your existing schedules are unchanged.');}};
function renderLibrary() {
  screen='library';current=null;editorSession=null;previewVersion++;const version=++libraryVersion;const schedules=store.list();
  app.innerHTML=`<section class="library"><div class="section-heading"><div><div class="eyebrow">Ready whenever you are</div><h1>My schedules</h1><p>Reopen, change a little, or make a fresh copy.</p></div><button class="primary" id="new-schedule">＋ New</button></div>${schedules.length?`<div class="library-grid">${schedules.map(schedule=>`<article class="schedule-card"><div class="schedule-thumb" data-open="${schedule.id}" role="button" tabindex="0" aria-label="Open ${esc(schedule.title)}"><div class="paper-wrap" data-thumb="${schedule.id}"></div></div><h3>${esc(schedule.title||'Untitled routine')}</h3><p>${schedule.steps.length} steps · ${schedule.print.paper==='letter'?'US Letter':'11 × 17'}</p><div class="schedule-card-actions"><button class="primary" data-open="${schedule.id}">Edit</button><button data-duplicate="${schedule.id}">Duplicate</button><button class="danger" data-delete="${schedule.id}">Delete</button></div></article>`).join('')}</div>`:`<div class="empty-library">${illustrationSVG('star')}<h2>Your little plans live here.</h2><p>Start with a routine, make it yours, and come back to it whenever you like.</p><button class="primary" id="first-schedule">Make a schedule</button></div>`}<div class="home-footer"><p>${store.getSession()?'Private to your account. Never posted to a family feed.':'Stored in this browser. Sign in to save across devices, or keep an editable backup.'}</p><button class="text-button" id="library-import">Restore a backup</button></div></section>`;
  $('#new-schedule').onclick=renderHome;$('#first-schedule')?.addEventListener('click',renderHome);$('#library-import').onclick=()=>$('#backup-input').click();
  app.querySelectorAll('[data-open]').forEach(button=>{button.onclick=()=>openSchedule(store.get(button.dataset.open));if(button.tagName!=='BUTTON')button.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();button.click();}};});
  app.querySelectorAll('[data-duplicate]').forEach(button=>button.onclick=()=>duplicate(button.dataset.duplicate));
  app.querySelectorAll('[data-delete]').forEach(button=>button.onclick=()=>confirmDelete(button.dataset.delete));
  schedules.forEach(async schedule=>{try{const svg=await renderPreview(schedule,resolvePhoto);if(screen==='library'&&version===libraryVersion)app.querySelector(`[data-thumb="${schedule.id}"]`)?.replaceChildren(svg);}catch{/* Missing photo is surfaced when the schedule opens. */}});
  window.scrollTo(0,0);
}
async function showAccount() {
  const revision=accountRevision;
  const session=store.getSession();
  if(session){
    const guest=await store.hasGuestDrafts();if(revision!==accountRevision)return;
    openModal('Your private account',`<p class="dialog-copy">Signed in as ${esc(session.user.email || 'your account')}. Only this account can access its saved routines and photos.</p>${guest?'<p class="dialog-copy">There are schedules made on this device before sign-in. Add them to this account only if they belong to you.</p><button class="secondary" id="claim-drafts">Add this device’s drafts to my account</button>':''}<p class="account-note">A browser on another device will ask you to sign in here too. My Plan does not automatically use a Ma session.</p><div class="dialog-actions"><button class="secondary" id="sync-now">Sync now</button><button class="primary" id="sign-out">Sign out</button></div>`);
    $('#claim-drafts')?.addEventListener('click',async()=>{try{await store.claimGuestDrafts();closeModal();renderLibrary();toast('Device drafts added to your account.');}catch(error){showError(error,'The drafts could not be added. They are still saved on this device.');}});
    $('#sync-now').onclick=async()=>{await store.sync();closeModal();};
    $('#sign-out').onclick=async()=>{try{await store.signOut();closeModal();current=null;renderHome();notice('Signed out. Account drafts remain on this device for your next sign-in.');}catch(error){showError(error,'Sign-out did not finish. Please retry.');}};
    return;
  }
  if(!store.configured){openModal('Keep making together',`<p class="dialog-copy">Account saving is not configured in this preview. Schedules are saved on this device. Export an editable backup to move them safely.</p><div class="dialog-actions"><button class="primary" data-close>Continue on this device</button></div>`);return;}
  openModal('Save across your devices',`<p class="dialog-copy">Use your Google account on each device. Your schedules and photos stay private to you.</p><button class="primary" id="google-sign-in" type="button">Continue with Google</button><p class="account-note">Or use an existing Kapework password below.</p><form id="password-form" class="sign-in-fields"><label class="field">Email<input id="auth-email" type="email" autocomplete="username" required></label><label class="field">Password<input id="auth-password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in</button></form><details ${window.KapeworkConfig?.myplanMagicLinkEnabled === true ? '' : 'hidden'}><summary>Use an email sign-in link</summary><form id="link-form" class="sign-in-fields"><label class="field">Email<input id="link-email" type="email" autocomplete="email" required></label><button class="secondary" type="submit">Send sign-in link</button></form><p class="account-note">Open the link in the same browser and on the same device where you requested it. Use Google to sign in separately on another device.</p></details><p class="account-note">Anyone can create a Kapework account with Google. Use the same email on every device. Device drafts stay here until you choose to add them to your account.</p><div id="auth-message" class="dialog-message" role="status" hidden></div>`);
  $('#google-sign-in').onclick=async()=>{const button=$('#google-sign-in');button.disabled=true;button.textContent='Opening Google…';try{await store.flushLocal();const auth=await import('/shared/auth.js');await auth.signInWithGoogle();}catch(error){const message=$('#auth-message');if(message){message.hidden=false;message.textContent=error.message||'Google sign-in could not start. Your drafts are safe.';}button.disabled=false;button.textContent='Continue with Google';}};
  $('#password-form').onsubmit=async event=>{event.preventDefault();const button=$('button',event.target);button.disabled=true;button.textContent='Signing in…';try{await store.signIn($('#auth-email').value.trim(),$('#auth-password').value);closeModal();renderLibrary();if(await store.hasGuestDrafts())showAccount();}catch{const message=$('#auth-message');if(message){message.hidden=false;message.textContent='Sign-in did not finish. Check your email and password, connection, and account access. Your device drafts are safe.';}}finally{button.disabled=false;button.textContent='Sign in';}};
  $('#link-form').onsubmit=async event=>{event.preventDefault();const button=$('button',event.target);button.disabled=true;try{await store.sendMagicLink($('#link-email').value.trim());$('#auth-message').hidden=false;$('#auth-message').textContent='If this is an existing account, a sign-in link is on its way. Please wait a minute before trying again.';setTimeout(()=>{button.disabled=false;},60000);}catch{button.disabled=false;$('#auth-message').hidden=false;$('#auth-message').textContent='The sign-in link could not be sent. Try your password or contact the Kapework owner.';}};
}

$('#home-button').onclick=renderHome;$('#library-button').onclick=renderLibrary;$('#account-button').onclick=showAccount;
$('#retry-save').onclick=()=>{if(current)persist();store.sync().catch(error=>showError(error));};
window.addEventListener('offline',()=>toast('Offline. Keep editing; changes stay on this device.'));
window.addEventListener('online',()=>store?.sync().catch(()=>{}));
// Every edit already journals synchronously and queues an IndexedDB commit.
// Hiding an unchanged tab must not submit its possibly stale editor snapshot.
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&screen==='editor'&&!modal.open){event.preventDefault();undo();}});

function storageChanged(event) {
  if (event.type === 'refresh' && current?.id === event.id) {
    // A pending intent still owns its original baseline. The store will preserve
    // it separately if the refresh committed a competing version first.
    if (editorHasUnsavedIntent()) return;
    if (event.schedule) {
      current = clone(event.schedule);
      editorSession = beginEditor(current.id);
      history = []; renderEditor(true); toast('Loaded the latest saved version.');
    } else {
      current = null; editorSession = null; history = [];
      if ($('#preview-dialog').open) closePreview();
      if (modal.open) closeModal();
      renderLibrary(); notice('This schedule was deleted on another device. Other schedules are still here.');
    }
  } else if (screen === 'library' && ['refresh', 'removed', 'conflict', 'saved'].includes(event.type)) renderLibrary();
}
function storageConflict(event) {
  notice(event.message || 'Another device changed this schedule. Both versions are kept in My schedules.');
  if (current?.id !== event.originalId || !event.schedule) return;
  // The event may belong to an editor closed and reopened while its write was
  // pending. Only the exact handles redirected by storage may follow the copy.
  if (!event.editSessions?.includes(editorSession?.token)) return;
  if (editorHasUnsavedIntent() || event.editSession === editorSession?.token) {
    // A first queued keystroke may trigger the copy after later edits have
    // already reached the editor. Keep those fields and redirect their identity.
    current.id = event.schedule.id;
    if (current.title === event.originalTitle) current.title = event.schedule.title;
    for (const entry of history) entry.id = event.schedule.id;
    const titleField = $('#schedule-title');
    if (titleField && titleField.value !== current.title) {
      const start = titleField.selectionStart, end = titleField.selectionEnd;
      titleField.value = current.title;
      if (document.activeElement === titleField) titleField.setSelectionRange(start, end);
    }
    // Keep the focused input and caret while rapid typing continues.
    queuePreview(); updateUndo();
  } else {
    current = clone(event.schedule); history = [];
    editorSession = beginEditor(current.id);
    renderEditor(true);
  }
  rememberCurrent();
}

async function boot() {
  window.KapeworkShell?.init({appSlug:'myplan',mountId:'kw-shell-mount'});
  store=createStore({
    onStatus(status){$('#save-status').textContent=status.message;$('.status-bar').dataset.state=status.state;$('#retry-save').hidden=!['error','local'].includes(status.state)||!store?.getSession();},
    onAuth(session){const nextId=session?.user?.id||null;headerAccount(session);if(knownAccountId!==nextId){accountRevision++;photoAssets.clear();previewVersion++;libraryVersion++;current=null;editorSession=null;history=[];if(modal.open)closeModal();if($('#preview-dialog').open)closePreview();$('#phone-preview').replaceChildren();$('#print-surface')?.remove();if(screen!=='home')renderLibrary();}knownAccountId=nextId;},
    onChange: storageChanged,
    onConflict: storageConflict,
  });
  try {
    await store.init();headerAccount(store.getSession());
    let id;try{id=localStorage.getItem('myplan:last-open');}catch{}
    const schedule=id&&store.get(id);if(schedule)openSchedule(schedule);else renderHome();
    let justSignedIn=false;try{justSignedIn=sessionStorage.getItem('kapework:auth:completed')==='1';sessionStorage.removeItem('kapework:auth:completed');}catch{}
    if(justSignedIn&&store.getSession()){renderLibrary();if(await store.hasGuestDrafts())await showAccount();}
    if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
  }catch(error){app.innerHTML='<div class="empty-library"><h1>We couldn’t open device storage.</h1><p>Allow website storage, check free space, and reopen My Plan. Existing backups can be restored when storage is available.</p><button class="primary" id="reload">Try again</button></div>';$('#reload').onclick=()=>location.reload();showError(error,'Device saving is unavailable. Please check browser storage settings.');}
}
boot();
