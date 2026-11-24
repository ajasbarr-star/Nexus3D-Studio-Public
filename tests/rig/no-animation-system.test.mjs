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

// Animation workspace regression coverage is now enabled on the Test integration branch.


test('Alphabet States use a compact horizontal sequence below a separate accessible tools panel', () => {
  assert.match(app, /className="timeline-playback-panel"/);
  assert.match(app, /className="timeline-tools-panel"/);
  assert.match(app, /className="alphabet-state-panel"/);
  assert.match(app, /className="alphabet-state-scroll"/);
  assert.match(app, /className="alphabet-state-mini-ruler"/);
  assert.match(app, /className="alphabet-state-add"/);
  assert.match(app, /className="state-ruler-panel"/);
  assert.match(app, /className="timeline-keyframe-button"/);
  assert.match(app, /NO STATE SELECTED/);
  assert.match(app, /const id = addAlphabetState\('independent'\); setPendingStateChoice\(id\)/);
  assert.match(app, /setSelectedSequenceState\(state.id\)/);
  assert.match(app, /resizeAlphabetState\(state.id, drag.startWidth \+ delta \* 1\.25\)/);
  assert.match(css, /\.timeline-tools-panel \.timeline-tool-row/);
  assert.match(css, /\.alphabet-state-scroll/);
  assert.match(css, /\.timeline-playback-panel/);
  assert.doesNotMatch(app, /alphabet-state-rail/);
});
test('New Alphabet States offer manual Continue or Independent pose behavior', () => {
  assert.match(app, /CONTINUE/);
  assert.match(app, /INDEPENDENT/);
  assert.match(app, /setAlphabetStateMode\(pendingStateChoice,'continue'\)/);
  assert.match(app, /addAlphabetState\('independent'\)/);
  assert.match(app, /setAlphabetStateMode = \(stateId: string, mode: 'continue' \| 'independent'\)/);
  assert.match(app, /const previousEnd = sequenceStates\.reduce/);
});

test('Alphabet State sequence and timeline markers persist with project data', () => {
  assert.match(app, /animationSequence:/);
  assert.match(app, /savedSequence\.states/);
  assert.match(app, /savedSequence\.markers/);
  assert.match(app, /timelineMarkers/);
});

test('One continuous frame range displays per-object tracks across all Alphabet States', () => {
  assert.match(app, /setCurrentFrame\(previousEnd\)/);
  assert.match(app, /max=\{Math\.max\(activeSequenceRange\.start \+ 1, activeSequenceRange\.end\)\}/);
  assert.match(app, /items\.filter\(item=>item\.kind/);
  assert.match(app, /keyframes\[item\.id\]/);
  assert.match(app, /loopPlayback/);
});


test('Animation playback continues when entering or exiting the Animation workspace', () => {
  const toggle = app.slice(app.indexOf('const toggleAnimationWorkspace ='), app.indexOf('const toggleCamera ='));
  assert.ok(toggle.includes('setAnimationMode(false)'));
  assert.ok(!toggle.includes('setPlaying(false)'), 'workspace navigation must not stop playback');
  assert.match(app, /if \(!playing\) return;[\s\S]*?setInterval/);
});

test('Dope Sheet and Graph Editor provide working keyframe editing actions', () => {
  assert.match(app, /moveSelectedKeyframe = \(delta: number\)/);
  assert.match(app, /updateSelectedKeyframeChannel = \(value: number\)/);
  assert.match(app, /timeline-dope-sheet/);
  assert.match(app, /−1 FRAME/);
  assert.match(app, /FRAME ▶/);
  assert.match(app, /timeline-graph-editor/);
  assert.match(app, /Graph value updated/);
  assert.match(app, /selectedGraphChannel/);
  assert.match(app, /timeline-graph-plot/);
  assert.match(app, /graphEntries\.map/);
  assert.match(app, /NO CURVE DATA/);
  assert.match(app, /NO KEYFRAMES YET/);
  assert.match(css, /\.timeline-dope-sheet/);
  assert.match(css, /\.timeline-graph-editor/);
});

test('Ghost Preview creates non-selectable transparent 3D previous and next poses', () => {
  assert.match(app, /Nexus3D ' \+ label \+ ' Ghost/);
  assert.match(app, /cloneSkeletonHierarchy\(source\)/);
  assert.match(app, /internalAnimationGhost/);
  assert.match(app, /\(copy as any\)\.opacity = 0\.2/);
  assert.match(app, /node\.raycast = \(\) => \{\}/);
});

test('Timeline toolbar actions remain connected to undo, redo, copy, paste, fit and markers', () => {
  assert.match(app, /onClick=\{undo\} title="Undo last scene or keyframe edit"/);
  assert.match(app, /onClick=\{redo\} title="Redo last scene or keyframe edit"/);
  assert.match(app, /onClick=\{copyFrame\}/);
  assert.match(app, /onClick=\{pasteFrame\}/);
  assert.match(app, /timelineScrollRef\.current\?\.scrollTo/);
  assert.match(app, /Add a marker at the current frame/);
});


test('Animation Scene List and Transform Inspector remain separate compact panels', () => {
  assert.match(app, /className="animation-scene-list animation-floating-panel"/);
  assert.match(app, /className="animation-transform-inspector animation-floating-panel"/);
  assert.match(app, /SC LIST/);
  assert.match(app, /TRANSFORM/);
  assert.ok(app.includes("ariaLabel={'Animation '+group+' '+axis.toUpperCase()}"));
  assert.match(app, /runMode\('translate'\)/);
  assert.match(app, /runMode\('rotate'\)/);
  assert.match(app, /runMode\('scale'\)/);
  assert.match(app, /title=\{keyed\?'Keyframe exists at current frame':'Add keyframe at current frame'\}/);
  assert.match(css, /\.animation-scene-list\.animation-floating-panel/);
  assert.match(css, /\.animation-transform-inspector\.animation-floating-panel/);
  assert.doesNotMatch(app, /animation-editor-dock/);
});


test('Selected Alphabet State keeps keyframes on its own ruler and extends continuously when scrolled', () => {
  assert.match(app, /className="state-ruler-scroll" onScroll=\{event =>/);
  assert.match(app, /resizeAlphabetState\(activeSequenceState\.id, activeSequenceState\.width \+ Math\.max\(120, activeSequenceState\.width\)\)/);
  assert.match(app, /Number\.MAX_SAFE_INTEGER/);
  assert.match(app, /timelineTool==='tracks' \? null : timelineTool==='dope'/);
  assert.match(app, /className="timeline-markers"/);
  assert.doesNotMatch(app, /Math\.min\(10000, Math\.round\(nextWidth\)\)/);
  assert.match(css, /\.state-ruler-content \.timeline-track/);
  assert.match(app, /<input type="number" min=\{1\} value=\{timelineDuration\}/);
});
