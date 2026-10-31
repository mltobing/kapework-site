import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { createStore } from '../src/storage.js';
import { createRoutine } from '../src/model.js';

globalThis.BroadcastChannel = undefined;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(bytes => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload?.();
    }, () => this.onerror?.());
  }
};

const owner = '00000000-0000-4000-8000-000000000001';
const otherOwner = '00000000-0000-4000-8000-000000000002';
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function backend() {
  const db = { rows: new Map(), photos: new Map(), failUpload: false, failSave: false, beforeRpc: null, beforeUpload: null };
  db.client = (initialOwner = owner) => {
    let currentOwner = initialOwner;
    const session = () => currentOwner ? { access_token: currentOwner, user: { id: currentOwner, email: 'synthetic@example.invalid' } } : null;
    return {
      auth: {
        getSession: async () => ({ data: { session: session() }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithPassword: async ({ email }) => {
          currentOwner = email === 'other@example.invalid' ? otherOwner : owner;
          return { data: { session: session() }, error: null };
        },
        signOut: async () => { currentOwner = null; return { error: null }; },
      },
      from: table => {
        assert.equal(table, 'myplan_schedules');
        return { select: () => ({ eq: async (_key, id) => ({ data: [...db.rows.values()].filter(row => row.owner_id === id).map(clone), error: null }) }) };
      },
      storage: { from: bucket => {
        assert.equal(bucket, 'myplan-photos');
        return {
          upload: async (path, blob) => {
            if (db.beforeUpload) await db.beforeUpload();
            if (db.failUpload) return { error: { status: 503 } };
            if (db.photos.has(path)) return { error: { statusCode: '409' } };
            db.photos.set(path, blob); return { error: null };
          },
          download: async path => ({ data: db.photos.get(path), error: db.photos.has(path) ? null : { status: 404 } }),
        };
      } },
      rpc: async (name, args) => {
        assert.equal(name, 'myplan_save_schedule');
        if (db.beforeRpc) await db.beforeRpc(args);
        if (db.failSave) return { data: null, error: { status: 503 } };
        const previous = db.rows.get(args.p_id);
        if (previous && (previous.owner_id !== currentOwner || previous.version !== args.p_base_version)) {
          return { data: { status: 'conflict', row: previous.owner_id === currentOwner ? clone(previous) : null }, error: null };
        }
        const row = { id: args.p_id, document: clone(args.p_document), owner_id: currentOwner,
          version: (previous?.version || 0) + 1, deleted: args.p_deleted, updated_at: new Date().toISOString() };
        db.rows.set(row.id, row);
        return { data: { status: 'saved', row: clone(row) }, error: null };
      },
    };
  };
  return db;
}

async function device(t, options = {}, fresh = true) {
  if (fresh) globalThis.indexedDB = new IDBFactory();
  const store = createStore(options);
  await store.init();
  t.after(() => store.destroy());
  return store;
}

async function picture() {
  return { id: crypto.randomUUID(), blob: new Blob([await readFile(new URL('./photo-fixture.jpg', import.meta.url))], { type: 'image/jpeg' }), width: 4, height: 3 };
}


function gate() { let release,started; const reached=new Promise(r=>{started=r}); const wait=new Promise(r=>{release=r}); return {release,reached,hold:async()=>{started();await wait}}; }
function pinnedFactory(cloud) { return (_url,_key,options) => {
  const bound=options.accessToken().then(token=>cloud.client(token));
  return {rpc:async(...args)=>(await bound).rpc(...args),
    from:table=>({select:columns=>({eq:async(...args)=>(await bound).from(table).select(columns).eq(...args)})}),
    storage:{from:bucket=>({upload:async(...args)=>(await bound).storage.from(bucket).upload(...args),
      download:async(...args)=>(await bound).storage.from(bucket).download(...args)})}};
}; }

test('RPC keeps captured account token even before the auth change event arrives', async t => {
  const cloud=backend(), authClient=cloud.client();
  const store=await device(t,{client:authClient,dataClientFactory:pinnedFactory(cloud)});
  const plan=createRoutine('bedtime'); await store.save(plan);
  cloud.beforeRpc=async()=>{
    cloud.beforeRpc=null;
    // Supabase has changed its internal session, while the app callback has not run.
    await authClient.auth.signInWithPassword({email:'other@example.invalid'});
  };
  await store.sync();
  assert.equal(cloud.rows.get(plan.id).owner_id,owner);
  assert.notEqual(cloud.rows.get(plan.id).owner_id,otherOwner);
});

test('changing account during photo upload prevents the old schedule RPC', async t => {
  const cloud=backend(), upload=gate(); let changed;
  const accountChanged=new Promise(resolve=>{changed=resolve;});
  const store=await device(t,{client:cloud.client(),dataClientFactory:pinnedFactory(cloud),
    onAuth:s=>{if(s?.user.id===otherOwner)changed();}});
  const plan=createRoutine('bedtime'), photo=await picture();
  await store.putPhoto(photo);
  plan.steps[0].picture={kind:'photo',assetId:photo.id,crop:{x:.5,y:.5,zoom:1}};
  await store.save(plan); cloud.beforeUpload=upload.hold;
  const saving=store.sync(); await upload.reached;
  const switching=store.signIn('other@example.invalid','synthetic');
  await accountChanged; upload.release(); await saving; await switching;
  assert.equal(cloud.rows.size,0);
  assert.equal(store.get(plan.id),null);
});

test('photo validation cannot carry an old account photo into a new local scope', async t => {
  const cloud=backend(), store=await device(t,{client:cloud.client()});
  const asset=await picture(), validation=gate();
  class PausedBlob extends Blob {
    slice(...args) { const part=super.slice(...args), read=part.arrayBuffer.bind(part);
      part.arrayBuffer=async()=>{await validation.hold();return read();}; return part; }
  }
  asset.blob=new PausedBlob([asset.blob],{type:'image/jpeg'});
  const saving=store.putPhoto(asset); const rejected=assert.rejects(saving,/account changed/i);
  await validation.reached; await store.signOut();
  await store.signIn('other@example.invalid','synthetic'); validation.release(); await rejected;
  await assert.rejects(()=>store.getPhoto(asset.id),/not available offline/);
});

test('a backup import stops if the account changes while the file is read', async t => {
  const cloud=backend(), store=await device(t,{client:cloud.client()});
  const backup=await store.exportBackup(createRoutine('home')), reading=gate();
  const file={size:backup.size,text:async()=>{await reading.hold();return backup.text();}};
  const importing=store.importBackup(file); const rejected=assert.rejects(importing,/account changed/i);
  await reading.reached; await store.signOut();
  await store.signIn('other@example.invalid','synthetic'); reading.release(); await rejected;
  assert.equal(store.list().length,0);
});

test('a private backup result is withheld after an account change', async t => {
  const cloud=backend(), store=await device(t,{client:cloud.client()}), photo=await picture();
  const plan=createRoutine('home'); await store.putPhoto(photo);
  plan.steps[0].picture={kind:'photo',assetId:photo.id,crop:{x:.5,y:.5,zoom:1}};
  await store.save(plan);
  const OriginalReader=globalThis.FileReader, reading=gate();
  globalThis.FileReader=class extends OriginalReader {
    readAsDataURL(blob) { reading.hold().then(()=>super.readAsDataURL(blob)); }
  };
  t.after(()=>{globalThis.FileReader=OriginalReader;});
  const exporting=store.exportBackup(plan); const rejected=assert.rejects(exporting,/account changed/i);
  await reading.reached; await store.signOut();
  await store.signIn('other@example.invalid','synthetic'); reading.release(); await rejected;
});

test('claiming guest drafts stops when the destination account changes', async t => {
  const cloud=backend(), store=await device(t,{client:cloud.client(null)});
  const plan=createRoutine('home'); await store.save(plan);
  await store.signIn('owner@example.invalid','synthetic');
  const claiming=store.claimGuestDrafts(); const rejected=assert.rejects(claiming,/account changed/i);
  await store.signOut(); await rejected;
  await store.signIn('other@example.invalid','synthetic');
  assert.equal(store.list().length,0);
});
