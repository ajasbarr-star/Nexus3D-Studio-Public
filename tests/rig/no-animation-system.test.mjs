import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

test('Animation workspace has a clickable ANIM entry and dedicated User Camera mode', () => {
  assert.match(app, /const \[animationMode, setAnimationMode\] = useState\(false\)/);
  assert.match(app, /aria-label="Open Animation Workspace"/);
  assert.match(app, /const toggleAnimationWorkspace = \(\) =>/);
  assert.match(app, /r\.animationView = true/);
  assert.match(app, /r\.animationView = false/);
  assert.match(app, /animation-mode-controls/);
  assert.match(css, /\.animation-mode \.right-rail/);
});

test('Animation timeline supports transform keyframes, playback, recording and interpolation', () => {
  for (const marker of ['timeline-panel','timeline-transport','timeline-track','timeline-markers','timeline-settings','captureRef.current()','setPlaying','setCurrentFrame','autoKey','interpolation']) {
    assert.ok(app.includes(marker), 'missing Animation timeline feature: ' + marker);
  }
  assert.match(app, /min=\{1\} max=\{60\} value=\{frameRate\}/);
  assert.match(app, /min=\{1\} max=\{60\} value=\{timelineDuration\}/);
  assert.match(app, /THREE\.AnimationMixer\(entry\.object\)/);
  assert.match(app, /THREE\.AnimationClip\.toJSON\(entry\.clip\)/);
  assert.match(app, /THREE\.AnimationClip\.parse\(savedClip\.clip\)/);
  assert.match(app, /animationSettings:/);
  assert.match(app, /keyframes: keysRef\.current/);
  assert.match(app, /timeline-clip-select/);
  assert.match(css, /\.timeline-panel/);
});

test('Automatic IK / Auto Rig entry points remain absent', () => {
  assert.ok(!app.includes('autoRigSelectedMesh'));
  assert.ok(!app.includes('autoIKOpen'));
  assert.ok(!app.includes('Auto Rig ·'));
});
