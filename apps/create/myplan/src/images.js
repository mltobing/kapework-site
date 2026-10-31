/** Photos are decoded and redrawn before storage: no EXIF/location metadata retained. */
const maxBytes=35*1024*1024;
export async function loadImage(blob){
 if(typeof createImageBitmap==='function'){try{return await createImageBitmap(blob,{imageOrientation:'from-image'});}catch{/* Safari may decode HEIC via HTMLImageElement instead. */}}
 const url=URL.createObjectURL(blob);try{return await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('This picture could not be opened. Choose a JPEG, PNG or WebP picture, or take a new photo.'));img.src=url;});}finally{URL.revokeObjectURL(url);}
}
export async function preparePhoto(file){
 if(!(file instanceof Blob)||!file.size)throw new Error('Choose a picture first.');
 if(file.size>maxBytes)throw new Error('This picture is too large. Choose one smaller than 35 MB.');
 if(file.type==='image/svg+xml')throw new Error('Choose a photograph (JPEG, PNG or WebP), or use Choose illustration.');
 let source;try{source=await loadImage(file);const sw=source.width||source.naturalWidth,sh=source.height||source.naturalHeight;if(!sw||!sh||sw*sh>100000000)throw new Error('This picture is too large to process safely. Choose a smaller copy.');const scale=Math.min(1,2000/Math.max(sw,sh));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('The photo editor is not available in this browser.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.88));if(!blob)throw new Error('This picture could not be prepared. Please try another.');if(blob.size>5*1024*1024)throw new Error('This picture is too detailed to save. Choose a smaller copy.');return {id:crypto.randomUUID(),blob,width:canvas.width,height:canvas.height};}finally{source?.close?.();}
}
export function cropSourceRect(width,height,crop={x:.5,y:.5,zoom:1},targetAspect=1){
 const zoom=Math.min(3,Math.max(1,Number(crop.zoom)||1));let w=width,h=height;if(width/height>targetAspect)w=height*targetAspect;else h=width/targetAspect;w/=zoom;h/=zoom;return {x:(width-w)*Math.min(1,Math.max(0,crop.x??.5)),y:(height-h)*Math.min(1,Math.max(0,crop.y??.5)),width:w,height:h};
}
/** Decode once while a crop sheet is open; render is synchronous and reuses its canvas. */
export async function createCropSession(asset) {
  if (!asset?.blob) throw new Error('A picture is missing. Reconnect to sync it, or replace this picture.');
  let source = await loadImage(asset.blob);
  const canvas = document.createElement('canvas');
  let disposed = false;
  return {
    render(crop, width = 900, height = 650) {
      if (disposed) throw new Error('This crop editor is closed. Reopen the picture to continue.');
      const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Picture rendering is unavailable.');
      const rect = cropSourceRect(source.width || source.naturalWidth,
        source.height || source.naturalHeight, crop, w / h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h);
      return canvas;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof source.close === 'function') source.close();
      else if ('src' in source) source.src = '';
      source = null;
      // The returned canvas remains valid for cropPhoto and PDF callers.
    },
  };
}
export async function cropPhoto(asset, crop, width = 900, height = 650) {
  const session = await createCropSession(asset);
  try { return session.render(crop, width, height); }
  finally { session.dispose(); }
}
export async function rasterizeSVG(svg,width=800,height=720){const img=await loadImage(new Blob([svg],{type:'image/svg+xml'}));try{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');if(!ctx)throw new Error('Illustration rendering is unavailable.');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(img,0,0,width,height);return c;}finally{img.close?.();}}
