import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeSource } from '../../scripts/rds-source-audit.mjs';

test('detects invalid update() calls on a SkeletonHelper variable', () => {
  const source = `const helper = new THREE.SkeletonHelper(root); helper.update();`;
  const findings = analyzeSource(source);
  assert.equal(findings.some(item => item.rule === 'THREE_SKELETON_HELPER_UPDATE_API'), true);
});

test('detects helper.update() property-chain regression', () => {
  const findings = analyzeSource('rig.helper.update();');
  assert.equal(findings.some(item => item.rule === 'THREE_SKELETON_HELPER_UPDATE_API'), true);
});

test('allows the supported updateMatrixWorld(true) API', () => {
  const source = `const helper = new THREE.SkeletonHelper(root); helper.updateMatrixWorld(true);`;
  const findings = analyzeSource(source);
  assert.equal(findings.length, 0);
});

test('current editor keeps critical runtime integration entry points', () => {
  const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  for (const symbol of [
    'runRdsFullScan', 'attachRootToShape', 'solveIK', 'reparentObject',
    'reorderObject', 'recordSceneAction', 'setPerformanceMode',
    'syncViewportControls', 'updateMatrixWorld(true)'
  ]) {
    assert.ok(app.includes(symbol), `Missing critical integration marker: ${symbol}`);
  }
});

test('source audit catches TypeScript syntax errors', () => {
  const findings = analyzeSource('const broken = ;');
  assert.equal(findings.some(item => item.rule === 'TYPESCRIPT_PARSE_ERROR'), true);
});
