import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const capacitor = fs.readFileSync('capacitor.config.ts', 'utf8');
const testWorkflow = fs.readFileSync('.github/workflows/android-test-apk.yml', 'utf8');
const originalWorkflow = fs.readFileSync('.github/workflows/android-apk.yml', 'utf8');

test('Test APK has a separate Android application ID', () => {
  assert.match(capacitor, /appId:\s*'com\.nexus3d\.studio\.test'/);
  assert.match(testWorkflow, /com\/nexus3d\/studio\/test/);
});

test('Test APK workflow is isolated from the Original build branch and artifact', () => {
  assert.match(testWorkflow, /test\/nexus3d-test-apk/);
  assert.match(testWorkflow, /Nexus3D_Test_\$\{\{ github\.run_number \}\}\.apk/);
  assert.match(originalWorkflow, /feature\/capacitor-offline-apk/);
  assert.doesNotMatch(originalWorkflow, /Nexus3D_Test_/);
});

test('Interaction trace is a separate panel from RDS diagnostics', () => {
  assert.match(app, /REALTIME INTERACTION TRACE/);
  assert.match(app, /REALTIME DIAGNOSTIC SYSTEM/);
  assert.match(app, /interactionTraceQueueRef/);
  assert.match(app, /OBJECT SELECTED/);
  assert.match(app, /CONTROL TOUCH/);
});

test('Runtime errors and warnings are mirrored for interaction correlation', () => {
  assert.match(app, /level === 'ERROR' \|\| level === 'WARN'/);
  assert.match(app, /RUNTIME ' \+ level/);
  assert.match(app, /ERROR HIGHLIGHTS/);
  assert.match(app, /COPY ALL/);
});

test('Interaction history is bounded and stored separately', () => {
  assert.match(app, /nexus3d_interaction_trace_v1/);
  assert.match(app, /slice\(-600\)/);
  assert.match(app, /Maximum 600 saved events/);
});
