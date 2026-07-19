/* Tests for the shared server-side activity-recording helper — the JS-layer
 * half of the idempotency contract (the DB-layer half, the partial unique
 * index + ON CONFLICT DO NOTHING on ma_activity_events, was verified live
 * against Supabase in this PR's SQL testing pass). A duplicate write must be
 * a silent no-op; any other failure must propagate so callers can refuse to
 * report a fully-audited action as successful.
 * Run: node --test netlify/functions-tests/_ma-activity.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordActivity } = require('../functions/_ma-activity');

function fakeSupabase(insertResult) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        return {
          insert: async (payload) => {
            calls.push({ table, payload });
            return insertResult;
          },
        };
      },
    },
  };
}

test('recordActivity: a unique-violation (duplicate idempotency_key) is swallowed silently', async () => {
  const { client, calls } = fakeSupabase({ error: { code: '23505', message: 'duplicate key' } });
  await assert.doesNotReject(() => recordActivity(client, {
    familyId: 'fam-1', actorType: 'user', source: 'trusted_device', action: 'trusted_device_revoked',
    idempotencyKey: 'trusted-device-revoked-dev-1',
  }));
  assert.equal(calls.length, 1);
});

test('recordActivity: any other DB error propagates to the caller', async () => {
  const { client } = fakeSupabase({ error: { code: '42501', message: 'permission denied' } });
  await assert.rejects(() => recordActivity(client, {
    familyId: 'fam-1', actorType: 'user', source: 'trusted_device', action: 'trusted_device_revoked',
  }));
});

test('recordActivity: success is a silent no-throw', async () => {
  const { client } = fakeSupabase({ error: null });
  await assert.doesNotReject(() => recordActivity(client, {
    familyId: 'fam-1', actorType: 'user', source: 'trusted_device', action: 'trusted_device_activated',
  }));
});

test('recordActivity: sends exactly the documented columns, with safe defaults for optional fields', async () => {
  const { client, calls } = fakeSupabase({ error: null });
  await recordActivity(client, {
    familyId: 'fam-1', actorType: 'user', source: 'trusted_device', action: 'trusted_device_revoked',
    objectType: 'trusted_device', objectId: 'dev-1', idempotencyKey: 'trusted-device-revoked-dev-1',
  });
  assert.deepEqual(calls[0].payload, {
    family_id: 'fam-1',
    actor_type: 'user',
    actor_user_id: null,
    source: 'trusted_device',
    action: 'trusted_device_revoked',
    object_type: 'trusted_device',
    object_id: 'dev-1',
    severity: 'info',
    metadata: {},
    idempotency_key: 'trusted-device-revoked-dev-1',
  });
});

test('recordActivity: metadata is never inferred from unknown/free-text fields — only what the caller explicitly passes', async () => {
  const { client, calls } = fakeSupabase({ error: null });
  await recordActivity(client, {
    familyId: 'fam-1', actorType: 'user', source: 'app', action: 'logboek_created',
    metadata: { kind: 'note', audience: 'family' },
  });
  assert.deepEqual(calls[0].payload.metadata, { kind: 'note', audience: 'family' });
  assert.ok(!('label' in calls[0].payload.metadata));
  assert.ok(!('token' in calls[0].payload.metadata));
});
