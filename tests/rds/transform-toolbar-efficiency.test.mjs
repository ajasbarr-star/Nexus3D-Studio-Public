import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('Move Rotate Scale mode is applied once per toolbar action', () => {
  const start = app.indexOf('const runMode =');
  const end = app.indexOf('const setAxisSpace =', start);
  const handler = app.slice(start, end);
  assert.equal((handler.match(/transform\.setMode\(next\)/g) || []).length, 1);
});

test('World Local axis space is applied once per toolbar action', () => {
  const start = app.indexOf('const setAxisSpace =');
  const end = app.indexOf('const add =', start);
  const handler = app.slice(start, end);
  assert.equal((handler.match(/transform\.setSpace\(next\)/g) || []).length, 1);
});
