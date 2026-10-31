import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { createStore } from '../src/storage.js';
import { createRoutine } from '../src/model.js';

class TestChannel {
  static channels = new Set();
  constructor() { this.closed=false; TestChannel.channels.add(this); }
  postMessage(data) { for (const target of TestChannel.channels) if (target !== this) {
    queueMicrotask(()=>{if(!target.closed) target.onmessage?.({data});});
  } }
  close() { this.closed=true; TestChannel.channels.delete(this); }
}
globalThis.BroadcastChannel = TestChannel;
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
  const db = { rows: new Map(), photos: new Map(), failUpload: false, failSave: false, beforeRpc: null };
  db.client = (initialOwner = owner) => {
    let currentOwner = initialOwner;
    const session = () => currentOwner ? { user: { id: currentOwner, email: 'synthetic@example.invalid' } } : null;
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

test('a stale editor survives cache refresh and queues all edits into one conflict copy', async t => {
  const a=await device(t), plan=createRoutine('bedtime'); await a.save(plan);
  let refreshed; const refresh=new Promise(resolve=>{refreshed=resolve;}); const conflicts=[];
  const b=await device(t,{onChange:event=>{if(event.type==='refresh')refreshed();},onConflict:event=>conflicts.push(event)},false);
  const bEdit=b.get(plan.id), bToken=b.beginEdit(plan.id);
  const aEdit=a.get(plan.id); aEdit.steps[0].caption='A caption that must survive';
  await a.save(aEdit,{editSession:a.beginEdit(plan.id)}); await refresh;
  assert.equal(b.get(plan.id).steps[0].caption,aEdit.steps[0].caption);
  bEdit.steps[0].label='B1'; const first=b.save(bEdit,{editSession:bToken});
  bEdit.steps[0].label='B2'; bEdit.steps[1].caption='B2 caption';
  const second=b.save(bEdit,{editSession:bToken});
  const firstCopy=await first, secondCopy=await second;
  assert.equal(firstCopy.id,secondCopy.id); assert.equal(conflicts.length,1);
  assert.deepEqual(conflicts[0].editSessions,[bToken]);
  assert.equal(conflicts[0].editSession,bToken); assert.equal(conflicts[0].source,'local');
  assert.equal(b.get(plan.id).steps[0].caption,'A caption that must survive');
  assert.equal(b.get(plan.id).steps[0].label,plan.steps[0].label);
  assert.equal(b.get(secondCopy.id).steps[0].label,'B2');
  assert.equal(secondCopy.title,firstCopy.title);
  bEdit.title=secondCopy.title;
  bEdit.steps[2].label='B3';
  const third=await b.save(bEdit,{editSession:bToken});
  assert.equal(third.id,secondCopy.id);
  assert.equal(third.steps[0].label,'B2'); assert.equal(third.steps[1].caption,'B2 caption');
  assert.equal(third.steps[2].label,'B3'); assert.equal(b.list().length,2);
  const deliberateRename={...third,title:plan.title};
  assert.equal((await b.save(deliberateRename,{editSession:bToken})).title,plan.title);
});

test('simultaneous tab writes compare and write atomically under the IDB lock', async t => {
  const a=await device(t), plan=createRoutine('home'); await a.save(plan);
  const b=await device(t,{},false), ta=a.beginEdit(plan.id), tb=b.beginEdit(plan.id);
  const pa=a.get(plan.id), pb=b.get(plan.id); pa.title='A';pb.title='B';
  const [sa,sb]=await Promise.all([a.save(pa,{editSession:ta}),b.save(pb,{editSession:tb})]);
  assert.notEqual(sa.id,sb.id);
  const reopened=await device(t,{},false);
  assert.equal(reopened.list().length,2);
  assert.ok(reopened.list().some(s=>s.title==='A'||s.title==='A (conflict copy)'));
  assert.ok(reopened.list().some(s=>s.title==='B'||s.title==='B (conflict copy)'));
});

test('stale deletion keeps the newer tab version and reports false', async t => {
  const a=await device(t), plan=createRoutine('home');await a.save(plan);
  const conflicts=[], b=await device(t,{onConflict:e=>conflicts.push(e)},false);
  const deletion=b.beginEdit(plan.id), changed=a.get(plan.id);changed.title='Newer title';
  await a.save(changed,{editSession:a.beginEdit(plan.id)});
  assert.equal(await b.remove(plan.id,{editSession:deletion}),false);
  assert.equal(b.get(plan.id).title,'Newer title');
  assert.equal(conflicts[0].source,'local-delete'); assert.deepEqual(conflicts[0].editSessions,[]);
});

test('a stale edit after another tab deletes creates a copy without resurrection', async t => {
  const a=await device(t), plan=createRoutine('home');await a.save(plan);
  const b=await device(t,{},false), token=b.beginEdit(plan.id), edit=b.get(plan.id);
  assert.equal(await a.remove(plan.id,{editSession:a.beginEdit(plan.id)}),true);
  edit.title='Unfinished edit'; const copy=await b.save(edit,{editSession:token});
  assert.notEqual(copy.id,plan.id); assert.equal(b.get(plan.id),null);
  assert.equal(b.list().length,1); assert.equal(copy.title,'Unfinished edit (conflict copy)');
});

test('an acknowledged cloud version does not invalidate the editor content revision', async t => {
  const cloud=backend(), store=await device(t,{client:cloud.client()}), plan=createRoutine('home');
  await store.save(plan); const token=store.beginEdit(plan.id);
  await store.sync(); plan.title='After sync';
  const saved=await store.save(plan,{editSession:token});
  assert.equal(saved.id,plan.id); assert.equal(store.list().length,1);
});

test('cloud conflict redirects only matching editor handles and later saves follow the copy', async t => {
  const cloud=backend(), a=await device(t,{client:cloud.client()}), plan=createRoutine('home');
  await a.save(plan);await a.sync();
  const conflicts=[], b=await device(t,{client:cloud.client(),onConflict:e=>conflicts.push(e)});
  await b.sync();
  const staleToken=b.beginEdit(plan.id), activeToken=b.beginEdit(plan.id), edit=b.get(plan.id);
  const remote=a.get(plan.id);remote.title='Device A';await a.save(remote);await a.sync();
  edit.title='Device B';await b.save(edit,{editSession:activeToken});await b.sync();
  const event=conflicts.find(e=>e.source==='cloud');assert.ok(event);
  assert.ok(event.editSessions.includes(activeToken));assert.ok(!event.editSessions.includes(staleToken));
  edit.steps[0].label='Continued B';const saved=await b.save(edit,{editSession:activeToken});
  assert.equal(saved.id,event.copyId);assert.equal(b.get(plan.id).title,'Device A');
  const stale=clone(plan);stale.title='Separate stale editor';
  const independent=await b.save(stale,{editSession:staleToken});
  assert.notEqual(independent.id,event.copyId);assert.notEqual(independent.id,plan.id);
});

