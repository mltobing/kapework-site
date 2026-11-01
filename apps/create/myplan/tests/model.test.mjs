import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutine, createStep, duplicateSchedule, validateSchedule, getStepIllustration, withPhoto, withIllustration, withoutPhoto } from '../src/model.js';
import { cropSourceRect } from '../src/images.js';

test('starters remain generic, editable sequences with comfortable bedtime count', () => {
  const morning = createRoutine('morning');
  assert.equal(morning.steps[2].label, 'Sister goes to school');
  assert.equal(createRoutine('bedtime').steps.length, 8);
  assert.equal(createRoutine('blank').steps.length, 0);
  assert.equal(morning.print.paper, 'letter');
  const independent = createRoutine('morning');
  morning.steps[0].label = 'Changed by this family';
  assert.equal(independent.steps[0].label, 'Wake up');
});

test('insert, reorder and remove preserve sequence through validation', () => {
  const routine = createRoutine('bedtime');
  const inserted = createStep('Hug', 'star');
  routine.steps.splice(3, 0, inserted);
  const [moved] = routine.steps.splice(5, 1);
  routine.steps.splice(1, 0, moved);
  routine.steps.splice(7, 1);
  const restored = validateSchedule(JSON.parse(JSON.stringify(routine)));
  assert.deepEqual(restored.steps.map(s => s.id), routine.steps.map(s => s.id));
  assert.deepEqual(restored.steps.map(s => s.label), routine.steps.map(s => s.label));
});

test('duplicate has independent nested crops, settings, steps and reward', () => {
  const original = createRoutine('bedtime');
  original.steps[0].picture = { kind: 'photo', assetId: crypto.randomUUID(), crop: { x: .2, y: .8, zoom: 2 } };
  original.reward = { label: 'Together time', caption: 'When our routine is done', picture: { kind: 'photo', assetId: crypto.randomUUID(), crop: { x: .3, y: .6, zoom: 1.5 } } };
  const copy = duplicateSchedule(original);
  assert.notEqual(copy.id, original.id);
  assert.ok(copy.steps.every((s, i) => s.id !== original.steps[i].id));
  assert.equal(copy.steps[0].picture.assetId, original.steps[0].picture.assetId);
  assert.equal(copy.steps[0].picture.illustrationId, 'bath');
  copy.steps[0].picture.crop.x = 1;
  copy.reward.picture.crop.zoom = 3;
  copy.print.paper = 'tabloid';
  assert.equal(original.steps[0].picture.crop.x, .2);
  assert.equal(original.reward.picture.crop.zoom, 1.5);
  assert.equal(original.print.paper, 'letter');
});

test('legacy photos acquire a stable generic illustration without changing their asset or crop', () => {
  const original = createRoutine('bedtime');
  const assetId = crypto.randomUUID(), crop = { x: .1, y: .7, zoom: 2.4 };
  original.steps[1].picture = { kind: 'photo', assetId, crop };
  original.steps[2].picture = { kind: 'photo', assetId, crop };
  original.steps[2].label = 'Our special activity';
  const normalized = validateSchedule(original);
  assert.deepEqual(normalized.steps[1].picture, { kind: 'photo', assetId, crop, illustrationId: 'teeth' });
  assert.equal(normalized.steps[2].picture.illustrationId, 'star');
  assert.equal(original.steps[1].picture.illustrationId, undefined, 'validation does not rewrite its input');
  normalized.steps[1].label = 'A new family label';
  assert.equal(validateSchedule(normalized).steps[1].picture.illustrationId, 'teeth');
  assert.equal(getStepIllustration({ label: '  BRUSH   TEETH ', picture: { kind: 'photo', assetId, crop } }), 'teeth');
});

test('adding, replacing, recropping and removing a photo preserve its chosen illustration', () => {
  const step = createStep('Our activity', 'heart');
  const firstId = crypto.randomUUID(), nextId = crypto.randomUUID();
  step.picture = withPhoto(step, { assetId: firstId, crop: { x: .2, y: .8, zoom: 2 } });
  assert.equal(getStepIllustration(step), 'heart');
  const before = structuredClone(step);
  const changed = withIllustration(step, 'read');
  assert.deepEqual(step, before, 'illustration changes do not mutate a live step');
  assert.equal(changed.assetId, firstId);
  assert.deepEqual(changed.crop, step.picture.crop);
  step.picture = changed;
  step.picture = withPhoto(step, { assetId: nextId, crop: { x: .6, y: .3, zoom: 1.8 } });
  assert.equal(step.picture.illustrationId, 'read');
  assert.equal(step.picture.assetId, nextId);
  step.picture = withPhoto(step, { ...step.picture, crop: { x: 1, y: 0, zoom: 3 } });
  assert.deepEqual(step.picture.crop, { x: 1, y: 0, zoom: 3 });
  assert.deepEqual(withoutPhoto(step), { kind: 'illustration', id: 'read' });
});

test('explicit photo illustrations survive reward and duplicate normalization independently', () => {
  const original = createRoutine('blank');
  const step = createStep('Custom task', 'water');
  step.picture = withPhoto(step, { assetId: crypto.randomUUID(), crop: { x: .3, y: .8, zoom: 2.1 } });
  original.steps.push(step);
  original.reward = { label: 'Reward', caption: 'When we finish', picture: withPhoto({ picture: { kind: 'illustration', id: 'heart' } }, { assetId: crypto.randomUUID() }) };
  const copy = duplicateSchedule(original);
  assert.equal(copy.steps[0].picture.illustrationId, 'water');
  assert.equal(copy.reward.picture.illustrationId, 'heart');
  copy.steps[0].picture.illustrationId = 'star';
  copy.steps[0].picture.crop.zoom = 3;
  assert.equal(original.steps[0].picture.illustrationId, 'water');
  assert.equal(original.steps[0].picture.crop.zoom, 2.1);
});

test('supplied photo illustration identifiers must be known strings', () => {
  for (const invalid of [null, '', 'toString', 'constructor', 'unknown', 1, {}, ['teeth']]) {
    const plan = createRoutine('bedtime');
    plan.steps[0].picture = { kind: 'photo', assetId: crypto.randomUUID(), crop: { x: .5, y: .5, zoom: 1 }, illustrationId: invalid };
    assert.throws(() => validateSchedule(plan), /illustration/);
    assert.throws(() => withIllustration(createStep(), invalid), /illustration/);
  }
});

test('validation preserves photo crops and drops unsupported private links', () => {
  const routine = createRoutine('home');
  routine.steps[0].picture = { kind: 'photo', assetId: crypto.randomUUID(), crop: { x: 0, y: 1, zoom: 3 }, url: 'https://private.invalid/signed-media' };
  routine.owner_id = crypto.randomUUID();
  routine.access_token = 'must-never-be-imported';
  const cleaned = validateSchedule(routine);
  assert.deepEqual(cleaned.steps[0].picture.crop, { x: 0, y: 1, zoom: 3 });
  assert.equal(cleaned.steps[0].picture.url, undefined);
  assert.equal(cleaned.owner_id, undefined);
  assert.equal(cleaned.access_token, undefined);
});

test('untrusted input rejects unknown paper/theme including inherited object keys', () => {
  for (const [field, bad] of [['paper', 'toString'], ['theme', 'constructor'], ['paper', 'A4'], ['theme', '__proto__']]) {
    const routine = createRoutine('blank');
    routine.print[field] = bad;
    assert.throws(() => validateSchedule(routine), /print settings/);
  }
});

test('untrusted input rejects duplicate step identifiers, bad crops and excessive content', () => {
  const duplicate = createRoutine('bedtime');
  duplicate.steps[1].id = duplicate.steps[0].id;
  assert.throws(() => validateSchedule(duplicate), /unique/);
  for (const crop of [{ x: -1, y: .5, zoom: 1 }, { x: .5, y: .5, zoom: 3.1 }, { x: NaN, y: .5, zoom: 1 }]) {
    const routine = createRoutine('bedtime');
    routine.steps[0].picture = { kind: 'photo', assetId: crypto.randomUUID(), crop };
    assert.throws(() => validateSchedule(routine), /crop/);
  }
  const large = createRoutine('blank');
  large.steps = Array.from({ length: 25 }, () => createStep());
  assert.throws(() => validateSchedule(large), /24/);
  const long = createRoutine('blank');
  long.title = 'a'.repeat(81);
  assert.throws(() => validateSchedule(long), /title/);
});

test('crop geometry respects orientation, reposition and zoom without drawing outside source', () => {
  for (const [width, height] of [[4000, 3000], [3000, 4000], [2000, 2000]]) {
    for (const crop of [{ x: 0, y: 0, zoom: 1 }, { x: 1, y: 1, zoom: 3 }, { x: .4, y: .6, zoom: 1.8 }]) {
      const rect = cropSourceRect(width, height, crop, 4 / 3);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.width <= width + .001);
      assert.ok(rect.y + rect.height <= height + .001);
      assert.ok(Math.abs(rect.width / rect.height - 4 / 3) < .0001);
    }
  }
  assert.deepEqual(cropSourceRect(4000, 3000, { x: 1, y: .5, zoom: 1 }, 1), { x: 1000, y: 0, width: 3000, height: 3000 });
});
