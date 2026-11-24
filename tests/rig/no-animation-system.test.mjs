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
  for (const marker of ['timeline-panel','timeline-transport','alphabet-keyframe-track','alphabet-keyframe-markers','timeline-settings','captureRef.current()','setPlaying','setCurrentFrame','autoKey','interpolation']) {
    assert.ok(app.includes(marker), 'missing Animation timeline feature: ' + marker);
  }
  assert.match(app, /min=\{1\} max=\{60\} value=\{frameRate\}/);
  assert.match(app, /<input type="number" min=\{1\} value=\{timelineDuration\}/);
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
  assert.match(app, /className="alphabet-state-keyframe-ruler"/);
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

test('One continuous frame range drives the single Alphabet Ruler keyframe track across all States', () => {
  assert.match(app, /setCurrentFrame\(previousEnd\)/);
  assert.match(app, /max=\{Math\.max\(activeSequenceRange\.start \+ 1, activeSequenceRange\.end\)\}/);
  assert.match(app, /className="alphabet-keyframe-track"/);
  assert.match(app, /keyframes\[selected\]/);
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
  assert.match(app, /className="alphabet-state-keyframe-scroll" ref=\{timelineScrollRef\} onScroll=\{event =>/);
  assert.match(app, /resizeAlphabetState\(activeSequenceState\.id, activeSequenceState\.width \+ Math\.max\(120, activeSequenceState\.width\)\)/);
  assert.match(app, /Number\.MAX_SAFE_INTEGER/);
  assert.match(app, /timelineTool==='tracks' \? null : timelineTool==='dope'/);
  assert.match(app, /className="alphabet-keyframe-markers"/);
  assert.doesNotMatch(app, /Math\.min\(10000, Math\.round\(nextWidth\)\)/);
  assert.match(css, /\.alphabet-state-keyframe-content \.alphabet-keyframe-track/);
  assert.match(app, /<input type="number" min=\{1\} value=\{timelineDuration\}/);
});


test('Selected State uses exactly one integrated timeline track for the playhead and keyframe diamonds', () => {
  const selectedRuler = app.slice(app.indexOf('className="alphabet-state-keyframe-ruler"'), app.indexOf('className="alphabet-state-keyframe-empty"'));
  assert.match(selectedRuler, /className="alphabet-keyframe-track" aria-label="Single timeline track with playhead and keyframes"/);
  assert.match(selectedRuler, /aria-label="Current animation frame and playhead" type="range"/);
  assert.match(selectedRuler, /className="alphabet-keyframe-markers"/);
  assert.match(selectedRuler, /keyframes\[selected\]/);
  assert.match(selectedRuler, /setSelectedKeyframe\(\{id:selected,frame:at\}\); setCurrentFrame\(at\)/);
  assert.equal((selectedRuler.match(/className="alphabet-keyframe-track"/g) || []).length, 1, 'The selected State must render exactly one integrated timeline track');
  assert.equal((selectedRuler.match(/aria-label="Current animation frame and playhead" type="range"/g) || []).length, 1, 'The integrated track must have exactly one playhead slider');
  assert.match(app, /className="alphabet-state-keyframe-scroll" ref=\{timelineScrollRef\}/);
  assert.match(app, /onClick=\{\(\) => captureRef\.current\(\)\}/);
  assert.match(css, /\.animation-mode \.alphabet-keyframe-track input\[type=range\]/);
  assert.match(css, /\.animation-mode \.alphabet-keyframe-markers/);
});

test('Animation Scene List and Transform Inspector open only from their shared icon switcher', () => {
  assert.match(app, /const \[animationDock, setAnimationDock\] = useState<'scene' \| 'transform' \| null>\(null\)/);
  assert.match(app, /className="animation-panel-switcher"/);
  assert.match(app, /animationDock==='scene' && <aside className="animation-scene-list animation-floating-panel"/);
  assert.match(app, /animationDock==='transform' && <aside className="animation-transform-inspector animation-floating-panel"/);
  assert.match(app, /setAnimationDock\(value=>value==='scene'\?null:'scene'\)/);
  assert.match(app, /setAnimationDock\(value=>value==='transform'\?null:'transform'\)/);
  assert.match(css, /\.animation-panel-switcher/);
});

test('Animation workspace uses the canonical horizontal playback and Alphabet State replacement', () => {
  const layout = css.slice(css.lastIndexOf('/* Canonical Animation Timeline layout'));
  assert.match(layout, /\.animation-state-layout\{[\s\S]*?flex-direction:row/);
  assert.match(layout, /\.timeline-playback-panel\{[\s\S]*?flex:0 0 112px/);
  assert.match(layout, /\.timeline-editor-stack\{[\s\S]*?flex:1 1 0/);
  assert.match(css, /\.animation-gizmo-tools\.animation-floating-gizmo\{top:7px!important;bottom:auto!important;left:50%/);
});

test('Timeline toolbar actions remain real actions with clear state feedback', () => {
  assert.match(app, /onClick=\{undo\} title="Undo last scene or keyframe edit"/);
  assert.match(app, /onClick=\{redo\} title="Redo last scene or keyframe edit"/);
  assert.match(app, /onClick=\{copyFrame\}/);
  assert.match(app, /onClick=\{pasteFrame\}/);
  assert.match(app, /onClick=\{\(\)=>setShowGhostPreview\(v=>!v\)\}/);
  assert.match(app, /Add a marker at the current frame/);
  assert.match(app, /timelineTool==='dope'/);
  assert.match(app, /timelineTool==='graph'/);
});

test('Timeline event markers use the selected State ruler coordinate system', () => {
  assert.match(app, /timelineMarkers\.filter\(marker=>marker\.frame>=activeSequenceRange\.start&&marker\.frame<=activeSequenceRange\.end\)/);
  assert.match(app, /marker\.frame-activeSequenceRange\.start/);
});


test('Playback panel sits at the left of the Alphabet State workspace in one horizontal row', () => {
  const layout = css.slice(css.lastIndexOf('/* Canonical Animation Timeline layout'));
  assert.match(layout, /\.animation-state-layout\{[\s\S]*?flex-direction:row/);
  assert.match(layout, /\.timeline-playback-panel\{[\s\S]*?flex:0 0 112px/);
  assert.match(layout, /\.timeline-editor-stack\{[\s\S]*?flex:1 1 0/);
  assert.match(layout, /\.alphabet-state-panel\{[\s\S]*?flex:1 1 0/);
  assert.match(layout, /\.alphabet-state-keyframe-ruler\{[\s\S]*?flex:1 1 0/);
});

test('Keyframe diamonds and their frame numbers are rendered inside the selected State ruler', () => {
  const selectedRuler = app.slice(app.indexOf('className="alphabet-state-keyframe-ruler"'), app.indexOf('className="alphabet-state-keyframe-empty"'));
  assert.match(selectedRuler, /className="alphabet-keyframe-markers"/);
  assert.match(selectedRuler, /className="keyframe-diamond">◆<\/span>/);
  assert.match(selectedRuler, /className="keyframe-frame-number">\{at\}<\/span>/);
  assert.match(selectedRuler, /aria-label=\{'Select keyframe at frame ' \+ at\}/);
  assert.match(css, /\.alphabet-keyframe-markers\{[\s\S]*?inset:0 4\.5px/);
  assert.match(css, /\.animation-mode \.alphabet-keyframe-markers button \.keyframe-frame-number/);
  assert.match(css, /\.animation-mode \.alphabet-keyframe-markers button\{[\s\S]*?transform:translate\(-50%,-50%\)/);
});


test('Selected State keyframe ruler is nested inside the Alphabet State panel with room for frame labels', () => {
  const alphabetPanel = app.slice(app.indexOf('className="alphabet-state-panel"'), app.indexOf('className="alphabet-state-keyframe-empty"'));
  assert.match(alphabetPanel, /className="alphabet-state-keyframe-ruler"/);
  assert.match(alphabetPanel, /className="alphabet-keyframe-markers"/);
  assert.match(alphabetPanel, /className="keyframe-frame-number">\{at\}<\/span>/);
  const layout = css.slice(css.lastIndexOf('/* Canonical Animation Timeline layout'));
  assert.match(layout, /\.alphabet-state-panel\{[\s\S]*?min-height:0/);
  assert.match(layout, /\.alphabet-state-keyframe-ruler\{[\s\S]*?min-height:0/);
  assert.match(layout, /\.alphabet-state-keyframe-scroll\{[\s\S]*?flex:1 1 0/);
  assert.doesNotMatch(css, /\.animation-mode \.alphabet-state-panel\s*\{[^}]*min-height:104px/);
  assert.doesNotMatch(css, /\.animation-mode \.alphabet-state-panel \.alphabet-state-keyframe-ruler\s*\{[^}]*min-height:58px/);
});

test('Alphabet Ruler owns the only expanded Keyframe Timeline; detached legacy timeline selectors are retired', () => {
  const rulerStart = app.indexOf('className="alphabet-state-keyframe-ruler"');
  const rulerEnd = app.indexOf('className="alphabet-state-keyframe-empty"');
  assert.ok(rulerStart > app.indexOf('className="alphabet-state-scroll"'));
  assert.ok(rulerEnd > rulerStart);
  const ruler = app.slice(rulerStart, rulerEnd);
  assert.match(ruler, /className="alphabet-keyframe-track"/);
  assert.match(ruler, /className="alphabet-keyframe-markers"/);
  assert.match(ruler, /className="keyframe-diamond"/);
  assert.match(ruler, /className="keyframe-frame-number"/);
  assert.equal((app.match(/className="alphabet-keyframe-track"/g)||[]).length,1);
  for (const retired of ['state-ruler-panel','state-ruler-scroll','timeline-track-row','timeline-track','timeline-markers']) {
    assert.ok(!app.includes(retired), 'retired component class remains in App.tsx: '+retired);
    assert.ok(!css.includes('.'+retired), 'retired CSS selector remains: '+retired);
  }
  assert.match(css,/\.alphabet-keyframe-track-row\{[^}]*46px/);
  assert.match(css,/\.alphabet-keyframe-track\{[^}]*height:42px/);
});


test('Dope Sheet removes the detached lower keyframe timeline and compacts to its edit controls', () => {
  assert.doesNotMatch(app, /className="timeline-object-tracks"/);
  assert.doesNotMatch(app, /className="timeline-object-row"/);
  assert.match(app, /className="timeline-dope-sheet"/);
  assert.match(app, /moveSelectedKeyframe\(-1\)/);
  assert.match(app, /moveSelectedKeyframe\(1\)/);
  assert.match(app, /onClick=\{deleteFrame\}/);
  assert.doesNotMatch(css, /\.timeline-object-tracks|\.timeline-object-row/);
  assert.match(css, /\.timeline-dope-sheet\{display:flex;flex:0 0 auto/);
  assert.match(css, /\.timeline-graph-editor\{display:flex;flex:1/);
});
