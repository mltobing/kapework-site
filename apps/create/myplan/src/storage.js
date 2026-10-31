/** Private, offline-first My Plan storage. No content or service errors are logged. */
import { validateSchedule, duplicateSchedule } from './model.js';

const DB_NAME = 'kapework-myplan-v1';
const BUCKET = 'myplan-photos';
const clone = value => structuredClone(value);
const assetIds = schedule => [...new Set([...schedule.steps, schedule.reward].filter(Boolean)
  .map(step => step.picture).filter(p => p?.kind === 'photo').map(p => p.assetId))];
const uuid = () => crypto.randomUUID();
const key = (scope, id) => `${scope}:${id}`;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_BYTES = 80 * 1024 * 1024;
const JOURNAL_PREFIX = 'kapework-myplan-pending-v1:';

async function boundedFetch(input, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20000);
  try { return await fetch(input, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('schedules', { keyPath: 'key' }).createIndex('scope', 'scope');
      db.createObjectStore('photos', { keyPath: 'key' }).createIndex('scope', 'scope');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Device storage is unavailable. Export a backup before leaving.'));
    request.onblocked = () => reject(new Error('Close other My Plan tabs, then reload to enable saving.'));
  });
}

function transact(db, store, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let request;
    try { request = action(tx.objectStore(store)); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(new Error('Device storage is full or unavailable. Export a backup before leaving.'));
  });
}

async function checkPhoto(asset) {
  if (!asset || !/^[0-9a-f-]{36}$/i.test(asset.id) || !(asset.blob instanceof Blob)
    || asset.blob.type !== 'image/jpeg' || !asset.blob.size || asset.blob.size > MAX_PHOTO_BYTES
    || !Number.isInteger(asset.width) || !Number.isInteger(asset.height)
    || asset.width < 1 || asset.height < 1 || asset.width > 4096 || asset.height > 4096) {
    throw new Error('This picture could not be saved. Choose a smaller JPEG photo.');
  }
  const signature = new Uint8Array(await asset.blob.slice(0, 3).arrayBuffer());
  if (signature[0] !== 255 || signature[1] !== 216 || signature[2] !== 255) throw new Error('The picture is not a valid JPEG.');
  const size = await imageDimensions(asset.blob);
  if (size.width !== asset.width || size.height !== asset.height) throw new Error('The picture dimensions do not match.');
  return asset;
}

async function imageDimensions(blob) {
  // Inspect JPEG SOF before decoding, including for untrusted backups. This
  // rejects decompression bombs without allocating a huge image/canvas.
  if (blob.size > MAX_PHOTO_BYTES) throw new Error('This picture is too large.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width > 0 && height > 0 && width <= 4096 && height <= 4096) return { width, height };
      break;
    }
    offset += length;
  }
  throw new Error('This picture could not be opened. Choose a JPEG photo up to 4096 pixels across.');
}

function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('The backup could not read a picture. Try again.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Callbacks contain app state only, never credentials. onChange is
 * {type:'saved'|'refresh'|'removed'|'auth'|'conflict',id?,schedule?}.
 * Save resolves after IndexedDB commits; cloud completion is reported separately.
 */
export function createStore({ onChange = () => {}, onStatus = () => {}, onConflict = () => {},
  onAuth = () => {}, client: suppliedClient, dataClientFactory } = {}) {
  let db, client = suppliedClient, session = null, scope = 'guest';
  let accountEpoch = 0, makeDataClient = dataClientFactory;
  let cache = new Map(), writes = Promise.resolve(), syncing = null, syncTimer;
  let authSubscription, channel, destroyed = false, initialized = false, localError = false;
  let latestStatus = { state: 'local', message: 'Saved on this device' };
  let pendingLocalWrites = 0;
  const journalTab = uuid();
  let journalSequence = 0;
  const config = globalThis.KapeworkConfig || {};
  const configured = Boolean(suppliedClient || (config.supabaseUrl && config.supabaseAnonKey));

  const status = (state, message) => { latestStatus = { state, message }; onStatus(latestStatus); };
  const reportLocal = () => {
    if (localError) return;
    if (pendingLocalWrites) status('saving', 'Saving…');
    else if (!session) status('local', 'Saved on this device');
    else if ([...cache.values()].some(row => row.dirty)) status('local', 'Saved on this device—waiting to sync');
    else status('saved', 'Saved');
  };
  const read = (store, id, owner = scope) => transact(db, store, 'readonly', s => s.get(key(owner, id)));
  const readScope = (store, owner = scope) => transact(db, store, 'readonly', s => s.index('scope').getAll(owner));
  const write = (store, row) => transact(db, store, 'readwrite', s => s.put(row));
  const enqueue = action => {
    const next = writes.then(action);
    writes = next.catch(() => {});
    return next;
  };
  const emit = event => { onChange(event); channel?.postMessage({ scope, type: 'changed' }); };
  const scheduleSync = () => {
    clearTimeout(syncTimer);
    if (session && client && !destroyed) syncTimer = setTimeout(() => { sync().catch(() => {}); }, 700);
  };
  const requireAuth = owner => {
    if (!session || session.user.id !== owner) throw new Error('Sign in again to sync. Your edits are saved on this device.');
  };
  const captureContext = () => ({ owner: scope, epoch: accountEpoch });
  const requireContext = context => {
    if (scope !== context.owner || accountEpoch !== context.epoch
      || (session?.user?.id || 'guest') !== context.owner) {
      throw new Error('The account changed. Reopen the schedule in its original account and try again.');
    }
  };
  function dataClient(context) {
    requireContext(context); requireAuth(context.owner);
    if (!makeDataClient) return client; // Injected test/service adapter.
    const token = session.access_token;
    if (!token) throw new Error('Sign in again to sync. Your edits are saved on this device.');
    // Each operation keeps its original credential even if Supabase Auth changes
    // accounts while a fetch is queued. No session, refresh timer, or token is
    // persisted by this data-only client; the next operation captures a new token.
    return makeDataClient(config.supabaseUrl, config.supabaseAnonKey, {
      accessToken: async () => token, global: { fetch: boundedFetch },
    });
  }

  function journalEdit(schedule, owner) {
    const old = cache.get(schedule.id);
    const pending = { format: 1, owner, schedule, tab: journalTab,
      sequence: ++journalSequence, requestId: uuid(),
      baseVersion: old?.version || 0, baseLocalSeq: old?.localSeq || 0,
      writtenAt: new Date().toISOString() };
    const journalKey = `${JOURNAL_PREFIX}${owner}:${schedule.id}:${journalTab}`;
    try {
      // Synchronous and text-only: survives a camera handoff before IDB commits.
      globalThis.localStorage.setItem(journalKey, JSON.stringify(pending));
      return { journalKey, pending };
    } catch {
      // IDB may still work when localStorage is unavailable/full. Do not claim
      // durable success until its transaction completes.
      status('saving', 'Saving… keep this page open until saved');
      return null;
    }
  }

  function clearJournal(entry) {
    if (!entry) return;
    try {
      const current = JSON.parse(globalThis.localStorage.getItem(entry.journalKey));
      if (current?.requestId === entry.pending.requestId) globalThis.localStorage.removeItem(entry.journalKey);
    } catch { /* A committed IDB row remains authoritative if cleanup fails. */ }
  }

  async function recoverJournals(owner) {
    const entries = [];
    try {
      const storage = globalThis.localStorage;
      for (let i = 0; i < storage.length; i++) {
        const journalKey = storage.key(i);
        if (!journalKey?.startsWith(`${JOURNAL_PREFIX}${owner}:`)) continue;
        try {
          const pending = JSON.parse(storage.getItem(journalKey));
          if (pending?.format !== 1 || pending.owner !== owner || typeof pending.tab !== 'string'
            || !Number.isSafeInteger(pending.sequence) || !Number.isSafeInteger(pending.baseVersion)
            || !Number.isSafeInteger(pending.baseLocalSeq)
            || pending.sequence < 1 || pending.baseVersion < 0 || pending.baseLocalSeq < 0
            || typeof pending.writtenAt !== 'string' || !Number.isFinite(Date.parse(pending.writtenAt))
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.requestId)) continue;
          pending.schedule = validateSchedule(pending.schedule);
          entries.push({ journalKey, pending });
        } catch { /* Ignore malformed journals, never execute their content. */ }
      }
    } catch { return; }
    entries.sort((a, b) => a.pending.writtenAt.localeCompare(b.pending.writtenAt));
    for (const entry of entries) {
      const { pending } = entry;
      const result = await new Promise((resolve, reject) => {
        const tx = db.transaction('schedules', 'readwrite');
        const store = tx.objectStore('schedules');
        const existing = store.get(key(owner, pending.schedule.id));
        let outcome = null;
        existing.onsuccess = () => {
          const old = existing.result;
          const ownWrite = old?.journal?.tab === pending.tab;
          if ((!old?.deleted && old && JSON.stringify(old.schedule) === JSON.stringify(pending.schedule))
            || (ownWrite && old.journal.sequence >= pending.sequence)) return;
          const matchesBase = !old?.deleted && (old?.version || 0) === pending.baseVersion
            && (old?.localSeq || 0) === pending.baseLocalSeq;
          if (matchesBase || (ownWrite && !old.deleted && old.journal.sequence < pending.sequence)) {
            const schedule = pending.schedule;
            const row = { key: key(owner, schedule.id), scope: owner, id: schedule.id,
              schedule, version: old?.version || 0, dirty: true, deleted: false,
              localSeq: (old?.localSeq || 0) + 1, updatedAt: pending.writtenAt,
              journal: { tab: pending.tab, sequence: pending.sequence } };
            store.put(row); outcome = { type: 'recovered', row };
          } else {
            // Another tab/device committed a different version. Keep it, and
            // recover the interrupted edit under a deterministic separate ID.
            const lookup = store.get(key(owner, pending.requestId));
            lookup.onsuccess = () => {
              if (lookup.result) return;
              const schedule = duplicateSchedule(pending.schedule);
              schedule.id = pending.requestId;
              schedule.title = `${pending.schedule.title.slice(0, 63)} (recovered copy)`;
              const row = { key: key(owner, schedule.id), scope: owner, id: schedule.id,
                schedule, version: 0, dirty: true, deleted: false, localSeq: 1,
                updatedAt: pending.writtenAt, journal: { tab: pending.tab, sequence: pending.sequence } };
              store.put(row); outcome = { type: 'conflict', row };
            };
          }
        };
        tx.oncomplete = () => resolve(outcome);
        tx.onerror = tx.onabort = () => reject(new Error('Interrupted edits could not be restored. Keep this browser’s data and try again.'));
      });
      clearJournal(entry);
      if (result?.type === 'conflict' && scope === owner && (session?.user?.id || 'guest') === owner) onConflict({ originalId: pending.schedule.id,
        copyId: result.row.id, schedule: clone(result.row.schedule),
        message: 'Recovered an interrupted edit. A newer version was also found, so both schedules are kept.' });
    }
  }

  async function loadScope() {
    const owner = scope;
    const records = await readScope('schedules', owner);
    if (owner === scope) cache = new Map(records.map(row => [row.id, row]));
  }

  async function setSession(next) {
    const nextScope = next?.user?.id || 'guest';
    if ((session?.user?.id || 'guest') !== nextScope) accountEpoch++;
    const epoch = accountEpoch;
    session = next;
    if (scope !== nextScope) {
      await writes;
      if (epoch !== accountEpoch) return;
      scope = nextScope;
      await recoverJournals(scope);
      if (epoch !== accountEpoch) return;
      await loadScope();
      if (epoch !== accountEpoch) return;
      onChange({ type: 'auth' });
    }
    onAuth(next ? { user: { id: next.user.id, email: next.user.email } } : null);
    reportLocal();
    scheduleSync();
  }

  async function init() {
    db = await openDatabase();
    db.onversionchange = () => db.close();
    await recoverJournals(scope);
    await loadScope();
    if (configured) {
      try {
        if (!client) {
          const { createClient } = await import('../vendor/supabase.js');
          makeDataClient = createClient;
          client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: { storageKey: 'kapework-myplan-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
            global: { fetch: boundedFetch },
          });
        }
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        await setSession(data.session);
        const result = client.auth.onAuthStateChange((_event, next) => {
          // Supabase auth callbacks must not await further auth requests.
          setTimeout(() => { setSession(next).catch(() => status('error', 'Could not open this account’s drafts. Reload to try again.')); }, 0);
        });
        authSubscription = result.data.subscription;
      } catch {
        status('local', 'Saved on this device—account saving is unavailable');
      } finally {
        if (typeof location !== 'undefined' && /access_token|refresh_token|error_code|[?&]code=/.test(location.hash + location.search)) {
          history.replaceState(null, '', location.pathname);
        }
      }
    }
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(DB_NAME);
      channel.onmessage = async event => {
        if (event.data?.scope !== scope) return;
        await writes;
        await loadScope();
        onChange({ type: 'refresh' });
        reportLocal();
      };
    }
    globalThis.addEventListener?.('online', scheduleSync);
    globalThis.addEventListener?.('focus', scheduleSync);
    initialized = true;
    if (!configured || !session) reportLocal();
    return api;
  }

  function list() {
    return [...cache.values()].filter(row => !row.deleted)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(row => clone(row.schedule));
  }

  function get(id) {
    const row = cache.get(id);
    return row && !row.deleted ? clone(row.schedule) : null;
  }

  async function save(value) {
    if (!initialized) throw new Error('Saving is not ready yet. Please try again.');
    requireContext(captureContext());
    const schedule = validateSchedule(value);
    const owner = scope;
    pendingLocalWrites++;
    status('saving', 'Saving…');
    const entry = journalEdit(schedule, owner);
    return enqueue(async () => {
      try {
        const old = await read('schedules', schedule.id, owner);
        const row = { key: key(owner, schedule.id), scope: owner, id: schedule.id,
          schedule, version: old?.version || 0, dirty: true, deleted: false,
          localSeq: (old?.localSeq || 0) + 1, updatedAt: new Date().toISOString(),
          journal: entry ? { tab: entry.pending.tab, sequence: entry.pending.sequence } : undefined };
        await write('schedules', row);
        clearJournal(entry);
        localError = false;
        if (scope === owner) { cache.set(row.id, row); emit({ type: 'saved', id: row.id }); }
        scheduleSync();
        return clone(schedule);
      } catch (error) {
        localError = true;
        status('error', 'Not saved: device storage is unavailable. Export a backup before leaving.');
        throw error;
      } finally {
        pendingLocalWrites--;
        if (scope === owner) reportLocal();
      }
    });
  }

  async function remove(id) {
    requireContext(captureContext());
    const owner = scope;
    pendingLocalWrites++;
    status('saving', 'Saving…');
    return enqueue(async () => {
      try {
        const old = await read('schedules', id, owner);
        if (!old) return;
        // Retain a versioned tombstone, not the deleted routine's private text.
        const cleared = { id, title: '', steps: [], reward: null, print: old.schedule.print };
        const row = { ...old, schedule: cleared, dirty: true, deleted: true, localSeq: old.localSeq + 1, updatedAt: new Date().toISOString() };
        await write('schedules', row);
        if (scope === owner) { cache.set(id, row); emit({ type: 'removed', id }); }
        scheduleSync();
      } catch (error) {
        localError = true;
        status('error', 'The schedule could not be deleted. Try again.');
        throw error;
      } finally {
        pendingLocalWrites--;
        if (scope === owner) reportLocal();
      }
    });
  }

  async function duplicate(id) {
    const context = captureContext(); requireContext(context);
    await writes;
    requireContext(context);
    const original = get(id);
    if (!original) throw new Error('This schedule is no longer available.');
    const copy = await save(duplicateSchedule(original));
    requireContext(context);
    return copy;
  }

  async function putPhoto(asset) {
    const context = captureContext(); requireContext(context);
    const owner = context.owner;
    await checkPhoto(asset);
    requireContext(context);
    await enqueue(() => {
      requireContext(context);
      return write('photos', { ...asset, key: key(owner, asset.id), scope: owner, uploaded: false });
    });
    requireContext(context);
    return { id: asset.id, blob: asset.blob, width: asset.width, height: asset.height };
  }

  async function getPhoto(id) {
    const context = captureContext(); requireContext(context);
    const owner = context.owner;
    const cached = await read('photos', id, owner);
    requireContext(context);
    if (cached) return { id: cached.id, blob: cached.blob, width: cached.width, height: cached.height };
    requireAuth(owner);
    const transport = dataClient(context);
    const { data, error } = await transport.storage.from(BUCKET).download(`${owner}/assets/${id}.jpg`);
    requireContext(context);
    if (error || !data) throw new Error('This picture is not available offline yet. Reconnect and try again.');
    const dimensions = await imageDimensions(data);
    const asset = await checkPhoto({ id, blob: data, ...dimensions });
    requireContext(context);
    await enqueue(() => {
      requireContext(context);
      return write('photos', { ...asset, key: key(owner, id), scope: owner, uploaded: true });
    });
    requireContext(context);
    return asset;
  }

  async function uploadPictures(schedule, context, transport) {
    const owner = context.owner;
    for (const id of assetIds(schedule)) {
      requireContext(context);
      const asset = await read('photos', id, owner);
      requireContext(context);
      if (!asset) {
        // A schedule loaded from the server already refers to an uploaded photo.
        const { error } = await transport.storage.from(BUCKET).download(`${owner}/assets/${id}.jpg`);
        requireContext(context);
        if (error) throw new Error('A picture is missing. Keep this device open and try syncing again.');
        continue;
      }
      if (asset.uploaded) continue;
      const path = `${owner}/assets/${id}.jpg`;
      const { error } = await transport.storage.from(BUCKET).upload(path, asset.blob, { contentType: 'image/jpeg', upsert: false });
      requireContext(context);
      // Immutable IDs make a repeated successful upload safe after an interruption.
      if (error && String(error.statusCode || error.status) !== '409' && error.error !== 'Duplicate') throw error;
      await write('photos', { ...asset, uploaded: true });
    }
  }

  function remoteRecord(remote, owner) {
    return { key: key(owner, remote.id), scope: owner, id: remote.id,
      schedule: validateSchedule(remote.document), version: remote.version,
      dirty: false, deleted: remote.deleted, localSeq: 0, updatedAt: remote.updated_at };
  }

  async function preserveConflict(local, remote, owner) {
    // Read the newest local version: edits may have continued during the request.
    return enqueue(async () => {
      const latest = await read('schedules', local.id, owner) || local;
      let copy = null;
      if (!latest.deleted) {
        const schedule = duplicateSchedule(latest.schedule);
        schedule.title = `${latest.schedule.title.slice(0, 62)} (conflict copy)`;
        copy = { ...latest, key: key(owner, schedule.id), id: schedule.id, schedule,
          version: 0, dirty: true, localSeq: 1, updatedAt: new Date().toISOString() };
      }
      // Commit both records atomically so a tab interruption cannot lose either version.
      await new Promise((resolve, reject) => {
        const tx = db.transaction('schedules', 'readwrite');
        const store = tx.objectStore('schedules');
        if (copy) store.put(copy);
        if (remote) store.put(remoteRecord(remote, owner));
        else store.delete(key(owner, local.id));
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(new Error('Could not preserve both versions on this device.'));
      });
      if (scope === owner) {
        if (remote) cache.set(remote.id, remoteRecord(remote, owner)); else cache.delete(local.id);
        if (copy) cache.set(copy.id, copy);
        const event = { originalId: local.id, copyId: copy?.id || null, schedule: copy ? clone(copy.schedule) : null,
          message: copy ? 'Another device changed this schedule. Both versions are kept; your edits are in the conflict copy.'
            : 'Another device changed this schedule. It has been kept instead of deleted.' };
        onConflict(event);
        emit({ type: 'conflict', id: local.id, schedule: event.schedule });
      }
    });
  }

  async function synchronize(context) {
    const owner = context.owner;
    await writes;
    requireContext(context);
    const transport = dataClient(context);
    const pending = (await readScope('schedules', owner)).filter(row => row.dirty);
    requireContext(context);
    if (pending.length) status('saving', 'Saving…');
    for (const local of pending) {
      requireContext(context);
      if (!local.deleted) await uploadPictures(local.schedule, context, transport);
      requireContext(context);
      const { data, error } = await transport.rpc('myplan_save_schedule', {
        p_id: local.id, p_base_version: local.version, p_document: local.schedule, p_deleted: local.deleted,
      });
      requireContext(context);
      if (error || !data) throw error || new Error('Sync unavailable');
      if (data.status === 'conflict') { await preserveConflict(local, data.row, owner); continue; }
      if (data.status !== 'saved' || !data.row) throw new Error('Unexpected save response');
      await enqueue(async () => {
        const latest = await read('schedules', local.id, owner);
        if (!latest) return;
        const row = { ...latest, version: data.row.version,
          dirty: latest.localSeq !== local.localSeq,
          updatedAt: latest.localSeq === local.localSeq ? data.row.updated_at : latest.updatedAt };
        await write('schedules', row);
        if (scope === owner) cache.set(row.id, row);
      });
    }
    requireContext(context);
    const { data: remoteRows, error } = await transport.from('myplan_schedules')
      .select('id,document,version,deleted,updated_at').eq('owner_id', owner);
    requireContext(context);
    if (error) throw error;
    for (const remote of remoteRows || []) {
      await enqueue(async () => {
        const local = await read('schedules', remote.id, owner);
        if (local?.dirty || (local && local.version >= remote.version)) return;
        const row = remoteRecord(remote, owner);
        await write('schedules', row);
        if (scope === owner) { cache.set(row.id, row); onChange({ type: 'refresh', id: row.id, schedule: row.deleted ? null : clone(row.schedule) }); }
      });
    }
    if (scope === owner) {
      reportLocal();
      channel?.postMessage({ scope, type: 'changed' });
      if ([...cache.values()].some(row => row.dirty)) scheduleSync();
    }
  }

  async function sync() {
    clearTimeout(syncTimer);
    if (syncing) return syncing;
    if (!client || !session || globalThis.navigator?.onLine === false) { reportLocal(); return; }
    const owner = session.user.id;
    const context = captureContext();
    syncing = synchronize(context).catch(() => {
      if (owner === scope) status('local', 'Saved on this device—waiting to sync. Check your connection or sign in again.');
    }).finally(() => { syncing = null; });
    return syncing;
  }

  async function signIn(email, password) {
    if (!client) throw new Error('Account saving is unavailable. Your device drafts are safe.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Could not sign in. Check your email and password, then try again.');
    await setSession(data.session);
    await sync();
  }

  async function sendMagicLink(email) {
    if (!client) throw new Error('Account saving is unavailable. Your device drafts are safe.');
    if (config.myplanMagicLinkEnabled !== true) throw new Error('Use email and password to sign in. Sign-in links are not enabled for this address yet.');
    const redirect = new URL('./', location.href);
    redirect.hash = ''; redirect.search = '';
    const { error } = await client.auth.signInWithOtp({ email, options: {
      shouldCreateUser: false, emailRedirectTo: redirect.href,
    } });
    // Do not disclose which addresses have accounts. Registration remains closed.
    if (error && (!error.status || error.status === 429 || error.status >= 500)) {
      throw new Error('The sign-in link could not be sent. Wait a minute and try again.');
    }
  }

  async function signOut() {
    await writes;
    if (client) {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new Error('Could not sign out. Try again.');
    }
    await setSession(null);
  }

  async function claimGuestDrafts() {
    if (!session) throw new Error('Sign in before saving device drafts to your account.');
    const context = captureContext(); requireContext(context);
    const owner = context.owner;
    const guestRows = (await readScope('schedules', 'guest')).filter(row => !row.deleted);
    requireContext(context);
    for (const row of guestRows) {
      requireContext(context);
      const schedule = duplicateSchedule(row.schedule);
      schedule.title = row.schedule.title;
      for (const id of assetIds(schedule)) {
        const asset = await read('photos', id, 'guest');
        requireContext(context);
        if (!asset) throw new Error('A device draft picture is missing. Export the original draft before continuing.');
        await enqueue(() => {
          requireContext(context);
          return write('photos', { ...asset, key: key(owner, id), scope: owner, uploaded: false });
        });
      }
      requireContext(context);
      await save(schedule);
      requireContext(context);
    }
    return guestRows.length;
  }

  async function exportBackup(value) {
    const context = captureContext(); requireContext(context);
    const schedule = validateSchedule(value);
    const photos = [];
    for (const id of assetIds(schedule)) {
      const asset = await getPhoto(id);
      requireContext(context);
      photos.push({ id, width: asset.width, height: asset.height, jpeg: await blobBase64(asset.blob) });
      requireContext(context);
    }
    const backup = new Blob([JSON.stringify({ format: 'kapework-myplan', version: 1, schedule, photos })], { type: 'application/json' });
    if (backup.size > MAX_BACKUP_BYTES) throw new Error('This backup is too large to restore on a phone. Replace the largest photos with smaller pictures, then export again.');
    return backup;
  }

  async function importBackup(file) {
    const context = captureContext(); requireContext(context);
    if (!file || file.size > MAX_BACKUP_BYTES) throw new Error('Choose a My Plan backup smaller than 80 MB.');
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { throw new Error('This is not a readable My Plan backup.'); }
    requireContext(context);
    if (backup.format !== 'kapework-myplan' || backup.version !== 1 || !Array.isArray(backup.photos) || backup.photos.length > 25) {
      throw new Error('Choose an editable My Plan backup (.myplan.json), not a PDF.');
    }
    const schedule = validateSchedule(backup.schedule);
    const needed = assetIds(schedule), mapping = new Map(), assets = [];
    if (backup.photos.length !== needed.length) throw new Error('The backup has missing or extra pictures.');
    for (const id of needed) {
      const photo = backup.photos.find(p => p?.id === id);
      if (!photo || typeof photo.jpeg !== 'string' || photo.jpeg.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(photo.jpeg)) {
        throw new Error('The backup contains an unreadable picture.');
      }
      let binary;
      try { binary = atob(photo.jpeg); } catch { throw new Error('The backup contains an unreadable picture.'); }
      const blob = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'image/jpeg' });
      const dimensions = await imageDimensions(blob);
      if (dimensions.width !== photo.width || dimensions.height !== photo.height) throw new Error('The backup picture dimensions do not match.');
      const asset = await checkPhoto({ id: uuid(), blob, ...dimensions });
      requireContext(context);
      mapping.set(id, asset.id); assets.push(asset);
    }
    schedule.id = uuid();
    schedule.title = `${schedule.title.slice(0, 68)} (restored)`;
    for (const step of [...schedule.steps, schedule.reward].filter(Boolean)) {
      if (step.picture.kind === 'photo') step.picture.assetId = mapping.get(step.picture.assetId);
    }
    // Validate all content before writing any part of the imported schedule.
    validateSchedule(schedule);
    for (const asset of assets) {
      requireContext(context);
      await putPhoto(asset);
    }
    requireContext(context);
    const restored = await save(schedule);
    requireContext(context);
    return restored;
  }

  function destroy() {
    destroyed = true; clearTimeout(syncTimer); authSubscription?.unsubscribe(); channel?.close();
    globalThis.removeEventListener?.('online', scheduleSync);
    globalThis.removeEventListener?.('focus', scheduleSync);
    db?.close();
  }

  const api = { init, list, get, save, remove, duplicate, putPhoto, getPhoto, sync,
    flushLocal: async () => { await writes; },
    flush: async () => { await writes; await sync(); await writes; },
    signIn, sendMagicLink, signOut, claimGuestDrafts,
    hasGuestDrafts: async () => (await readScope('schedules', 'guest')).some(row => !row.deleted),
    getSession: () => session ? { user: { id: session.user.id, email: session.user.email } } : null,
    getStatus: () => ({ ...latestStatus }), configured, exportBackup, importBackup, destroy };
  return api;
}
