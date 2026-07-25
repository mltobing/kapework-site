/**
 * Tests for the Caren HTML builders — specifically the two safety properties.
 *
 * Everything rendered here originates in a Caren notification e-mail, which is
 * untrusted external data. Two rules:
 *
 *   1. every such field is escaped before it reaches innerHTML;
 *   2. no source message id, no Caren URL and no Caren person id is ever
 *      rendered. The parser discards the URL (which contains a private person
 *      id) at parse time, and there is no column to hold it — this asserts
 *      nothing reintroduces one through the display layer.
 *
 * Run with Node's built-in runner:
 *   node --test apps/ma/src/lib/caren-render.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carenEvidenceTypeLabel,
  carenSectionForViewer,
  carenTodayLine,
  escapeText,
  renderCarenCompare,
  renderCarenItemRow,
  renderCarenSection,
} from './caren-render.js';

const CURRENT = { level: 'current', note: null };

const expectedItem = (over = {}) => ({
  id: 'item-1',
  briefing_id: 'br-1',
  status: 'not_seen',
  expected_summary: 'Voorbeeld afspraak',
  matched_evidence_id: null,
  ambiguous_evidence_id: null,
  ...over,
});

const evidence = (over = {}) => ({
  id: 'ev-1',
  received_at: '2026-07-25T09:12:00Z',
  evidence_type: 'reminder',
  appointment_date: '2026-07-26',
  starts_at: '2026-07-26T08:00:00Z',
  ends_at: '2026-07-26T09:00:00Z',
  title: 'Voorbeeld afspraak',
  location: 'Voorbeeldstraat',
  excerpt: 'Voorbeeld excerpt',
  ...over,
});

// ─── Escaping ────────────────────────────────────────────────────────────────

test('escapeText neutralises every HTML-significant character', () => {
  assert.equal(
    escapeText(`<script>alert("x")&'`),
    '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;',
  );
  assert.equal(escapeText(null), '');
  assert.equal(escapeText(undefined), '');
  assert.equal(escapeText(0), '0');
});

test('a hostile expected summary cannot inject markup', () => {
  const html = renderCarenItemRow(expectedItem({
    expected_summary: '<img src=x onerror="alert(1)">',
  }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test('a hostile evidence title and location cannot inject markup', () => {
  const html = renderCarenCompare(
    expectedItem(),
    evidence({ title: '</dd><script>x</script>', location: '"><b>bold</b>' }),
  );
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});

test('the item id lands in an attribute already escaped', () => {
  const html = renderCarenItemRow(expectedItem({ id: 'a" onclick="evil()' }));
  assert.doesNotMatch(html, /onclick="evil/);
  assert.match(html, /data-caren-item="a&quot; onclick=&quot;evil\(\)"/);
});

// ─── Privacy: never render an id or a URL ────────────────────────────────────

test('an item row never renders a source message id or a Caren URL', () => {
  const html = renderCarenItemRow(
    expectedItem({ status: 'seen', matched_evidence_id: 'ev-1' }),
    { evidence: evidence({ source_message_id: '<caren-99@mail.example>' }), formatMoment: () => 'vrijdag om 09:12' },
  );
  assert.doesNotMatch(html, /caren\.nl/);
  assert.doesNotMatch(html, /\/people\//);
  assert.doesNotMatch(html, /source_message_id|caren-99/);
  // Evidence is described by type and time only.
  assert.match(html, /herinnering/);
  assert.match(html, /vrijdag om 09:12/);
});

test('the comparison view never renders a URL, person id or message id', () => {
  const html = renderCarenCompare(expectedItem(), evidence({
    source_message_id: '<caren-99@mail.example>',
  }), { formatMoment: () => '09:00', formatDay: () => '26 juli' });
  assert.doesNotMatch(html, /caren\.nl|\/people\/|caren-99|source_message_id/);
});

test('the whole section never renders an evidence id as visible text', () => {
  const html = renderCarenSection([expectedItem({ status: 'seen', matched_evidence_id: 'ev-1' })], {
    freshness: CURRENT,
    evidenceById: new Map([['ev-1', evidence()]]),
    formatMoment: () => 'vrijdag om 09:12',
  });
  // The only place an id may appear is a data- attribute the click handler
  // reads back; never inside element text.
  const visible = html.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(visible, /ev-1/);
});

// ─── Section rendering ───────────────────────────────────────────────────────

test('no active items renders nothing at all', () => {
  assert.equal(renderCarenSection([], { freshness: CURRENT }), '');
  assert.equal(renderCarenSection([expectedItem({ status: 'retired' })], { freshness: CURRENT }), '');
});

test('one expected item renders one row with its badge', () => {
  const html = renderCarenSection([expectedItem()], { freshness: CURRENT });
  assert.match(html, /Nog niet gezien in Caren/);
  assert.equal((html.match(/<li class="caren-item/g) ?? []).length, 1);
});

test('multiple expected items each get their own row', () => {
  const html = renderCarenSection([
    expectedItem({ id: 'a', expected_summary: 'Voorbeeld afspraak' }),
    expectedItem({ id: 'b', expected_summary: 'Voorbeeld therapie', status: 'seen', matched_evidence_id: 'ev-1' }),
  ], { freshness: CURRENT });
  assert.equal((html.match(/<li class="caren-item/g) ?? []).length, 2);
  assert.match(html, /Voorbeeld afspraak/);
  assert.match(html, /Voorbeeld therapie/);
});

test('a partly-seen day shows the partly badge', () => {
  const html = renderCarenSection([
    expectedItem({ id: 'a', status: 'seen', matched_evidence_id: 'ev-1' }),
    expectedItem({ id: 'b', status: 'not_seen' }),
  ], { freshness: CURRENT });
  assert.match(html, /Gedeeltelijk gezien in Caren/);
});

test('a changed-after-seen item shows the manual re-confirm action', () => {
  const html = renderCarenSection([expectedItem({ status: 'changed_after_seen' })], { freshness: CURRENT });
  assert.match(html, /Ma is gewijzigd sinds Caren/);
  assert.match(html, /Bevestig de nieuwe versie handmatig/);
  assert.match(html, /data-caren-action="manual_confirm"/);
});

test('an ambiguous item offers Vergelijk and carries its candidate evidence id', () => {
  const html = renderCarenSection([
    expectedItem({ status: 'ambiguous', ambiguous_evidence_id: 'ev-1' }),
  ], { freshness: CURRENT, evidenceById: new Map([['ev-1', evidence()]]), formatMoment: () => 'x' });
  assert.match(html, /Vergelijk/);
  assert.match(html, /data-caren-action="compare"/);
  assert.match(html, /data-caren-evidence="ev-1"/);
});

test('the section always carries the positive-evidence caveat', () => {
  const html = renderCarenSection([expectedItem()], { freshness: CURRENT });
  assert.match(html, /positieve signalen/i);
  assert.match(html, /Geen e-mail betekent niet automatisch/i);
});

test('a stale freshness note is shown above the rows', () => {
  const html = renderCarenSection([expectedItem()], {
    freshness: { level: 'stale', note: 'De Caren-controle is niet recent bijgewerkt.' },
  });
  assert.match(html, /Caren-controle niet actueel/);
  assert.match(html, /niet recent bijgewerkt/);
});

// ─── Comparison modal ────────────────────────────────────────────────────────

test('the comparison shows both sides and both decision buttons', () => {
  const html = renderCarenCompare(expectedItem(), evidence(), {
    formatMoment: () => '10:00', formatDay: () => '26 juli',
  });
  assert.match(html, /Ma verwacht/);
  assert.match(html, /Caren-melding/);
  assert.match(html, /Dit is dezelfde afspraak/);
  assert.match(html, /Niet dezelfde afspraak/);
  assert.match(html, /data-caren-decision="confirm_candidate"/);
  assert.match(html, /data-caren-decision="reject_candidate"/);
});

test('absent evidence fields are omitted, never invented', () => {
  const html = renderCarenCompare(expectedItem(), evidence({
    evidence_type: 'updated', starts_at: null, ends_at: null, location: null,
  }), { formatMoment: () => 'x', formatDay: () => '26 juli' });
  assert.doesNotMatch(html, /Begint/);
  assert.doesNotMatch(html, /Eindigt/);
  assert.doesNotMatch(html, /Locatie/);
  assert.match(html, /wijziging/);
});

test('evidence types read as plain Dutch, never as raw enum values', () => {
  assert.equal(carenEvidenceTypeLabel('updated'), 'wijziging');
  assert.equal(carenEvidenceTypeLabel('reminder'), 'herinnering');
  assert.equal(carenEvidenceTypeLabel('unparsed'), 'onleesbaar bericht');
  assert.equal(carenEvidenceTypeLabel('something-new'), 'onleesbaar bericht');
});

// ─── Who sees it ─────────────────────────────────────────────────────────────

const viewerOpts = (over = {}) => ({
  accessType: 'owner', available: true, freshness: CURRENT, evidenceById: new Map(), ...over,
});

test('an owner sees the Caren reconciliation', () => {
  const html = carenSectionForViewer([expectedItem()], viewerOpts());
  assert.match(html, /Caren-controle/);
  assert.match(html, /Nog niet gezien in Caren/);
});

test('a family member sees nothing', () => {
  assert.equal(carenSectionForViewer([expectedItem()], viewerOpts({ accessType: 'member' })), '');
});

test('a care-team user sees nothing', () => {
  assert.equal(carenSectionForViewer([expectedItem()], viewerOpts({ accessType: 'caregiver' })), '');
});

test('an unknown or absent accessType sees nothing', () => {
  assert.equal(carenSectionForViewer([expectedItem()], viewerOpts({ accessType: null })), '');
  assert.equal(carenSectionForViewer([expectedItem()], viewerOpts({ accessType: undefined })), '');
  assert.equal(carenSectionForViewer([expectedItem()], {}), '');
});

test('an unavailable Caren layer degrades to no section, never to an error', () => {
  // The migration-not-yet-applied case, and every network failure: the
  // briefing card still renders, just without its Caren section.
  assert.equal(carenSectionForViewer([expectedItem()], viewerOpts({ available: false })), '');
});

test('a disabled stage hides the section from owners too', () => {
  const html = carenSectionForViewer([expectedItem()], viewerOpts({
    freshness: { level: 'disabled', note: null },
  }));
  assert.equal(html, '');
});

// ─── Separation from the briefing send workflow ──────────────────────────────

test('the Caren section never renders a send-status badge or toggle', () => {
  // ready/sent/changed_after_sent stays a human workflow on its own control;
  // Caren evidence must never look like — or be mistaken for — that badge.
  const html = renderCarenSection([
    expectedItem({ id: 'a', status: 'seen', matched_evidence_id: 'ev-1' }),
    expectedItem({ id: 'b', status: 'changed_after_seen' }),
  ], { freshness: CURRENT, evidenceById: new Map([['ev-1', evidence()]]), formatMoment: () => 'x' });

  assert.doesNotMatch(html, /Markeer als verzonden|Heropen<|briefing-badge|data-toggle/);
  assert.doesNotMatch(html, /Verzonden/);
  assert.doesNotMatch(html, /Gewijzigd na verzending/);
});

// ─── Today's compact line ────────────────────────────────────────────────────

test('Today shows a single count line, correctly pluralised', () => {
  assert.equal(carenTodayLine(1), '1 Caren-controle voor de komende 7 dagen vraagt aandacht.');
  assert.equal(carenTodayLine(3), '3 Caren-controles voor de komende 7 dagen vragen aandacht.');
});

test('Today shows nothing when nothing needs attention', () => {
  assert.equal(carenTodayLine(0), null);
  assert.equal(carenTodayLine(undefined), null);
  assert.equal(carenTodayLine(-1), null);
});
