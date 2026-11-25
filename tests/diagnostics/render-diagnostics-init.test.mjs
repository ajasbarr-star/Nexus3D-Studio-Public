import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('render diagnostics sampler is initialized before runtime registration', async () => {
  const source = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const declaration = source.indexOf('const getRenderDiagnostics = () => ({');
  const runtimeRegistration = source.indexOf('runtime.current = { ...(runtime.current || {}), scene, camera');
  assert.notEqual(declaration, -1, 'getRenderDiagnostics declaration must exist');
  assert.notEqual(runtimeRegistration, -1, 'runtime registration must exist');
  assert.ok(
    declaration < runtimeRegistration,
    'getRenderDiagnostics must be initialized before runtime.current references it'
  );
  assert.match(
    source.slice(runtimeRegistration, runtimeRegistration + 1200),
    /getRenderDiagnostics/,
    'runtime registration must expose the initialized diagnostics getter'
  );
});
