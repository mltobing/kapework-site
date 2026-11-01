import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutine, createStep, withPhoto } from '../src/model.js';
import { inspectLayout } from '../src/print.js';

function routine(count, paper='letter', photos=false) {
  const schedule=createRoutine('blank');
  schedule.print.paper=paper;
  schedule.steps=Array.from({length:count},(_,i)=>({
    ...createStep(`Step ${i+1}`, 'star'),caption:'A brief explanation',
  }));
  if(photos)for(const step of schedule.steps)step.picture=withPhoto(step,{
    assetId:crypto.randomUUID(),crop:{x:.2,y:.8,zoom:1.5},
  });
  return schedule;
}

function assertWithinPage(layout) {
  assert.equal(layout.ok,true,layout.issues.join(' '));
  const {paper,margin}=layout;
  for(const [i,row] of layout.cards.entries()) {
    assert.equal(row.number,i+1);
    assert.ok(row.y>=margin);
    assert.ok(row.y+row.height<=paper.height-margin+.001);
    assert.ok(row.numberX<row.textX);
    assert.ok(row.textX+row.textWidth<=row.illustration.x);
    for(const rect of [row.illustration,row.image]) {
      assert.equal(rect.width,rect.height,'every photo crop stays square');
      assert.ok(rect.width>=layout.minimumImageSize);
      assert.ok(rect.x>=margin && rect.x+rect.width<=paper.width-margin+.001);
      assert.ok(rect.y>=row.y && rect.y+rect.height<=row.y+row.height+.001);
    }
    assert.ok(row.labelY-layout.labelSize>=row.y);
    const lastTextY=row.captionLines.length
      ? row.captionY+(row.captionLines.length-1)*layout.captionSize*1.3+layout.captionSize*.3
      : row.labelY+(row.labelLines.length-1)*layout.labelSize*1.2+layout.labelSize*.2;
    assert.ok(lastTextY<=row.y+row.height,'all text fits inside its own row');
    if(i)assert.ok(row.y>=layout.cards[i-1].y+layout.cards[i-1].height-.001);
  }
}

test('bedtime is eight generous readable rows and retains edited order',()=>{
  const schedule=createRoutine('bedtime');
  const inserted=createStep('A hug','heart');
  schedule.steps.splice(2,0,inserted);
  const [moved]=schedule.steps.splice(6,1);
  schedule.steps.unshift(moved);
  schedule.steps.splice(4,1);
  const layout=inspectLayout(schedule);
  assertWithinPage(layout);
  assert.equal(layout.cards.length,8);
  assert.equal(layout.labelSize,22);
  assert.deepEqual(layout.cards.map(row=>row.step.id),schedule.steps.map(step=>step.id));
  assert.ok(layout.cards.every(row=>row.image.width>=65));
});

test('12 Letter and 16 tabloid rows fit fixed-size labels and brief captions',()=>{
  for(const [count,paper,labelSize] of [[12,'letter',22],[16,'tabloid',30]]) {
    const layout=inspectLayout(routine(count,paper,true));
    assertWithinPage(layout);
    assert.equal(layout.cards.length,count);
    assert.equal(layout.labelSize,labelSize);
    assert.equal(layout.captionSize,paper==='letter'?11.5:14);
    assert.ok(layout.cards.every(row=>row.image.x>row.illustration.x));
  }
});

test('mixed photo rows retain common columns; illustration-only pages gain text room',()=>{
  const schedule=createRoutine('bedtime');
  const without=inspectLayout(schedule);
  schedule.steps[2].picture=withPhoto(schedule.steps[2],{
    assetId:crypto.randomUUID(),crop:{x:0,y:1,zoom:3},
  });
  const mixed=inspectLayout(schedule);
  assertWithinPage(mixed);
  assert.equal(mixed.hasPhotos,true);
  assert.equal(new Set(mixed.cards.map(row=>row.image.x)).size,1);
  assert.equal(new Set(mixed.cards.map(row=>row.illustration.x)).size,1);
  assert.equal(new Set(mixed.cards.map(row=>row.textWidth)).size,1);
  assert.ok(without.cards[0].textWidth>mixed.cards[0].textWidth);
  assert.deepEqual(mixed.cards[2].step.picture.crop,{x:0,y:1,zoom:3});
});

test('old photos retain deterministic illustrations and square crop geometry',()=>{
  const schedule=createRoutine('bedtime');
  schedule.steps[0].picture={kind:'photo',assetId:crypto.randomUUID(),crop:{x:.1,y:.9,zoom:2}};
  schedule.steps[1].label='A custom action';
  schedule.steps[1].picture={kind:'photo',assetId:crypto.randomUUID(),crop:{x:.2,y:.8,zoom:1}};
  const layout=inspectLayout(schedule);
  assertWithinPage(layout);
  assert.equal(layout.cards[0].illustrationId,'bath');
  assert.equal(layout.cards[1].illustrationId,'star');
  for(const row of layout.cards)assert.equal(row.image.width/row.image.height,1);
});

test('reward is a separate unnumbered footer with its own illustration and photo',()=>{
  const schedule=createRoutine('bedtime');
  schedule.reward={label:'Together time',caption:'When our routine is done',picture:{kind:'photo',
    assetId:crypto.randomUUID(),illustrationId:'heart',crop:{x:.5,y:.5,zoom:1}}};
  const layout=inspectLayout(schedule);
  assertWithinPage(layout);
  const reward=layout.reward,last=layout.cards.at(-1);
  assert.ok(reward.y>last.y+last.height);
  assert.ok(reward.y+reward.height<=layout.paper.height-layout.margin);
  assert.equal(reward.number,undefined);
  assert.equal(reward.illustrationId,'heart');
  assert.equal(reward.image.width,reward.image.height);
  assert.ok(reward.image.x>reward.illustration.x);
  assert.ok(reward.textX+reward.textWidth<reward.illustration.x);
});

test('overcrowding gives practical adjustments instead of tiny text or a second page',()=>{
  for(const [count,paper] of [[13,'letter'],[17,'tabloid']]) {
    const layout=inspectLayout(routine(count,paper));
    assert.equal(layout.ok,false);
    assert.match(layout.issues.join(' '),/12 steps|16 rows/);
  }
  const crowded=routine(12);
  crowded.reward={label:'A reward',caption:'Together',picture:{kind:'illustration',id:'heart'}};
  assert.equal(inspectLayout(crowded).ok,false,'a footer cannot silently squeeze full-capacity rows');
  const wordy=routine(12);
  wordy.steps[0].label='A long label that needs a lot of room on the page';
  wordy.steps[0].caption='This long explanation cannot fit inside a short row without overlapping the next row or becoming too small to read.';
  const layout=inspectLayout(wordy);
  assert.equal(layout.ok,false);
  assert.match(layout.issues.join(' '),/Step 1 needs more room/);
  assert.equal(layout.labelSize,22);
  assert.equal(layout.captionSize,11.5);
  assert.equal(inspectLayout(createRoutine('blank')).ok,false);
});
