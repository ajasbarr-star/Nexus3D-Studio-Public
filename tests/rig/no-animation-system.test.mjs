import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('Animation System toolbar and timeline UI are absent', () => {
  for (const marker of ['animation-rail-btn','animation-objects-panel','sequence-controller','sequence-playback-controls','timeline-panel','interpolation-float','animation-mode-controls','Animation Timeline','Toggle Animation Mode']) {
    assert.ok(!app.includes(marker), 'unexpected Animation System UI: ' + marker);
  }
});

test('Automatic IK / Auto Rig entry points are not exposed', () => {
  assert.ok(!app.includes('autoRigSelectedMesh'));
  assert.ok(!app.includes('autoIKOpen'));
  assert.ok(!app.includes('Auto Rig ·'));
});
