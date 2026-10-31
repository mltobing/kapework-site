import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCropSession, cropPhoto } from '../src/images.js';
import { createRoutine } from '../src/model.js';
import { renderPreview, createPdf } from '../src/print.js';

// A lightweight drawing adapter counts real production decode/render calls.
// Browser drawing and physical-device output are checked separately.
test('crop sessions and bounded preview cache avoid redundant photo decodes', async () => {
  const names = ['document','createImageBitmap','FontFace','fetch','jspdf'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis,name)]));
  let decodes = 0, closes = 0, failDecode = false;
  const canvases = [];
  globalThis.createImageBitmap = async () => {
    decodes++;
    if (failDecode) throw new Error('Decode unavailable');
    return { width:1200, height:800, close(){closes++;} };
  };
  globalThis.document = {
    fonts:{add(){}},
    createElement(tag) {
      if (tag === 'div') return {innerHTML:'',firstElementChild:{dataset:{}}};
      assert.equal(tag,'canvas');
      const canvas = {width:0,height:0,draws:[],toDataURL(){return 'data:image/jpeg;base64,AA==';}};
      canvas.getContext = () => ({ fillRect(){}, drawImage(...args){canvas.draws.push(args);} });
      canvases.push(canvas);
      return canvas;
    },
  };
  globalThis.FontFace = class { async load(){return this;} };
  globalThis.fetch = async url => ({ok:true,arrayBuffer:async()=>{
    const data=await readFile(url);return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
  }});
  await import('../vendor/jspdf.umd.min.js');
  const asset = {id:crypto.randomUUID(),blob:new Blob(['photo'],{type:'image/jpeg'}),width:1200,height:800};
  try {
    const session = await createCropSession(asset);
    assert.equal(decodes,1);
    const first = session.render({x:.5,y:.5,zoom:1},600,300);
    const second = session.render({x:.1,y:.9,zoom:2},600,300);
    assert.equal(first,second,'dragging reuses a single canvas');
    assert.equal(decodes,1,'repositioning does not decode the JPEG again');
    assert.equal(second.draws.length,2);
    session.dispose();session.dispose();assert.equal(closes,1);
    assert.throws(()=>session.render({},600,300),/closed/);
    const result = await cropPhoto(asset,{x:.5,y:.5,zoom:1},300,250);
    assert.equal(result.width,300);assert.equal(result.height,250);
    assert.equal(closes,2,'one-off crops dispose their decoded source');

    const schedule=createRoutine('bedtime');
    schedule.steps[0].picture={kind:'photo',assetId:asset.id,crop:{x:.5,y:.5,zoom:1}};
    const resolve=async()=>asset;
    const before=decodes;
    await Promise.all([renderPreview(schedule,resolve),renderPreview(schedule,resolve)]);
    assert.equal(decodes,before+1,'simultaneous previews share one decode');
    schedule.title='Our evening';await renderPreview(schedule,resolve);
    assert.equal(decodes,before+1,'text-only updates reuse the cached crop');
    for(const x of [.1,.2,.3]){schedule.steps[0].picture.crop.x=x;await renderPreview(schedule,resolve);}
    assert.equal(decodes,before+4);
    schedule.steps[0].picture.crop.x=.5;await renderPreview(schedule,resolve);
    assert.equal(decodes,before+5,'only the three most recent crop results are retained');

    const other={...asset,blob:new Blob(['another-photo'],{type:'image/jpeg'})};
    failDecode=true;await assert.rejects(renderPreview(schedule,async()=>other));
    failDecode=false;const afterFailure=decodes;await renderPreview(schedule,async()=>other);
    assert.equal(decodes,afterFailure+1,'a failed decode does not poison the cache');

    schedule.title='Our bedtime 🧸';
    await assert.rejects(createPdf(schedule,resolve),error=>
      typeof error.userMessage==='string'&&error.userMessage.includes('Remove emoji'));
  } finally {
    for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  }
});
