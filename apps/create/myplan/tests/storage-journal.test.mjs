import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createStore } from '../src/storage.js';
import { createRoutine } from '../src/model.js';

globalThis.BroadcastChannel = undefined;
const prefix = 'kapework-myplan-pending-v1:';
function createLocalStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i],
    getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) };
}
async function setup(t, fresh = true, options = {}) {
  if (fresh) { globalThis.indexedDB = new IDBFactory(); globalThis.localStorage = createLocalStorage(); }
  const store = createStore(options); await store.init(); t.after(() => store.destroy()); return store;
}
async function editStoredRow(id, edit) {
  const db = await new Promise((resolve,reject) => {
    const request = indexedDB.open('kapework-myplan-v1',1);
    request.onsuccess = () => resolve(request.result); request.onerror = reject;
  });
  await new Promise((resolve,reject) => {
    const tx = db.transaction('schedules','readwrite'), store = tx.objectStore('schedules');
    const request = store.get(`guest:${id}`);
    request.onsuccess = () => store.put(edit(request.result));
    tx.oncomplete = resolve; tx.onerror = reject;
  });
  db.close();
}

test('latest text is synchronously journaled and recovers when IDB is interrupted', async t => {
  const first = await setup(t), plan = createRoutine('bedtime');
  await first.save(plan);
  plan.title = 'Last words before opening the camera';
  const saving = first.save(plan);
  assert.equal(localStorage.length,1);
  const journal = JSON.parse(localStorage.getItem(localStorage.key(0)));
  assert.equal(journal.schedule.title,plan.title);
  assert.equal(journal.baseLocalSeq,1);
  assert.equal(journal.owner,'guest');
  assert.equal('photos' in journal,false);
  first.destroy();
  await assert.rejects(saving);
  const reopened = await setup(t,false);
  assert.equal(reopened.get(plan.id).title,plan.title);
  assert.equal(localStorage.length,0);
});

test('an older commit cannot clear the latest journal or announce Saved', async t => {
  const store = await setup(t), plan = createRoutine('morning');
  const first = store.save(plan);
  plan.title = 'Second queued edit';
  const second = store.save(plan);
  const newest = JSON.parse(localStorage.getItem(localStorage.key(0)));
  await first;
  assert.equal(JSON.parse(localStorage.getItem(localStorage.key(0))).requestId,newest.requestId);
  assert.equal(store.getStatus().state,'saving');
  await second;
  assert.equal(localStorage.length,0);
  assert.equal(store.getStatus().message,'Saved on this device');
  assert.equal(store.get(plan.id).title,plan.title);
});

test('journal recovery preserves a newer committed version and is idempotent', async t => {
  const first = await setup(t), plan = createRoutine('home');
  await first.save(plan);
  plan.title = 'Interrupted edit';
  const saving = first.save(plan);
  const journalKey = localStorage.key(0), raw = localStorage.getItem(journalKey);
  first.destroy(); await assert.rejects(saving);
  await editStoredRow(plan.id,row => ({...row,localSeq:row.localSeq+1,contentRevision:crypto.randomUUID(),
    schedule:{...row.schedule,title:'Newer committed edit'},journal:{tab:'another-tab',sequence:1}}));
  const conflicts = [];
  const recovered = await setup(t,false,{onConflict:event=>conflicts.push(event)});
  assert.equal(recovered.get(plan.id).title,'Newer committed edit');
  assert.equal(conflicts.length,1);
  assert.equal(recovered.get(conflicts[0].copyId).title,'Interrupted edit (recovered copy)');
  assert.equal(recovered.list().length,2);
  // Simulate interruption immediately after IDB commit but before journal cleanup.
  localStorage.setItem(journalKey,raw); recovered.destroy();
  const again = await setup(t,false);
  assert.equal(again.list().length,2);
  assert.equal(localStorage.length,0);
});

test('journals from another account remain private and are not claimed by a guest', async t => {
  const first = await setup(t), plan = createRoutine('bedtime');
  const owner = crypto.randomUUID(), tab = crypto.randomUUID();
  const journalKey = `${prefix}${owner}:${plan.id}:${tab}`;
  localStorage.setItem(journalKey,JSON.stringify({format:1,owner,tab,sequence:1,
    requestId:crypto.randomUUID(),baseVersion:0,baseLocalSeq:0,writtenAt:new Date().toISOString(),schedule:plan}));
  first.destroy();
  const guest = await setup(t,false);
  assert.equal(guest.list().length,0);
  assert.ok(localStorage.getItem(journalKey));
});

test('duplicate waits for the latest queued edit before copying', async t => {
  const store = await setup(t), plan = createRoutine('bedtime');
  await store.save(plan);
  plan.title = 'Latest title';
  const saving = store.save(plan);
  const copy = await store.duplicate(plan.id);
  await saving;
  assert.equal(copy.title,'Latest title (copy)');
  assert.notEqual(copy.id,plan.id);
});
