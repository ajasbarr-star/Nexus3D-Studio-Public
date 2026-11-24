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
  for (const marker of ['timeline-panel','timeline-transport','alphabet-state-mini-ruler','alphabet-state-mini-markers','timeline-settings','captureRef.current()','setPlaying','setCurrentFrame','autoKey','interpolation']) {
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


test('Alphabet States use a compact touch-scroll sequence with an integrated ruler per State', () => {
  assert.match(app, /className="timeline-playback-panel"/);
  assert.match(app, /className="timeline-tools-panel"/);
  assert.match(app, /className="alphabet-state-panel"/);
  assert.match(app, /className="alphabet-state-scroll" ref=\{timelineScrollRef\}/);
  assert.match(app, /alphabet-state-mini-ruler/);
  assert.match(app, /alphabet-state-mini-markers/);
  assert.match(app, /alphabet-state-mini-key/);
  assert.doesNotMatch(app, /STATE \{activeSequenceState\.label\} · RULER/);
  assert.doesNotMatch(app, /alphabet-state-keyframe-scroll/);
  assert.match(app, /const id = addAlphabetState\('independent'\); setPendingStateChoice\(id\)/);
  assert.match(app, /setSelectedSequenceState\(state.id\)/);
  assert.doesNotMatch(app, /sequenceDrag|resizeAlphabetState/);
  assert.match(app, /drag right to expand, left to shrink/);
  assert.match(css, /\.timeline-tools-panel \.timeline-tool-row/);
  assert.match(css, /\.alphabet-state-scroll/);
  assert.match(css, /\.alphabet-state-scroll\{display:flex;flex:0 0 34px;flex-wrap:nowrap/);
  assert.match(css, /\.alphabet-state-item\{flex:0 0 auto/);
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

test('Each Alphabet State ruler displays its own slice of the continuous keyframe range', () => {
  assert.match(app, /setCurrentFrame\(previousEnd\)/);
  assert.match(app, /getSequenceRange\(state\.id\)\.start/);
  assert.match(app, /getSequenceRange\(state\.id\)\.end/);
  assert.match(app, /alphabet-state-mini-ruler/);
  assert.match(app, /alphabet-state-mini-markers/);
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


test('Selected Alphabet State keeps keyframes in its own ruler and the full state strip remains horizontally scrollable', () => {
  assert.match(app, /className="alphabet-state-scroll" ref=\{timelineScrollRef\}/);
  assert.match(app, /State \" \+ state.label \+ \" keyframe timeline/);
  assert.match(app, /alphabet-state-mini-markers/);
  assert.match(app, /alphabet-state-mini-key/);
  assert.match(app, /timelineTool==='tracks' \? null : timelineTool==='dope'/);
  assert.doesNotMatch(app, /alphabet-state-keyframe-scroll/);
  assert.match(css, /\.alphabet-state-scroll\{display:flex;flex:0 0 34px;flex-wrap:nowrap/);
  assert.match(css, /\.alphabet-state-item\{flex:0 0 auto/);
  assert.doesNotMatch(app, /Math\.min\(10000, Math\.round\(nextWidth\)\)/);
});

test('Each Alphabet State mini ruler contains its playhead slider and keyframe diamonds', () => {
  const ruler = app.slice(app.indexOf('className={"alphabet-state-mini-ruler'), app.indexOf('className="alphabet-state-add"'));
  assert.match(ruler, /type="range"/);
  assert.match(ruler, /className="alphabet-state-mini-markers"/);
  assert.match(ruler, /keyframes\[selected\]/);
  assert.match(ruler, /setSelectedKeyframe\(\{id:selected,frame:at\}\)/);
  assert.match(ruler, /className="alphabet-state-mini-key"/);
  assert.match(app, /className="alphabet-state-scroll" ref=\{timelineScrollRef\}/);
  assert.match(app, /captureRef\.current\(\)/);
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

test('Timeline event markers use each State mini-ruler coordinate system', () => {
  assert.match(app, /timelineMarkers\.filter\(marker=>\{const range=getSequenceRange\(state\.id\)/);
  assert.match(app, /alphabet-state-mini-event-marker/);
  assert.match(app, /marker\.frame-range\.start/);
});

test('Playback panel sits at the left of the Alphabet State workspace in one horizontal row', () => {
  const layout = css.slice(css.lastIndexOf('/* Canonical Animation Timeline layout'));
  assert.match(layout, /\.animation-state-layout\{[\s\S]*?flex-direction:row/);
  assert.match(layout, /\.timeline-playback-panel\{[\s\S]*?flex:0 0 112px/);
  assert.match(layout, /\.timeline-editor-stack\{[\s\S]*?flex:1 1 0/);
  assert.match(layout, /\.alphabet-state-panel\{[\s\S]*?flex:1 1 0/);
  assert.match(layout, /\.alphabet-state-keyframe-ruler\{[\s\S]*?flex:1 1 0/);
});

test('Keyframe diamonds and frame numbers are rendered inside each State mini ruler', () => {
  const ruler = app.slice(app.indexOf('className={"alphabet-state-mini-ruler'), app.indexOf('className="alphabet-state-add"'));
  assert.match(ruler, /<span>◆<\/span><small>\{at\}<\/small>/);
  assert.match(ruler, /aria-label=\{'Select keyframe at frame '\+at\}/);
  assert.match(css, /\.alphabet-state-mini-markers/);
  assert.match(css, /\.alphabet-state-mini-markers button/);
});

test('Alphabet State rulers remain inside the horizontally scrollable state panel', () => {
  const panel = app.slice(app.indexOf('className="alphabet-state-panel"'), app.indexOf('</section>', app.indexOf('className="alphabet-state-panel"')));
  assert.match(panel, /className="alphabet-state-scroll"/);
  assert.match(panel, /className={"alphabet-state-mini-ruler/);
  assert.match(panel, /alphabet-state-mini-markers/);
  assert.doesNotMatch(panel, /alphabet-state-keyframe-ruler/);
});

test('Alphabet State sliders replace the detached expanded ruler and legacy timeline selectors', () => {
  assert.match(app, /className={"alphabet-state-mini-ruler/);
  assert.match(app, /alphabet-state-mini-markers/);
  assert.doesNotMatch(app, /alphabet-state-keyframe-ruler/);
  assert.doesNotMatch(app, /alphabet-state-keyframe-scroll/);
  assert.doesNotMatch(app, /className="timeline-object-tracks"/);
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


test('Alphabet State keyframe timelines are embedded in each horizontally scrollable state ruler', () => {
  assert.match(app, /State \" \+ state.label \+ \" frame slider/);
  assert.match(app, /alphabet-state-mini-key/);
  assert.doesNotMatch(app, /alphabet-state-keyframe-scroll/);
  assert.match(css, /\.alphabet-state-item\{flex:0 0 auto/);
});

test('Alphabet State markers attach a labeled circular sprite to the object selected when the state is created', () => {
  assert.match(app, /createAlphabetStateMarker/);
  assert.match(app, /Alphabet State Marker /);
  assert.match(app, /objectId: selectedRef\.current/);
  assert.match(app, /alphabetStateMarkers\.set\(stateId,sprite\)/);
});


test('Alphabet State marker object ownership survives project save and load', () => {
  assert.match(app, /animationSequence: \{ states: sequenceStates/);
  assert.match(app, /objectId: selectedRef\.current/);
  assert.match(app, /objectId: typeof state\.objectId === 'string' \? state\.objectId : undefined/);
  assert.match(app, /ownerMarkerCount \* diameter \* 1\.18/);
});


test('Alphabet State 3D markers are scene-rooted snapshots with larger circles and letters', () => {
  assert.match(app, /scene\.add\(sprite\); sprite\.position\.copy\(worldPosition\)/);
  assert.match(app, /sprite\.scale\.set\(diameter\*1\.55,diameter\*1\.55,1\)/);
  assert.match(app, /canvas\.width=512; canvas\.height=512/);
  assert.match(app, /font='800 220px Arial,sans-serif'/);
  assert.match(app, /ownerObjectId=ownerId/);
  assert.doesNotMatch(app, /owner\.add\(sprite\)/);
});

test('Alphabet State 3D markers select their matching state in both viewports', () => {
  assert.equal((app.match(/intersectObjects\(Array\.from\(alphabetStateMarkers\.values\(\)\), false\)/g) || []).length, 2);
  assert.ok((app.match(/setSelectedSequenceState\(stateId\)/g) || []).length >= 2);
  assert.match(app, /startFrame=startFrame/);
  assert.match(app, /setCurrentFrame\(Number\(marker\.userData\.startFrame\) \|\| 1\)/);
});


test('Alphabet State strip uses native horizontal swipe and the enlarged 58px keyframe ruler', () => {
  const handle = app.slice(app.indexOf('className={"alphabet-state-handle'), app.indexOf('className={"alphabet-state-mini-ruler'));
  assert.match(handle, /onPointerDown/);
  assert.match(handle, /onPointerMove/);
  assert.match(handle, /onPointerUp/);
  assert.match(handle, /onClick/);
  assert.match(css, /\.alphabet-state-scroll\{[\s\S]*?touch-action:pan-x/);
  assert.match(css, /\.alphabet-state-mini-ruler\{[\s\S]*?height:58px;min-height:58px/);
  assert.match(css, /\.alphabet-state-item \.alphabet-state-handle\{[\s\S]*?height:58px;min-height:58px/);
});


test('Selected Alphabet State marker gets a distinct highlight in both 3D viewports', () => {
  assert.equal((app.match(/setSelectedAlphabetStateMarker\?\.\(stateId\)/g) || []).length, 2);
  assert.match(app, /setSelectedAlphabetStateMarker, syncViewportControls/);
  assert.match(app, /markerCanvas=canvas/);
  assert.match(app, /markerTexture=texture/);
  assert.match(app, /strokeStyle = selected \? '#ffe45c' : '#43dfff'/);
  assert.match(app, /fillStyle = selected \? '#fff4a6' : '#e8fbff'/);
  assert.match(app, /selected \? 1\.68 : 1\.55/);
  assert.match(app, /setSelectedAlphabetStateMarker\?\.\(selected3DAlphabetMarkerId\)/);
});

test('Alphabet State 3D markers select their owning object and attach the shared transform gizmo', () => {
  assert.equal((app.match(/const ownerId = String\(marker\.userData\.ownerObjectId \|\| ''\);/g) || []).length, 2);
  assert.ok((app.match(/if \(owner\) selectObject\(owner\);/g) || []).length >= 2);
  assert.match(app, /transform\.attach\(obj\)/);
  assert.match(app, /const selectAlphabetState = \(state: typeof sequenceStates\[number\]\)/);
  const timelineSelection = app.slice(app.indexOf('const selectAlphabetState ='), app.indexOf('const deleteAlphabetState ='));
  assert.doesNotMatch(timelineSelection, /selectObject/);
});

test('Alphabet State ruler width is user-resizable without a fixed upper ceiling and retains native horizontal touch scrolling', () => {
  assert.match(app, /sequenceRulerDisplayWidths/);
  assert.match(app, /style=\{\{width:\(sequenceRulerDisplayWidths\[state\.id\] \|\| 96\)\+"px"\}\}/);
  assert.match(app, /Math\.max\(96, drag\.startWidth \+ delta\)/);
  assert.doesNotMatch(app, /sequenceRulerOffsets|translateX\(/);
  assert.match(css, /\.alphabet-state-scroll\{[\s\S]*?overflow-x:auto!important/);
  assert.match(css, /touch-action:pan-x!important/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
  assert.match(css, /\.alphabet-state-mini-ruler\{flex-shrink:0;max-width:none!important\}/);
});

test('Alphabet State Delete icon removes the selected State, its frame keys and its 3D marker', () => {
  assert.match(app, /className="timeline-delete-state" onClick=\{deleteAlphabetState\}/);
  assert.match(app, /aria-label="Delete selected Alphabet State"/);
  assert.match(app, /const deleteAlphabetState = \(\) =>/);
  assert.match(app, /runtime\.current\?\.removeAlphabetStateMarker\?\.\(state\.id\)/);
  assert.match(app, /setSequenceStates\(remaining\)/);
  assert.match(app, /setTimelineMarkers\(previous => previous\.filter/);
  assert.match(app, /if \(at >= range\.start && at <= range\.end\) delete nextKeys\[objectId\]\[at\]/);
  assert.match(app, /const removeAlphabetStateMarker = \(stateId: string\) =>/);
  assert.match(app, /material\.map\?\.dispose\(\)/);
});


test('Timeline State selection and 3D marker highlighting are independent', () => {
  const selector = app.slice(app.indexOf('const selectAlphabetState ='), app.indexOf('const deleteAlphabetState ='));
  assert.ok(selector.includes('setSelectedSequenceState(state.id)'));
  assert.ok(!selector.includes('selectObject'));
  assert.ok(!selector.includes('setSelected3DAlphabetMarkerId'));
  assert.ok(app.includes("const [selected3DAlphabetMarkerId, setSelected3DAlphabetMarkerId] = useState('')"));
  assert.ok(app.includes('setSelectedAlphabetStateMarker?.(selected3DAlphabetMarkerId)'));
  assert.equal((app.match(/setSelected3DAlphabetMarkerId\(stateId\)/g) || []).length, 2);
});

test('Dope Sheet and Graph open as floating panels above the State ruler', () => {
  assert.ok(app.includes('timeline-floating-tool-panel'));
  assert.ok(app.includes('{timelineTool !== \'tracks\' && <div className="alphabet-state-tools-detail timeline-floating-tool-panel"'));
  assert.ok(css.includes('.timeline-floating-tool-panel'));
  assert.ok(css.includes('position:fixed!important'));
  assert.ok(css.includes('bottom:160px'));
  assert.ok(css.includes('.timeline-floating-tool-panel .timeline-graph-editor'));
});

test('Alphabet State ruler appears as a short preview on tap and expands by dragging its letter', () => {
  assert.ok(app.includes('sequenceRulerDisplayWidths'));
  assert.ok(app.includes('beginSequenceRulerResize'));
  assert.ok(app.includes('moveSequenceRulerResize'));
  assert.ok(app.includes('Math.max(96, drag.startWidth + delta)'));
  assert.ok(!app.includes('alphabet-state-ruler-expand'));
  assert.ok(css.includes('.alphabet-state-mini-ruler.collapsed'));
  assert.ok(css.includes('.alphabet-state-mini-ruler:not(.active)'));
});

test('Keyframe capture stores the selected object plus every bone and control handle in its rig', () => {
  const capture = app.slice(app.indexOf('captureRef.current = () =>'), app.indexOf('const runMode ='));
  assert.ok(capture.includes('obj instanceof THREE.Bone'));
  assert.ok(capture.includes('candidate.userData.rigOwnerId'));
  assert.ok(capture.includes('candidate.userData.controlOwnerObjectId'));
  assert.ok(capture.includes('candidate.userData.rigRootBoneId'));
  assert.ok(capture.includes('targets.set(String(candidate.userData.editorId), candidate)'));
  assert.ok(capture.includes('targets.forEach'));
  assert.ok(app.includes('applySnapshot(obj, left.value)'));
  assert.ok(app.includes('Object.entries(keysRef.current)'));
});

test('Animated orange Bone Control Handles explicitly drive their owning rig during keyframe playback', () => {
  const playback = app.slice(app.indexOf('const applyInterpolatedFrame ='), app.indexOf('useEffect(() => {\n    if (!playing) return;'));
  assert.match(playback, /candidate\.userData\.rigControlMarker/);
  assert.match(playback, /keysRef\.current\[markerId\]/);
  assert.match(playback, /controlOwnerBoneId/);
  assert.match(playback, /r\.solveIK\?\.\(Math\.max\(1, rigBoneCount - 1\), marker\.getWorldPosition\(new THREE\.Vector3\(\)\), marker\)/);
  assert.match(app, /controlHandleOverride\?: THREE\.Object3D/);
  assert.match(app, /controlHandleOverride \|\| \(selectedObject\?\.userData\.rigControlMarker \? selectedObject : null\)/);
});


test('Dragging an Alphabet State letter resizes its ruler right or left while the letter stays in place', () => {
  assert.match(app, /beginSequenceRulerResize/);
  assert.match(app, /moveSequenceRulerResize/);
  assert.match(app, /endSequenceRulerResize/);
  assert.match(app, /onPointerDown=\{event=>beginSequenceRulerResize\(event,state\.id\)\}/);
  assert.match(app, /onPointerMove=\{moveSequenceRulerResize\}/);
  assert.match(app, /onPointerUp=\{endSequenceRulerResize\}/);
  assert.match(app, /Math\.max\(96, drag\.startWidth \+ delta\)/);
  assert.match(app, /drag right to expand, left to shrink/);
  assert.doesNotMatch(app, /sequenceRulerOffsets|beginSequenceRulerDrag|moveSequenceRulerDrag|translateX\(/);
});


test('Alphabet State timeline ruler has a numbered 0–1 scale with short divisions and a long final tick', () => {
  assert.match(app, /alphabet-state-ruler-scale/);
  assert.match(app, /<span>0<\/span>/);
  assert.match(app, /<span>1<\/span>/);
  assert.match(app, /Array\.from\(\{length:9\}/);
  assert.match(css, /\.alphabet-state-ruler-ticks i/);
  assert.match(css, /\.alphabet-state-ruler-ticks::after/);
  assert.match(css, /height:10px;background:#b7edff/);
});

test('Timeline scrubbing uses indexed selectable lookup and keeps the Alphabet State reveal workflow intact', () => {
  assert.match(app, /const selectableById = new Map<string, THREE\.Object3D>\(\)/);
  assert.match(app, /selectableById\.get\(id\)/);
  assert.match(app, /onClick=\{\(\) => handleAlphabetStateHandleClick\(state\)\}/);
  assert.match(app, /onPointerDown=\{event=>beginSequenceRulerResize\(event,state\.id\)\}/);
  assert.match(app, /onPointerMove=\{moveSequenceRulerResize\}/);
  assert.match(app, /onPointerUp=\{endSequenceRulerResize\}/);
  assert.match(app, /drag right to expand, left to shrink/);
});

test('Timeline panel is slightly taller while remaining bottom anchored on compact landscape screens', () => {
  assert.match(css, /\.timeline-panel\{[\s\S]*?height:158px;min-height:150px;max-height:48vh/);
  assert.match(css, /@media\(max-height:430px\)\{\s*\.timeline-panel\{height:158px;min-height:150px/);
  assert.match(css, /\.timeline-panel\{display:flex!important;position:absolute;z-index:14;left:8px;right:8px;bottom:8px/);
});
