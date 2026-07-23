/**
 * Tests for src/lib/route-parse.js — the router's pure hash-fragment parsing,
 * exercised without a browser `window`/`location` global (router.js itself
 * can't be imported directly in Node; see that file's header comment).
 *
 * Run: node --test apps/ma/src/lib/route-parse.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRouteHash, buildRouteHash } from './route-parse.js';

test('parses a plain route name with no query', () => {
  const { name, params } = parseRouteHash('logboek');
  assert.equal(name, 'logboek');
  assert.equal(params.toString(), '');
});

test('parses a route name carrying an import id query param', () => {
  const { name, params } = parseRouteHash('document-beoordelen?id=abc-123');
  assert.equal(name, 'document-beoordelen');
  assert.equal(params.get('id'), 'abc-123');
});

test('an empty hash parses as an empty name with no params', () => {
  const { name, params } = parseRouteHash('');
  assert.equal(name, '');
  assert.equal(params.toString(), '');
});

test('a bare "?" with nothing after it parses as an empty param set', () => {
  const { name, params } = parseRouteHash('documenten?');
  assert.equal(name, 'documenten');
  assert.equal(params.toString(), '');
});

test('buildRouteHash returns the bare name when there are no params', () => {
  assert.equal(buildRouteHash('logboek'), 'logboek');
  assert.equal(buildRouteHash('logboek', {}), 'logboek');
});

test('buildRouteHash appends a query string for params', () => {
  assert.equal(buildRouteHash('document-beoordelen', { id: 'abc-123' }), 'document-beoordelen?id=abc-123');
});

test('round-trips buildRouteHash through parseRouteHash', () => {
  const built = buildRouteHash('document-beoordelen', { id: 'xyz-999' });
  const { name, params } = parseRouteHash(built);
  assert.equal(name, 'document-beoordelen');
  assert.equal(params.get('id'), 'xyz-999');
});
