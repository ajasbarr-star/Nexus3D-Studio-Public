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
  assert.doesNotMatch(app, /alphabet-state-mini-key/);
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
  assert.doesNotMatch(app, /alphabet-state-mini-key/);
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
  assert.doesNotMatch(ruler, /alphabet-state-mini-key/);
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


test('Alphabet State frame sliders remain embedded in each horizontally scrollable state ruler without a separate keyframe scroll area', () => {
  assert.match(app, /State \" \+ state.label \+ \" frame slider/);
  assert.doesNotMatch(app, /alphabet-state-mini-key/);
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

test('Alphabet State 3D markers select their matching state only in the Animation Viewport', () => {

  assert.equal(app.split('intersectObjects(Array.from(alphabetStateMarkers.values()), false)').length - 1, 2);
  assert.equal(app.split('setSelectedSequenceState(stateId)').length - 1, 1);
  assert.ok(app.includes("if (!runtime.current?.animationView) return;"));
  assert.ok(app.includes("from Animation Viewport"));
  assert.ok(app.includes("if (alphabetMarkerHit) return;"));
  assert.ok(app.includes("startFrame=startFrame"));
  assert.ok(app.includes("setCurrentFrame(Number(marker.userData.startFrame) || 1)"));
});


test('Alphabet State strip uses native horizontal swipe and the enlarged 58px keyframe ruler', () => {

  assert.match(css, /\.alphabet-state-scroll\{[\s\S]*?touch-action:pan-x/);
  assert.match(css, /\.alphabet-state-mini-ruler\{[\s\S]*?height:56px!important;min-height:56px!important/);
  assert.match(css, /\.alphabet-state-item \.alphabet-state-handle[\s\S]*?height:48px!important;min-height:48px!important/);

});


test('Selected Alphabet State marker gets a distinct highlight in the Animation workspace', () => {

  assert.equal(app.split('setSelectedAlphabetStateMarker?.(stateId)').length - 1, 1);
  assert.ok(app.includes('setSelectedAlphabetStateMarker, syncViewportControls'));
  assert.ok(app.includes('markerCanvas=canvas'));
  assert.ok(app.includes('markerTexture=texture'));
  assert.ok(app.includes("strokeStyle = selected ? '#ffe45c' : '#43dfff'"));
  assert.ok(app.includes("fillStyle = selected ? '#fff4a6' : '#e8fbff'"));
  assert.ok(app.includes('selected ? 1.68 : 1.55'));
  assert.ok(app.includes('setSelectedAlphabetStateMarker?.(selected3DAlphabetMarkerId)'));
});

test('Alphabet State 3D markers select their owning object and attach the shared transform gizmo', () => {

  assert.equal(app.split("const ownerId = String(marker.userData.ownerObjectId || '');").length - 1, 1);
  assert.ok(app.includes('if (owner) selectObject(owner);'));
  assert.ok(app.includes("transform.attach(obj)"));
  assert.ok(app.includes("const selectAlphabetState = (state: typeof sequenceStates[number])"));
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
  assert.match(css, /\.alphabet-state-mini-ruler\{flex-shrink:0;max-width:none!important(?:;|\})/);
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
  assert.equal(app.split('setSelected3DAlphabetMarkerId(stateId)').length - 1, 1);
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


test('Alphabet State timeline ruler uses numeric frame labels and graduated minor, medium and major ticks', () => {

  assert.match(app, /const getCustomRulerTicks = \(rulerWidth: number\) =>/);
  assert.match(app, /getCustomRulerTicks\(sequenceRulerDisplayWidths\[state\.id\] \|\| 96\)\.map\(\(tick,index\)=>\s*<span key=\{index\} style=\{\{left:tick\.position\+"%"\}\}/);
  assert.match(app, /getCustomRulerTicks\(sequenceRulerDisplayWidths\[state\.id\] \|\| 96\)\.map\(\(tick,index\)=>\s*<i key=\{"major-"\+index\} className="major" style=\{\{left:tick\.position\+"%"\}\}/);
  assert.match(app, /index%5===0\?"medium":"minor"/);
  assert.match(css, /\.alphabet-state-ruler-labels span/);
  assert.match(css, /\.alphabet-state-ruler-ticks i\.medium/);
  assert.match(css, /\.alphabet-state-ruler-ticks i\.major/);
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

test('Timeline panel preserves its original footprint and stays permanently bottom anchored', () => {

  const canonical = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.match(canonical, /\.timeline-panel\{[\s\S]*?position:fixed!important/);
  assert.match(canonical, /height:148px!important;min-height:136px!important/);
  assert.match(canonical, /max-height:min\(42vh,calc\(100dvh - 16px - env\(safe-area-inset-bottom\)\)\)!important/);
  assert.match(canonical, /@media\(max-height:430px\)[\s\S]*?height:126px!important;min-height:118px!important/);

});


test('Timeline ruler uses graduated frame ticks, a taller anchored track, and compact transport controls', () => {

  assert.match(app, /getCustomRulerTicks\(sequenceRulerDisplayWidths\[state\.id\] \|\| 96\)/);
  assert.match(css, /\.timeline-panel\{[\s\S]*?height:148px!important;min-height:136px!important/);
  assert.match(css, /\.alphabet-state-scroll\{[\s\S]*?flex:1 1 58px!important/);
  assert.match(css, /\.alphabet-state-mini-ruler\{[\s\S]*?height:56px!important;min-height:56px!important/);
  assert.match(css, /\.timeline-playback-panel\{display:flex!important;flex:0 0 112px!important/);
  assert.match(css, /\.timeline-custom-range-controls\{display:flex!important;flex:0 0 20px!important/);

});


test('Timeline Add Keyframe action lives in the Dope Sheet toolbar, not inside the State ruler', () => {
  assert.match(app, /timeline-add-keyframe.*captureRef\.current/);
  const ruler = app.slice(app.indexOf('className={"alphabet-state-mini-ruler'), app.indexOf('className="alphabet-state-add"'));
  assert.doesNotMatch(ruler, /alphabet-state-mini-key/);
  assert.match(css, /\.timeline-tool-row \.timeline-add-keyframe/);
});

test('Playback controls remain compact in one horizontal row', () => {

  const layout = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.match(layout, /\.timeline-playback-panel \.timeline-transport\{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important/);
  assert.match(layout, /\.timeline-playback-panel \.timeline-transport button\{flex:0 0 19px!important/);

});

test('Selected Alphabet State ruler keeps frame labels and ticks horizontal while scrubbing remains horizontal', () => {

  const layout = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.ok(layout.includes(".alphabet-state-mini-ruler .alphabet-state-ruler-scale{position:absolute!important;z-index:2!important;top:2px!important;left:12px!important;right:12px!important"));
  assert.ok(layout.includes(".alphabet-state-mini-ruler .alphabet-state-ruler-labels{position:absolute!important;inset:0!important;display:block!important"));
  assert.ok(layout.includes(".alphabet-state-mini-ruler .alphabet-state-ruler-ticks{position:absolute!important;left:0!important;right:0!important;top:50%!important"));
  assert.ok(layout.includes(".alphabet-state-mini-ruler .alphabet-state-mini-markers{position:absolute!important;z-index:4!important;top:2px!important;left:5px!important;right:5px!important"));
  assert.ok(layout.includes(".alphabet-state-mini-ruler input[type=range]"));
  assert.ok(layout.includes("writing-mode:horizontal-tb!important"));
  assert.ok(layout.includes("touch-action:pan-x!important"));
  assert.ok(app.includes("onChange={event=>setCurrentFrame(Number(event.target.value))}"));
});

test('Alphabet State frame ranges are contiguous without sharing the boundary frame', () => {
  assert.match(app, /const start = cursor; const end = start \+ Math\.max\(1, state\.width\) - 1/);
  assert.match(app, /cursor = end \+ 1/);
});


test('Horizontal ruler ticks are individually positioned across the track and State B starts after State A ends', () => {
  assert.match(app, /style=\{\{left:\(index\/Math\.max\(1,Math\.round\(state\.width\)\)\*100\)\+"%"\}\}/);
  assert.match(app, /const nextEnd = previousEnd \+ nextState\.width - 1/);
  assert.match(app, /const start = cursor; const end = start \+ Math\.max\(1, state\.width\) - 1/);
  assert.match(app, /cursor = end \+ 1/);
});


test('Opening an Alphabet State reveals a horizontal numbered ruler beside its letter', () => {

  assert.ok(app.includes("sequenceRulerDisplayWidths[state.id] || 96"));
  assert.ok(app.includes("previous[state.id] || 96"));
  assert.ok(app.includes("getCustomRulerTicks(sequenceRulerDisplayWidths[state.id] || 96)"));
  assert.ok(css.includes(".alphabet-state-mini-ruler .alphabet-state-ruler-labels span{position:absolute!important;top:50%!important"));
  assert.ok(css.includes(".alphabet-state-mini-ruler .alphabet-state-ruler-scale{position:absolute!important;z-index:2!important;top:2px!important;left:12px!important;right:12px!important"));
  assert.ok(css.includes(".alphabet-state-mini-ruler .alphabet-state-ruler-ticks{position:absolute!important;left:0!important;right:0!important;top:50%!important"));
  assert.ok(css.includes("writing-mode:horizontal-tb!important"));
  assert.ok(app.includes("top:'50%'"));
});

test('Add Keyframe stays immediately beside Dope Sheet in the Timeline tools row', () => {
  const toolbar = app.slice(app.indexOf('className="timeline-tool-row"'), app.indexOf('className="alphabet-state-panel"'));
  assert.ok(toolbar.indexOf('DOPE SHEET') < toolbar.indexOf('timeline-add-keyframe'));
  assert.ok(toolbar.indexOf('timeline-add-keyframe') < toolbar.indexOf('GRAPH'));
  assert.match(app, /timeline-add-keyframe.*captureRef\.current/);
});

test('Frame ruler labels every frame in sequence with graduated ticks at 5-frame intervals', () => {

  assert.match(app, /getCustomRulerTicks\(sequenceRulerDisplayWidths\[state\.id\] \|\| 96\)/);
  assert.match(app, /index%5===0\?"medium":"minor"/);
  assert.match(app, /left:\(index\/Math\.max\(1,Math\.round\(state\.width\)\)\*100\)\+"%"/);
  assert.doesNotMatch(app, /left:\(index\/3\*100\)\+"%"/);
});


test('Custom START and END use buffered editable decimal inputs and independent s/m units', () => {
  assert.match(app, /BufferedNumberInput ariaLabel="Custom ruler start time" value=\{customRulerStart\} step=\{0\.01\}/);
  assert.match(app, /BufferedNumberInput ariaLabel="Custom ruler end time" value=\{customRulerEnd\} step=\{0\.01\}/);
  assert.match(app, /setCustomRulerStart\(Math\.max\(0,value\)\)/);
  assert.match(app, /setCustomRulerEnd\(Math\.max\(0,value\)\)/);
  assert.match(app, /aria-label="Custom ruler start unit"/);
  assert.match(app, /aria-label="Custom ruler end unit"/);
  assert.match(app, /const toSeconds = \(value: number, unit: 's' \| 'm'\)/);
  assert.match(app, /unit === 'm' \? 60 : 1/);
  assert.match(app, /getCustomRulerTicks\(sequenceRulerDisplayWidths\[state\.id\] \|\| 96\)/);
  assert.match(app, /customRulerStartUnit === customRulerEndUnit \? customRulerStartUnit : 's'/);
});

test('Custom ruler values persist in project data while legacy projects receive safe defaults', () => {
  assert.match(app, /customRulerStart, customRulerStartUnit, customRulerEnd, customRulerEndUnit/);
  assert.match(app, /setCustomRulerStart\(Math\.max\(0, Number\.isFinite\(Number\(settings\.customRulerStart\)\) \? Number\(settings\.customRulerStart\) : 0\)\)/);
  assert.match(app, /setCustomRulerEnd\(Math\.max\(0, Number\.isFinite\(Number\(settings\.customRulerEnd\)\) \? Number\(settings\.customRulerEnd\) : 0\)\)/);
});

test('Timeline layout keeps its bottom anchor visible with a bounded, internally scrollable State strip', () => {
  const canonical = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.match(canonical, /position:fixed!important/);
  assert.match(canonical, /bottom:max\(8px,env\(safe-area-inset-bottom\)\)!important/);
  assert.match(canonical, /max-height:min\(42vh,calc\(100dvh - 16px - env\(safe-area-inset-bottom\)\)\)!important/);
  assert.match(canonical, /\.animation-state-layout\{[\s\S]*?min-height:0!important;overflow:hidden!important/);
  assert.match(canonical, /\.alphabet-state-scroll\{[\s\S]*?overflow-x:auto!important;overflow-y:hidden!important/);
});


test('Custom time labels use four evenly spaced ruler positions and include exact START and END endpoints', () => {

  assert.match(app, /const getCustomRulerTicks = \(rulerWidth: number\) =>/);
  assert.match(app, /const start = toSeconds\(customRulerStart, customRulerStartUnit\) \/ unitFactor/);
  assert.match(app, /const end = toSeconds\(customRulerEnd, customRulerEndUnit\) \/ unitFactor/);
  assert.match(app, /values\.push\(end\)/);
  assert.match(app, /label: String\(Number\(value\.toFixed\(2\)\)\) \+ displayUnit/);
});

test('Timeline ruler positions graduated tick lines at the top and centers custom time labels', () => {
  const layout = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.match(layout, /\.alphabet-state-mini-ruler \.alphabet-state-ruler-ticks\{[\s\S]*?top:50%!important/);
  assert.match(layout, /\.alphabet-state-mini-ruler \.alphabet-state-ruler-labels span\{position:absolute!important;top:50%!important/);
});

test('Add Keyframe icon turns pink when the selected object has a keyframe at the current frame', () => {
  assert.match(app, /Object\.prototype\.hasOwnProperty\.call\(keyframes\[selected\] \|\| \{\}, frame\)/);
  assert.match(app, /has-current-keyframe/);
  assert.match(css, /\.timeline-tool-row \.timeline-add-keyframe\.has-current-keyframe\{color:#ff72c8!important/);
});


test('REC and LOOP controls align in the Timeline tools row beside the Alphabet State Delete icon', () => {
  const toolbar = app.slice(app.indexOf('className="timeline-tool-row"'), app.indexOf('className="alphabet-state-panel"'));
  assert.ok(toolbar.indexOf('timeline-record-toggle') < toolbar.indexOf('timeline-delete-state'));
  assert.ok(toolbar.indexOf('timeline-loop-toggle') < toolbar.indexOf('timeline-delete-state'));
  const transport = app.slice(app.indexOf('className="timeline-transport"'), app.indexOf('</div>', app.indexOf('className="timeline-transport"')));
  assert.doesNotMatch(transport, /timeline-record-toggle|timeline-loop-toggle/);
  assert.match(css, /\.timeline-playback-panel\{display:flex!important;flex:0 0 112px!important;width:112px!important/);
  assert.match(css, /\.timeline-tools-panel \.timeline-record-toggle/);
  assert.match(css, /\.timeline-tools-panel \.timeline-loop-toggle/);
});


test('Timeline ruler labels and four major ticks share the exact same responsive percentage positions', () => {

  assert.ok(app.includes('getCustomRulerTicks(sequenceRulerDisplayWidths[state.id] || 96)'));
  assert.ok(app.includes('left:tick.position+"%"'));
  assert.ok(app.includes('tick.label'));
  assert.ok(app.includes('className="major"'));
  assert.ok(app.includes('left:tick.position+"%"'));
  const canonical = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.ok(canonical.includes("left:12px!important;right:12px!important"));
  assert.ok(canonical.includes(".alphabet-state-mini-ruler .alphabet-state-ruler-ticks{position:absolute!important;left:0!important;right:0!important;top:50%!important"));
});

test('Keyframe diamonds align with the ruler center labels while the scrubber remains in its own touch lane', () => {

  assert.ok(app.includes('className="alphabet-state-mini-markers" aria-label="Keyframe markers"'));
  assert.ok(app.includes('className={"alphabet-state-keyframe-marker "'));
  assert.ok(app.includes('className="alphabet-state-scrubber"'));
  assert.ok(app.includes('onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setSelectedKeyframe'));
  const layout = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.ok(layout.includes('.alphabet-state-mini-markers{position:absolute!important;z-index:4!important;top:2px!important;left:5px!important;right:5px!important;bottom:auto!important;width:auto!important;height:23px!important'));
  assert.ok(layout.includes('.alphabet-state-mini-markers .alphabet-state-keyframe-marker{'));
  assert.ok(layout.includes('border:1px solid #ff4fb8!important'));
  assert.ok(layout.includes('.alphabet-state-ruler-scale{position:absolute!important;z-index:2!important;top:2px!important;left:12px!important;right:12px!important'));
  assert.ok(layout.includes('.alphabet-state-scrubber{position:absolute!important;z-index:1!important;top:45px!important'));
});

test('Dragging the scrubber only changes the current frame and cannot create keyframes', () => {
  const ruler = app.slice(app.indexOf('className={"alphabet-state-mini-ruler'), app.indexOf('className="alphabet-state-add"'));
  assert.match(ruler, /className="alphabet-state-scrubber"[^>]*onChange=\{event=>setCurrentFrame\(Number\(event\.target\.value\)\)\}/);
  assert.doesNotMatch(ruler, /captureRef\.current\(\)|setKeyframes\(/);
});


test('Alphabet State letter tap stays compact and ruler expansion preserves the horizontal scroll origin', () => {
  assert.match(app, /startWidth: sequenceRulerDisplayWidths\[stateId\] \|\| 96/);
  assert.match(app, /scrollLeft: timelineScrollRef\.current\?\.scrollLeft \|\| 0/);
  assert.match(app, /timelineScrollRef\.current\.scrollLeft = drag\.scrollLeft/);
  const handler = app.slice(app.indexOf('const handleAlphabetStateHandleClick ='), app.indexOf('const [pendingStateChoice'));
  assert.ok(handler.includes('selectAlphabetState(state)'));
  assert.doesNotMatch(handler, /setSequenceRulerDisplayWidths|setCurrentFrame/);
  assert.match(css, /overflow-anchor:none!important/);
});

test('Alphabet State ruler endpoint labels reset inherited right positioning and remain centered on endpoint ticks', () => {
  const layout = css.slice(css.indexOf('/* Canonical custom-time Timeline Keyframe layout.'));
  assert.match(layout, /alphabet-state-ruler-labels span\{[\s\S]*?right:auto!important;bottom:auto!important;width:max-content!important/);
  assert.match(app, /position:\s*Math\.max\(0, Math\.min\(100, \(\(value - start\) \/ \(end - start\)\) \* 100\)\)/);
});

test('Alphabet State 3D marker picking uses the active Animation Viewport camera', () => {
  assert.match(app, /const viewCamera = runtime\.current\?\.cameraView \|\| runtime\.current\?\.animationView \? activeCamera : camera/);
  assert.match(app, /if \(!runtime\.current\?\.animationView\) return;/);
  assert.match(app, /setSelected3DAlphabetMarkerId\(stateId\)/);
  assert.match(app, /if \(owner\) selectObject\(owner\)/);
});


test('Tapping an Alphabet State Letter changes only Timeline State selection', () => {
  const selector = app.slice(app.indexOf('const selectAlphabetState ='), app.indexOf('const deleteAlphabetState ='));
  assert.match(selector, /setSelectedSequenceState\(state\.id\)/);
  assert.doesNotMatch(selector, /setCurrentFrame|setExpandedSequenceRulerId|setSelected3DAlphabetMarkerId/);
});
