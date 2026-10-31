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

test('local draft and actual photo reopen without an account or network', async t => {
  const first = await device(t);
  const plan = createRoutine('bedtime'), photo = await picture();
  await first.putPhoto(photo);
  plan.steps[0].picture = { kind: 'photo', assetId: photo.id, crop: { x: .2, y: .8, zoom: 2 } };
  await first.save(plan);
  first.destroy();
  const reopened = await device(t, {}, false);
  assert.deepEqual(reopened.get(plan.id), plan);
  assert.deepEqual(await (await reopened.getPhoto(photo.id)).blob.arrayBuffer(), await photo.blob.arrayBuffer());
  assert.equal(reopened.getStatus().message, 'Saved on this device');
});

test('Saved is reported only after account record persistence succeeds', async t => {
  const cloud = backend(), store = await device(t, { client: cloud.client() });
  const plan = createRoutine('morning');
  await store.save(plan);
  assert.equal(cloud.rows.size, 0);
  assert.match(store.getStatus().message, /waiting to sync/);
  cloud.failSave = true;
  await store.sync();
  assert.equal(cloud.rows.size, 0);
  assert.match(store.getStatus().message, /waiting to sync/);
  cloud.failSave = false;
  await store.sync();
  assert.equal(cloud.rows.get(plan.id).document.title, plan.title);
  assert.equal(store.getStatus().message, 'Saved');
});

test('failed photo upload keeps recoverable draft and does not save broken cloud record', async t => {
  const cloud = backend(), store = await device(t, { client: cloud.client() });
  const plan = createRoutine('home'), photo = await picture();
  await store.putPhoto(photo);
  plan.steps[0].picture = { kind: 'photo', assetId: photo.id, crop: { x: .7, y: .1, zoom: 1.8 } };
  await store.save(plan);
  cloud.failUpload = true;
  await store.sync();
  assert.equal(cloud.rows.size, 0);
  assert.deepEqual(store.get(plan.id), plan);
  assert.match(store.getStatus().message, /waiting to sync/);
  cloud.failUpload = false;
  await store.sync();
  assert.equal(cloud.photos.size, 1);
  assert.equal(cloud.rows.size, 1);
});

test('editing while a save is in flight does not mark newer edits saved or lose them', async t => {
  const cloud = backend(), store = await device(t, { client: cloud.client() });
  const plan = createRoutine('bedtime');
  await store.save(plan);
  let release, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  cloud.beforeRpc = async () => { started(); await new Promise(resolve => { release = resolve; }); };
  const saving = store.sync();
  await startedPromise;
  plan.title = 'Our newer bedtime';
  await store.save(plan);
  cloud.beforeRpc = null; release();
  await saving;
  assert.equal(store.get(plan.id).title, 'Our newer bedtime');
  assert.notEqual(cloud.rows.get(plan.id).document.title, 'Our newer bedtime');
  assert.match(store.getStatus().message, /waiting to sync/);
  await store.sync();
  assert.equal(cloud.rows.get(plan.id).document.title, 'Our newer bedtime');
  assert.equal(store.getStatus().message, 'Saved');
});

test('two devices preserve both versions after conflicting edits', async t => {
  const cloud = backend();
  const a = await device(t, { client: cloud.client() });
  const plan = createRoutine('bedtime');
  await a.save(plan); await a.sync();
  const conflicts = [];
  const b = await device(t, { client: cloud.client(), onConflict: event => conflicts.push(event) });
  await b.sync();
  assert.deepEqual(b.get(plan.id), plan);
  const remoteEdit = a.get(plan.id), localEdit = b.get(plan.id);
  remoteEdit.title = 'Device A';
  localEdit.title = 'Device B';
  localEdit.steps.reverse();
  await a.save(remoteEdit); await a.sync();
  await b.save(localEdit); await b.sync();
  assert.equal(b.get(plan.id).title, 'Device A');
  assert.equal(cloud.rows.get(plan.id).document.title, 'Device A');
  assert.equal(conflicts.length, 1);
  const preserved = b.get(conflicts[0].copyId);
  assert.match(preserved.title, /Device B.*conflict copy/);
  assert.deepEqual(preserved.steps.map(s => s.label), localEdit.steps.map(s => s.label));
  await b.sync();
  assert.equal(cloud.rows.size, 2);
});

test('deletion on another device preserves unsynced edits as a conflict copy', async t => {
  const cloud = backend(), a = await device(t, { client: cloud.client() });
  const plan = createRoutine('home');
  await a.save(plan); await a.sync();
  const b = await device(t, { client: cloud.client() });
  await b.sync();
  const edit = b.get(plan.id); edit.title = 'Unsynced edits';
  await a.remove(plan.id); await a.sync();
  await b.save(edit); await b.sync();
  assert.equal(b.get(plan.id), null);
  assert.ok(b.list().some(s => s.title === 'Unsynced edits (conflict copy)'));
  assert.equal(cloud.rows.get(plan.id).deleted, true);
});

test('portable backup restores real JPEG bytes and crops using independent identifiers', async t => {
  const store = await device(t);
  const plan = createRoutine('bedtime'), photo = await picture();
  await store.putPhoto(photo);
  plan.steps[0].picture = { kind: 'photo', assetId: photo.id, crop: { x: .15, y: .85, zoom: 2.6 } };
  plan.reward = { label: 'Story together', caption: 'When we finish our plan', picture: clone(plan.steps[0].picture) };
  await store.save(plan);
  const backup = await store.exportBackup(plan), restored = await store.importBackup(backup);
  assert.notEqual(restored.id, plan.id);
  assert.notEqual(restored.steps[0].picture.assetId, photo.id);
  assert.deepEqual(restored.steps[0].picture.crop, plan.steps[0].picture.crop);
  assert.deepEqual(restored.reward.picture.crop, plan.reward.picture.crop);
  assert.equal(restored.reward.picture.assetId, restored.steps[0].picture.assetId);
  assert.deepEqual(await (await store.getPhoto(restored.steps[0].picture.assetId)).blob.arrayBuffer(), await photo.blob.arrayBuffer());
  restored.steps[0].picture.crop.x = 1;
  await store.save(restored);
  assert.equal(store.get(plan.id).steps[0].picture.crop.x, .15);
});

test('invalid backup is rejected without changing existing schedules', async t => {
  const store = await device(t), plan = createRoutine('morning');
  await store.save(plan);
  const invalid = { format: 'kapework-myplan', version: 1, schedule: clone(plan), photos: [] };
  invalid.schedule.steps[0].picture = { kind: 'photo', assetId: crypto.randomUUID(), crop: { x: .5, y: .5, zoom: 1 } };
  await assert.rejects(() => store.importBackup(new Blob([JSON.stringify(invalid)])), /missing or extra/);
  assert.deepEqual(store.list(), [plan]);
});

test('sign-out hides account drafts and another account does not inherit them', async t => {
  const cloud = backend(), store = await device(t, { client: cloud.client() });
  const plan = createRoutine('bedtime');
  await store.save(plan);
  await store.signOut();
  assert.equal(store.get(plan.id), null);
  await store.signIn('other@example.invalid', 'synthetic');
  assert.equal(store.get(plan.id), null);
  await store.signOut();
  await store.signIn('owner@example.invalid', 'synthetic');
  assert.equal(store.get(plan.id).title, plan.title);
  await tick();
});
