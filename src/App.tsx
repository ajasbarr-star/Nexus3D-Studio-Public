import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  Box, Camera, Circle, Copy, Cuboid, Cylinder, Cone, Focus, Globe, Grid2X2,
  Layers, Maximize, Move, Rotate3D, Scaling, Trash2, Magnet,
  Play, Pause, Rewind, ClipboardCopy, ClipboardPaste, Diamond, Undo2, Redo2,
  Film, Lightbulb, X, Check, Eye, EyeOff, Search, ChevronDown, ChevronRight, Download,
  Save, FolderOpen, FileJson, Settings2, Info, Keyboard, Sun, Flashlight, Palette, Upload,
  Sparkles, Waves, Aperture, SlidersHorizontal, CloudFog, ScanEye, Lock, Unlock, Scissors, GitBranch,
} from 'lucide-react';
import './index.css';

type BufferedNumberInputProps = {
  value: number;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  onCommit: (value: number) => void;
};

function BufferedNumberInput({ value, step = 0.1, disabled = false, ariaLabel, onCommit }: BufferedNumberInputProps) {
  const [draft, setDraft] = useState(String(Number.isFinite(value) ? value : 0));
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitted = useRef(Number.isFinite(value) ? value : 0);

  useEffect(() => {
    lastCommitted.current = Number.isFinite(value) ? value : 0;
    if (!focused.current) setDraft(String(lastCommitted.current));
  }, [value]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const commit = (raw: string) => {
    if (raw.trim() === '' || raw === '-' || raw === '+' || raw === '.' || raw === '-.' || raw === '+.') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    lastCommitted.current = parsed;
    onCommit(parsed);
  };

  return (
    <input
      aria-label={ariaLabel}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={draft}
      disabled={disabled}
      onFocus={() => { focused.current = true; }}
      onChange={event => {
        const next = event.target.value;
        const normalized = draft === '0' && /^0[1-9]/.test(next)
          ? next.replace(/^0(?=[1-9])/, '')
          : draft === '0' && (next === '-0' || next === '+0')
            ? next.slice(0, 1)
            : next;
        setDraft(normalized);
        if (timer.current) clearTimeout(timer.current);
        if (normalized.trim() === '' || normalized === '-' || normalized === '+' || normalized === '.' || normalized === '-.' || normalized === '+.') return;
        timer.current = setTimeout(() => commit(normalized), 40);
      }}
      onBlur={() => {
        focused.current = false;
        if (timer.current) clearTimeout(timer.current);
        commit(draft);
        const parsed = Number(draft);
        setDraft(draft.trim() !== '' && Number.isFinite(parsed) ? String(parsed) : String(lastCommitted.current));
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          if (timer.current) clearTimeout(timer.current);
          commit(draft);
          (event.currentTarget as HTMLInputElement).blur();
        }
      }}
      data-step={step}
    />
  );
}

type Item = { id: string; name: string; object: THREE.Object3D; kind: string };
type TransformSnapshot = { position: number[]; rotation: number[]; scale: number[] };
type FrameData = Record<string, TransformSnapshot>;
type Keyframes = Record<string, Record<number, TransformSnapshot>>;
type SceneAction = { label: string; undo: () => void; redo: () => void };
const uid = () => Math.random().toString(36).slice(2, 9);
const sequenceLabel = (index: number) => {
  let n = index + 1;
  let label = '';
  while (n > 0) { n -= 1; label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26); }
  return label;
};
const snapshot = (o: THREE.Object3D): TransformSnapshot => ({
  position: o.position.toArray(),
  rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
  scale: o.scale.toArray(),
});
const applySnapshot = (o: THREE.Object3D, v: TransformSnapshot) => {
  o.position.fromArray(v.position as [number, number, number]);
  o.rotation.set(v.rotation[0], v.rotation[1], v.rotation[2]);
  o.scale.fromArray(v.scale as [number, number, number]);
};

// Smooth canonical quad grids through their four perimeter edges only.
// Render records inside a square are never treated as separate modeling faces.
function smoothQuadGridGeometry(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || geometry.index || position.count % 6 !== 0) return false;

  const groupLookup = new Map<string, number>();
  const groupMembers: number[][] = [];
  const groupCoordinates: number[] = [];
  const adjacency: Set<number>[] = [];
  const groupOfVertex = new Int32Array(position.count);

  const getGroup = (vertexIndex: number) => {
    const x = position.getX(vertexIndex);
    const y = position.getY(vertexIndex);
    const z = position.getZ(vertexIndex);
    const key = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    let group = groupLookup.get(key);
    if (group === undefined) {
      group = groupMembers.length;
      groupLookup.set(key, group);
      groupMembers.push([]);
      groupCoordinates.push(x, y, z);
      adjacency.push(new Set<number>());
    }
    groupMembers[group].push(vertexIndex);
    groupOfVertex[vertexIndex] = group;
    return group;
  };

  for (let base = 0; base < position.count; base += 6) {
    const corners = [base, base + 1, base + 2, base + 5].map(getGroup);
    // The repeated first and third corners are render copies of the same quad corners.
    groupMembers[corners[0]].push(base + 3);
    groupOfVertex[base + 3] = corners[0];
    groupMembers[corners[2]].push(base + 4);
    groupOfVertex[base + 4] = corners[2];
    for (let edge = 0; edge < 4; edge++) {
      const a = corners[edge];
      const b = corners[(edge + 1) % 4];
      if (a === b) continue;
      adjacency[a].add(b);
      adjacency[b].add(a);
    }
  }

  let current = new Float64Array(groupCoordinates);
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(current.length);
    for (let group = 0; group < groupMembers.length; group++) {
      const base = group * 3;
      const neighbors = adjacency[group];
      if (!neighbors.size) {
        next[base] = current[base];
        next[base + 1] = current[base + 1];
        next[base + 2] = current[base + 2];
        continue;
      }
      let x = 0, y = 0, z = 0;
      neighbors.forEach(neighbor => {
        const offset = neighbor * 3;
        x += current[offset];
        y += current[offset + 1];
        z += current[offset + 2];
      });
      const blend = 0.32 / neighbors.size;
      next[base] = current[base] * 0.68 + x * blend;
      next[base + 1] = current[base + 1] * 0.68 + y * blend;
      next[base + 2] = current[base + 2] * 0.68 + z * blend;
    }
    current = next;
  }

  for (let vertex = 0; vertex < position.count; vertex++) {
    const group = groupOfVertex[vertex];
    const offset = group * 3;
    position.setXYZ(vertex, current[offset], current[offset + 1], current[offset + 2]);
  }
  position.needsUpdate = true;
  return true;
}

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState('');
  const selectedRef = useRef('');
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const modeRef = useRef<'translate' | 'rotate' | 'scale'>('translate');
  const [space, setSpace] = useState<'world' | 'local'>('world');
  const spaceRef = useRef<'world' | 'local'>('world');
  const [panel, setPanel] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAccordion, setMenuAccordion] = useState('Project & File');
  const [projectName, setProjectName] = useState('Project.nexus');
  const [saveAccordionOpen, setSaveAccordionOpen] = useState(false);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const [lightLocks, setLightLocks] = useState<Record<string, boolean>>({});
  const [lightPanelOpen, setLightPanelOpen] = useState<Record<string, boolean>>({ Directional: true, Point: true, Spot: true, Ambient: true, Hemisphere: true });
  const [quickPanel, setQuickPanel] = useState<'lights' | 'materials' | 'transform' | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [renderVideoOpen, setRenderVideoOpen] = useState(false);
  const [renderVideoCategory, setRenderVideoCategory] = useState('Resolution');
  const [skyboxOpen, setSkyboxOpen] = useState(false);
  const [skyboxCategory, setSkyboxCategory] = useState('Time-of-Day Presets');
  const [skyboxType, setSkyboxType] = useState<'Procedural Gradient' | 'Solid Color' | 'HDRI Equirectangular'>('Procedural Gradient');
  const [skyColorTop, setSkyColorTop] = useState('#18283b');
  const [skyColorBottom, setSkyColorBottom] = useState('#080c14');
  const [sunAzimuth, setSunAzimuth] = useState(45);
  const [sunElevation, setSunElevation] = useState(45);
  const [sunIntensity, setSunIntensity] = useState(1.5);
  const [cloudDensity, setCloudDensity] = useState(0.2);
  const [renderAspect, setRenderAspect] = useState('16:9');
  const [renderFormat, setRenderFormat] = useState('WebM');
  const [renderFps, setRenderFps] = useState(30);
  const [renderRange, setRenderRange] = useState('Full Animation');
  const [renderLoop, setRenderLoop] = useState(false);
  const [renderAlpha, setRenderAlpha] = useState(false);
  const [renderGrid, setRenderGrid] = useState(true);
  const [renderSkybox, setRenderSkybox] = useState(true);
  const [renderBackground, setRenderBackground] = useState('#0a101b');
  const [renderWatermark, setRenderWatermark] = useState('');
  const [renderRecording, setRenderRecording] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [workStart, setWorkStart] = useState(0);
  const [workEnd, setWorkEnd] = useState(500);
  const [pathTool, setPathTool] = useState(false);
  const [motionPathPoints, setMotionPathPoints] = useState<Array<{x:number;y:number;z:number}>>([]);
  const touchDragId = useRef('');
  const touchPoint = useRef<{ x: number; y: number } | null>(null);
  const [texturePreview, setTexturePreview] = useState('');
  const [hdrPreview, setHdrPreview] = useState('');
  const [particleToggles, setParticleToggles] = useState<Record<string, boolean>>({ Rain: false, Fire: false, Smoke: false, Thunder: false, Dust: false });
  const [lockedSliders, setLockedSliders] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<Record<string, number | string | boolean>>({
    roughness: 0.35, metalness: 0.18, opacity: 1, transmission: 0, clearcoat: 0, sheen: 0,
    emissive: 0, normalDepth: 1, mirrorReflectivity: 1, mirrorRoughness: 0.08,
    bloomStrength: 0, bloomRadius: 0.4, dofFocus: 5, dofBlur: 0,
    chromatic: 0, vignette: 0, fogDensity: 0, fogColor: '#0a101b', godRays: 0, ssao: 0.5,
    pathTracer: false, samples: 16, bounces: 4, rayReflectionIntensity: 1, refractionIndex: 1.5, rayPenumbra: 2, raySamples: 32, rayBounces: 4, lightIntensity: 3, sunElevation: 45,
    ambientIntensity: 1, shadowIntensity: 0.35, shadowSoftness: 2, shadowBias: 0,
    directionalIntensity: 3, directionalAzimuth: 45, directionalElevation: 45,
    spotIntensity: 5, spotDistance: 15, spotDecay: 2, spotAngle: 42, sunIntensity: 1.5, sunSpread: 1,
    lightColor: '#ffffff', mirrorTint: '#d9f3ff', textureColor: '#b6d8ff',
  });
  const [treeSearch, setTreeSearch] = useState('');
  const [dragTargetId, setDragTargetId] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [cameraView, setCameraView] = useState(false);
  const [rigPanelOpen, setRigPanelOpen] = useState(false);
  const [manualRigOpen, setManualRigOpen] = useState(true);
  const [autoIKOpen, setAutoIKOpen] = useState(true);
  const [ikEnabled, setIkEnabled] = useState(false);
  const [ikChainLength, setIkChainLength] = useState(3);
  const [fullscreen, setFullscreen] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [status, setStatus] = useState('Nothing selected');
  const [objectCount, setObjectCount] = useState(0);
  const [snapOn, setSnapOn] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);
  const [animationMode, setAnimationMode] = useState(false);
  const [sequenceStates, setSequenceStates] = useState<Array<{ id: string; label: string; width: number }>>([]);
  const [selectedSequenceState, setSelectedSequenceState] = useState('');
  const [playbackControlsOpen, setPlaybackControlsOpen] = useState(false);
  const sequenceDrag = useRef<{ targetIndex: number; startX: number; startWidth: number; moved: boolean } | null>(null);
  const [animationObjectsOpen, setAnimationObjectsOpen] = useState(true);
  const [shapeLibraryOpen, setShapeLibraryOpen] = useState(false);
  const [timelineOptionsOpen, setTimelineOptionsOpen] = useState(false);
  const [frameRate, setFrameRate] = useState(30);
  const [timeUnit, setTimeUnit] = useState<'seconds' | 'milliseconds'>('seconds');
  const [timelineDuration, setTimelineDuration] = useState(10);
  const [loopPlayback, setLoopPlayback] = useState(true);
  const [interpolation, setInterpolation] = useState('Ease In-Out');
  const [curveWeight, setCurveWeight] = useState(50);
  const [curveTension, setCurveTension] = useState(50);
  const [curveTangent, setCurveTangent] = useState(50);
  const [editMode, setEditMode] = useState<'Object' | 'Vertex' | 'Edge' | 'Face'>('Object');
  const editModeRef = useRef<'Object' | 'Vertex' | 'Edge' | 'Face'>('Object');
  const [meshToolsOpen, setMeshToolsOpen] = useState(false);
  const [activeEditTool, setActiveEditTool] = useState<'Extrude' | 'Subdivide' | 'Smooth' | 'Cutting' | ''>('');
  const [editAmount, setEditAmount] = useState(35);
  const editBaseGeometry = useRef<THREE.BufferGeometry | null>(null);
  const loopCutContext = useRef<{ meshId: string; indices: number[] } | null>(null);
  const subdivideCutCount = useRef<Record<string, number>>({});
  const extrudeContext = useRef<{ meshId: string; indices: number[] } | null>(null);
  const videoRecorder = useRef<MediaRecorder | null>(null);
  const videoChunks = useRef<Blob[]>([]);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(32);
  const frameRef = useRef(32);
  const [autoKey, setAutoKey] = useState(false);
  const autoKeyRef = useRef(false);
  const [keyframes, setKeyframes] = useState<Keyframes>({});
  const keysRef = useRef<Keyframes>({});
  const [copiedFrame, setCopiedFrame] = useState<FrameData | null>(null);
  const [undoStack, setUndoStack] = useState<Keyframes[]>([]);
  const [redoStack, setRedoStack] = useState<Keyframes[]>([]);
  const [actionUndoStack, setActionUndoStack] = useState<SceneAction[]>([]);
  const [actionRedoStack, setActionRedoStack] = useState<SceneAction[]>([]);
  const [selectedKeyframe, setSelectedKeyframe] = useState<{ id: string; frame: number } | null>(null);
  const captureRef = useRef<() => void>(() => {});
  const recordSceneAction = (action: SceneAction) => {
    setActionUndoStack(prev => [...prev.slice(-99), action]);
    setActionRedoStack([]);
  };

  const commitKeys = (next: Keyframes, undoable = true) => {
    if (undoable) {
      setUndoStack(prev => [...prev.slice(-39), JSON.parse(JSON.stringify(keysRef.current))]);
      setRedoStack([]);
    }
    keysRef.current = next;
    setKeyframes(next);
  };

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { spaceRef.current = space; }, [space]);
  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { autoKeyRef.current = autoKey; }, [autoKey]);
  useEffect(() => { keysRef.current = keyframes; }, [keyframes]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a101b');
    scene.fog = new THREE.Fog('#0a101b', 22, 58);
    const camera = new THREE.PerspectiveCamera(52, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 150);
    camera.position.set(7, 6, 9);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    // Editor-only overlays provide visible sub-object selection without changing source mesh materials.
    const subObjectHighlight = new THREE.Group();
    subObjectHighlight.name = 'Editor Sub-object Highlight';
    scene.add(subObjectHighlight);
    const topologyOverlay = new THREE.Group();
    topologyOverlay.name = 'Editor Topology Overlay';
    const loopCutPreview = new THREE.Group();
    loopCutPreview.name = 'Loop Cut Drag Preview';
    scene.add(loopCutPreview);
    topologyOverlay.matrixAutoUpdate = false;
    scene.add(topologyOverlay);
    const clearOverlayGroup = (group: THREE.Group) => { while (group.children.length) { const child = group.children[0]; group.remove(child); child.traverse((node: any) => { node.geometry?.dispose?.(); if (node.material?.dispose) node.material.dispose(); }); } };
    const clearSubObjectHighlight = () => clearOverlayGroup(subObjectHighlight);
    const clearTopologyOverlay = () => { clearOverlayGroup(topologyOverlay); topologyOverlay.userData.targetMesh = null; topologyOverlay.matrix.identity(); topologyOverlay.matrixWorldNeedsUpdate = true; };
    const refreshTopologyOverlay = (mesh?: THREE.Mesh | null) => {
      if (!mesh || !mesh.geometry) { clearTopologyOverlay(); return; }
      clearOverlayGroup(topologyOverlay);
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      const isQuadGrid = Boolean(mesh.userData.nexusQuadGrid && !mesh.geometry.index && position && position.count % 6 === 0);
      let edges: THREE.BufferGeometry;
      if (isQuadGrid && position) {
        // The mesh stores each quad as two triangles [0,1,2, 0,2,3].
        // Draw only the four quad boundaries, nudged slightly outward to prevent z-fighting.
        const edgePositions: number[] = [];
        const seen = new Set<string>();
        const pointAt = (index: number) => new THREE.Vector3().fromBufferAttribute(position, index);
        const pointKey = (point: THREE.Vector3) => [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
        const bounds = mesh.geometry.boundingSphere || (mesh.geometry.computeBoundingSphere(), mesh.geometry.boundingSphere);
        const lineOffset = Math.max(0.0008, (bounds?.radius || 1) * 0.0015);
        const boundsCenter = bounds?.center || new THREE.Vector3();
        for (let base = 0; base < position.count; base += 6) {
          const corners = [base, base + 1, base + 2, base + 5].map(pointAt);
          const normal = corners[1].clone().sub(corners[0]).cross(corners[3].clone().sub(corners[0])).normalize();
          const quadCenter = corners.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(0.25);
          if (normal.dot(quadCenter.clone().sub(boundsCenter)) < 0) normal.negate();
          const offset = normal.multiplyScalar(lineOffset);
          for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
            const a = corners[edgeIndex].clone().add(offset);
            const b = corners[(edgeIndex + 1) % 4].clone().add(offset);
            const ka = pointKey(corners[edgeIndex]), kb = pointKey(corners[(edgeIndex + 1) % 4]);
            const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
            if (seen.has(key)) continue;
            seen.add(key);
            edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
        edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
      } else {
        edges = new THREE.EdgesGeometry(mesh.geometry, 1);
      }
      const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0.98, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      lines.name = 'Editable Topology Overlay'; lines.renderOrder = 1004;
      topologyOverlay.add(lines);
      // Cut loops still define Face Mode region boundaries. Quad-grid edges are
      // already drawn from explicit quad perimeters above, so don't draw duplicates.
      const cutLoops = Array.isArray(mesh.userData.cutLoops) ? mesh.userData.cutLoops as number[][][] : [];
      if (!isQuadGrid) cutLoops.forEach((loop, loopIndex) => {
        if (!Array.isArray(loop) || loop.length < 2) return;
        const points = loop.map(point => new THREE.Vector3(point[0], point[1], point[2]));
        const cut = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x05070a, transparent: true, opacity: 1, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        cut.name = 'Committed Cut Loop ' + (loopIndex + 1);
        cut.renderOrder = 1010;
        topologyOverlay.add(cut);
      });
      topologyOverlay.userData.targetMesh = mesh;
      mesh.updateWorldMatrix(true, false);
      topologyOverlay.matrix.copy(mesh.matrixWorld);
      topologyOverlay.matrixWorldNeedsUpdate = true;
    };
    // Keep the scene free of lights until the user explicitly creates them.
    const grid = new THREE.GridHelper(40, 40, 0x38516e, 0x1b2b40);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.68;
    scene.add(grid);
    const activeCamera = new THREE.PerspectiveCamera(55, camera.aspect, 0.01, 100);
    activeCamera.position.set(0, 2.2, 5.5);
    activeCamera.lookAt(0, 0.8, 0);
    // The camera rig has no mesh geometry, so the initial scene contains no objects.
    const camBody = new THREE.Object3D();
    camBody.name = 'Metallic Camera Object';
    camBody.userData.isCineCamera = true;
    camBody.userData.kind = 'Camera';
    camBody.position.copy(activeCamera.position);
    camBody.quaternion.copy(activeCamera.quaternion);
    camBody.userData.editorId = uid();
    camBody.userData.kind = 'Camera';
    const cameraBodyMat = new THREE.MeshStandardMaterial({ color: 0x273444, metalness: 0.78, roughness: 0.3 });
    const cameraEdgeMat = new THREE.MeshStandardMaterial({ color: 0x71869a, metalness: 0.92, roughness: 0.22 });
    const cameraDarkMat = new THREE.MeshStandardMaterial({ color: 0x101923, metalness: 0.58, roughness: 0.38 });
    const cameraGlassMat = new THREE.MeshStandardMaterial({ color: 0x42c7ef, metalness: 0.7, roughness: 0.14, emissive: 0x073348 });
    const cameraBox = (name: string, size: [number, number, number], pos: [number, number, number], mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
      mesh.name = name; mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; camBody.add(mesh); return mesh;
    };
    cameraBox('Camera chassis', [1.28, 0.72, 0.62], [0, 0, 0], cameraBodyMat);
    cameraBox('Top housing', [0.82, 0.16, 0.48], [0, 0.42, 0.03], cameraDarkMat);
    // Twin vintage film reels with bright machined hubs.
    [-0.36, 0.36].forEach((x, i) => {
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.13, 32), cameraEdgeMat);
      reel.name = 'Film reel ' + (i + 1); reel.position.set(x, 0.62, 0.02); reel.castShadow = true; camBody.add(reel);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.145, 24), cameraDarkMat);
      cap.position.copy(reel.position); cap.rotation.copy(reel.rotation); camBody.add(cap);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.15, 20), cameraEdgeMat);
      hub.position.copy(reel.position); hub.rotation.copy(reel.rotation); camBody.add(hub);
    });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 0.72, 32, 1, false), cameraEdgeMat);
    lens.name = 'Flared cine lens'; lens.rotation.x = -Math.PI / 2; lens.position.set(0, 0.02, -0.57); lens.castShadow = true; camBody.add(lens);
    const lensRim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.055, 12, 32), cameraEdgeMat);
    lensRim.position.set(0, 0.02, -0.94); camBody.add(lensRim);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.255, 32), cameraGlassMat);
    glass.position.set(0, 0.02, -0.948); camBody.add(glass);
    cameraBox('Side emblem plate', [0.045, 0.34, 0.39], [0.66, -0.02, 0.02], cameraEdgeMat);
    const playShape = new THREE.Shape(); playShape.moveTo(-0.075, -0.09); playShape.lineTo(0.09, 0); playShape.lineTo(-0.075, 0.09); playShape.closePath();
    const playMark = new THREE.Mesh(new THREE.ShapeGeometry(playShape), cameraDarkMat);
    playMark.name = 'Play emblem'; playMark.position.set(0.686, 0.03, -0.07); playMark.rotation.y = Math.PI / 2; camBody.add(playMark);
    [-0.15, -0.02, 0.11].forEach((y, i) => {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 20), cameraEdgeMat);
      button.name = 'Adjustment button ' + (i + 1); button.rotation.z = Math.PI / 2; button.position.set(0.71, y, 0.15); camBody.add(button);
    });
    scene.add(camBody);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0.7, 0);
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.minDistance = 2.2;
    orbit.maxDistance = 35;
    const activeOrbit = new OrbitControls(activeCamera, renderer.domElement);
    activeOrbit.enabled = false;
    activeOrbit.enableDamping = true;
    activeOrbit.dampingFactor = 0.08;
    activeOrbit.target.set(0, 0.8, 0);
    activeOrbit.minDistance = 0.25;
    activeOrbit.maxDistance = 50;
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('translate');
    transform.setSpace('world');
    transform.setSize(1.08);
    transform.size = 1.08;
    transform.getHelper().traverse((node: any) => {
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      materials.forEach((material: any) => {
        if ('linewidth' in material) material.linewidth = 3;
      });
    });
    transform.getHelper().visible = false;
    scene.add(transform.getHelper());

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const subObjectPivot = new THREE.Object3D();
    subObjectPivot.name = 'Sub-object Transform Pivot';
    scene.add(subObjectPivot);
    let activeSubSelection: { mesh: THREE.Mesh; indices: number[]; lastWorld: THREE.Vector3; lastQuaternion: THREE.Quaternion; lastScale: THREE.Vector3 } | null = null;
    let subGeometryBefore: THREE.BufferGeometry | null = null;
    const selectable: THREE.Object3D[] = [camBody];
    const rigChains: Array<{ bones: THREE.Bone[]; helper: THREE.SkeletonHelper; target: THREE.Object3D | null }> = [];
    const lightSources: Array<{ type: string; object: THREE.Light; helper?: THREE.Mesh }> = [];
    const lightCounts: Record<string, number> = {};
    const particleSystems: Record<string, THREE.Points> = {};
    const reflectionTarget = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, colorSpace: THREE.SRGBColorSpace });
    const reflectionCamera = new THREE.CubeCamera(0.1, 100, reflectionTarget);
    scene.add(reflectionCamera);
    const syncItems = () => {
      const ordered: THREE.Object3D[] = [];
      const visit = (parent: THREE.Object3D) => parent.children.forEach(child => {
        if (child.userData.editorId && selectable.includes(child)) ordered.push(child);
        visit(child);
      });
      visit(scene);
      selectable.forEach(o => { if (!ordered.includes(o)) ordered.push(o); });
      setItems(ordered.map(o => ({ id: o.userData.editorId, name: o.name, object: o, kind: o.userData.kind || o.type })));
      setObjectCount(selectable.length);
    };
    syncItems();
    const addSceneLight = (type: 'Directional' | 'Point' | 'Spot' | 'Ambient' | 'Hemisphere') => {
      let light: THREE.Light;
      const label = type === 'Directional' ? 'DirectionalLight' : type === 'Point' ? 'PointLight' : type === 'Spot' ? 'Spotlight' : type === 'Ambient' ? 'AmbientLight' : 'HemisphereLight';
      const number = (lightCounts[label] || 0) + 1;
      lightCounts[label] = number;
      const suffix = '_' + number;
      if (type === 'Directional') {
        const l = new THREE.DirectionalLight(0xffffff, 3);
        l.position.set(5, 8, 5); l.castShadow = true; light = l;
      } else if (type === 'Point') {
        const l = new THREE.PointLight(0xffffff, 3, 20, 2);
        l.position.set(1, 3, 1); l.castShadow = true; light = l;
      } else if (type === 'Spot') {
        const l = new THREE.SpotLight(0xffffff, 5, 15, THREE.MathUtils.degToRad(42), 0.35, 2);
        l.position.set(2, 5, 3); l.target.position.set(0, 0, 0); l.castShadow = true; scene.add(l.target); light = l;
      } else if (type === 'Ambient') {
        light = new THREE.AmbientLight(0xffffff, 1);
      } else {
        light = new THREE.HemisphereLight(0xc6e4ff, 0x1a2434, 1.5);
      }
      light.name = label + suffix;
      light.userData.editorId = uid();
      light.userData.kind = 'Light';
      light.userData.lightType = type;
      const helper = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 8),
        new THREE.MeshBasicMaterial({ color: type === 'Directional' ? 0xffd166 : type === 'Ambient' ? 0x75d7ff : 0x70f0dc, wireframe: true })
      );
      helper.name = light.name + '_Helper';
      helper.userData.isLightHelper = true;
      light.add(helper);
      scene.add(light);
      lightSources.push({ type: label, object: light, helper });
      selectable.push(light);
      syncItems();
      selectObject(light);
      setStatus(light.name + ' added');
      return light;
    };
    const applyPreset = (preset: string) => {
      const active = lightSources.filter(l => l.type === 'DirectionalLight' || l.type === 'SpotLight');
      
      const values: Record<string, { color: number; intensity: number; elevation: number; bg: string }> = {
        Morning: { color: 0xffc58a, intensity: 2.4, elevation: 18, bg: '#18283b' },
        Noon: { color: 0xffffff, intensity: 4.5, elevation: 75, bg: '#101c2d' },
        Afternoon: { color: 0xffa66b, intensity: 2.8, elevation: 30, bg: '#241c2c' },
        Night: { color: 0x779cff, intensity: 0.7, elevation: 12, bg: '#050914' },
      };
      const p = values[preset];
      active.forEach(({ object }) => {
        object.color.setHex(p.color);
        object.intensity = p.intensity;
        object.position.y = Math.sin(THREE.MathUtils.degToRad(p.elevation)) * 10;
      });
      lightSources.filter(l => l.type === 'AmbientLight' || l.type === 'HemisphereLight').forEach(({ object }) => { object.intensity = preset === 'Night' ? 0.25 : preset === 'Noon' ? 1.35 : 0.8; });
      scene.background = new THREE.Color(p.bg);
      if (scene.fog) (scene.fog as THREE.Fog).color.setHex(p.bg);
      setSkyColorTop(p.bg);
      setSkyColorBottom(preset === 'Night' ? '#030611' : '#0a1421');
      setStatus(preset + ' lighting preset applied');
    };
    const toggleParticle = (type: string, enabled: boolean) => {
      if (type === 'Thunder') {
        let flash = scene.getObjectByName('Nexus3D_ThunderFlash') as THREE.PointLight | undefined;
        if (enabled && !flash) { flash = new THREE.PointLight(0x9bbcff, 0, 45); flash.name = 'Nexus3D_ThunderFlash'; flash.position.set(0, 8, 0); scene.add(flash); }
        if (flash) flash.intensity = enabled ? 0.8 : 0;
        setParticleToggles(prev => ({ ...prev, [type]: enabled }));
        return;
      }
      if (!particleSystems[type] && enabled) {
        const count = type === 'Rain' ? 900 : type === 'Fire' ? 260 : type === 'Smoke' ? 220 : 420;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) { positions[i * 3] = (Math.random() - 0.5) * 14; positions[i * 3 + 1] = Math.random() * (type === 'Rain' ? 14 : 5); positions[i * 3 + 2] = (Math.random() - 0.5) * 14; }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({ color: type === 'Rain' ? 0x8bd8ff : type === 'Fire' ? 0xff8738 : type === 'Smoke' ? 0x8a9aaa : 0xb8c8d8, size: type === 'Rain' ? 0.045 : type === 'Fire' ? 0.085 : 0.07, transparent: true, opacity: type === 'Smoke' ? 0.28 : 0.8, depthWrite: false, blending: type === 'Fire' ? THREE.AdditiveBlending : THREE.NormalBlending });
        const points = new THREE.Points(geometry, material); points.name = 'Nexus3D_' + type + '_Particles'; points.userData.isParticleSystem = true; particleSystems[type] = points; scene.add(points);
      }
      if (particleSystems[type]) particleSystems[type].visible = enabled;
      setParticleToggles(prev => ({ ...prev, [type]: enabled }));
    };
    const applySettings = (key: string, value: number | string | boolean) => {
      const selectedObject = selectable.find(o => o.userData.editorId === selectedRef.current);
      const selectedLight = selectedObject instanceof THREE.Light ? selectedObject : null;
      const applyMaterial = (material: any) => {
        if (key === 'roughness') material.roughness = Number(value);
        if (key === 'metalness') material.metalness = Number(value);
        if (key === 'opacity') { material.opacity = Number(value); material.transparent = Number(value) < 1; }
        if (key === 'transmission' && 'transmission' in material) material.transmission = Number(value);
        if (key === 'clearcoat' && 'clearcoat' in material) material.clearcoat = Number(value);
        if (key === 'sheen' && 'sheen' in material) material.sheen = Number(value);
        if (key === 'emissive') { material.emissive?.set('#ffffff'); material.emissiveIntensity = Number(value); }
        if (key === 'textureColor' || key === 'mirrorTint') material.color?.set(String(value));
        if (key === 'mirrorReflectivity') { material.metalness = Number(value); material.roughness = Number(settings.mirrorRoughness || 0); if (Number(value) > 0 && 'envMap' in material) { material.envMap = reflectionTarget.texture; material.envMapIntensity = Number(value) * 2; } }
        if (key === 'mirrorRoughness') { material.metalness = Number(settings.mirrorReflectivity || 1); material.roughness = Number(value); }
        material.needsUpdate = true;
      };
      if (selectedObject) selectedObject.traverse((node: any) => {
        if (node.isMesh) (Array.isArray(node.material) ? node.material : [node.material]).forEach(applyMaterial);
      });
      if (key === 'fogDensity' || key === 'fogColor') {
        scene.fog = Number(settings.fogDensity || 0) > 0 ? new THREE.FogExp2(String(settings.fogColor || '#0a101b'), Number(settings.fogDensity || 0) * 0.02) : null;
        scene.background = new THREE.Color(String(settings.fogColor || '#0a101b'));
      }
      if (key === 'lightColor' && selectedLight) selectedLight.color.set(String(value));
      if (key === 'lightIntensity' && selectedLight) selectedLight.intensity = Number(value);
      if (key === 'directionalIntensity' && selectedLight instanceof THREE.DirectionalLight) selectedLight.intensity = Number(value);
      if (key === 'spotIntensity' && selectedLight instanceof THREE.SpotLight) selectedLight.intensity = Number(value);
      if ((key === 'sunIntensity' || key === 'ambientIntensity') && selectedLight instanceof THREE.HemisphereLight) selectedLight.intensity = Number(value);
      if ((key === 'directionalAzimuth' || key === 'directionalElevation' || key === 'sunElevation') && selectedLight instanceof THREE.DirectionalLight) {
        const az = THREE.MathUtils.degToRad(Number(settings.directionalAzimuth || 45));
        const el = THREE.MathUtils.degToRad(Number(settings.directionalElevation || settings.sunElevation || 45));
        selectedLight.position.set(Math.cos(az) * 10, Math.sin(el) * 10, Math.sin(az) * 10);
      }
      if (key === 'spotDistance' && selectedLight instanceof THREE.SpotLight) selectedLight.distance = Number(value);
      if (key === 'spotDecay' && selectedLight instanceof THREE.SpotLight) selectedLight.decay = Number(value);
      if (key === 'spotAngle' && selectedLight instanceof THREE.SpotLight) selectedLight.angle = THREE.MathUtils.degToRad(Number(value));
      if (key === 'shadowIntensity') renderer.shadowMap.enabled = Number(value) > 0;
      if (key === 'shadowBias') lightSources.forEach(({ object }) => { if ((object as any).shadow) (object as any).shadow.bias = Number(value); });
      if (key === 'shadowSoftness' || key === 'rayPenumbra') lightSources.forEach(({ object }) => { if ((object as any).shadow) (object as any).shadow.radius = Number(value); });
      if (key === 'bloomStrength') renderer.toneMappingExposure = 1 + Number(value) * 0.08;
      if (key === 'pathTracer') renderer.toneMappingExposure = value ? 1 : 1.12;
      if (key === 'rayReflectionIntensity' || key === 'refractionIndex') {
        const target = selectable.find(o => o.userData.editorId === selectedRef.current);
        if (target) target.traverse((node: any) => { if (node.isMesh) (Array.isArray(node.material) ? node.material : [node.material]).forEach((mat: any) => {
          if (key === 'rayReflectionIntensity' && Number(mat.metalness || 0) > 0.8 && Number(mat.roughness || 1) < 0.2) mat.envMapIntensity = Number(value);
          if (key === 'refractionIndex' && (Number(mat.transmission || 0) > 0 || mat.transparent)) mat.ior = Number(value);
          mat.needsUpdate = true;
        }); });
      }
    };
    const reparentObject = (child: THREE.Object3D, parent?: THREE.Object3D, record = true) => {
      const targetParent = parent || scene;
      if (child === targetParent || child.getObjectById(targetParent.id) || targetParent === child.parent) return;
      const previousParent = child.parent || scene;
      const attachTo = (target: THREE.Object3D) => { scene.updateMatrixWorld(true); target.attach(child); syncItems(); };
      attachTo(targetParent);
      if (record) recordSceneAction({ label: 'Reparent ' + child.name, undo: () => { attachTo(previousParent); selectObject(child); }, redo: () => { attachTo(targetParent); selectObject(child); } });
      syncItems();
      selectObject(child);
      setStatus(targetParent === scene ? child.name + ' moved to Scene root' : child.name + ' nested under ' + targetParent.name);
    };
    const reorderObject = (child: THREE.Object3D, target: THREE.Object3D, position: 'before' | 'after' | 'inside') => {
      if (!child || !target || child === target || child.getObjectById(target.id)) return;
      if (position === 'inside') { reparentObject(child, target); return; }
      const oldParent = child.parent || scene;
      const targetParent = target.parent || scene;
      const oldIndex = oldParent.children.indexOf(child);
      const targetIndex = targetParent.children.indexOf(target);
      scene.updateMatrixWorld(true);
      if (oldParent !== targetParent) targetParent.attach(child);
      const siblings = targetParent.children;
      const currentIndex = siblings.indexOf(child);
      if (currentIndex >= 0) siblings.splice(currentIndex, 1);
      const newTargetIndex = siblings.indexOf(target);
      siblings.splice(Math.max(0, newTargetIndex + (position === 'after' ? 1 : 0)), 0, child);
      scene.updateMatrixWorld(true);
      syncItems(); selectObject(child);
      recordSceneAction({ label: 'Reorder ' + child.name, undo: () => { scene.updateMatrixWorld(true); oldParent.attach(child); const list = oldParent.children; const at = list.indexOf(child); if (at >= 0) list.splice(at, 1); list.splice(Math.min(Math.max(oldIndex, 0), list.length), 0, child); scene.updateMatrixWorld(true); syncItems(); }, redo: () => { scene.updateMatrixWorld(true); targetParent.attach(child); const list = targetParent.children; const at = list.indexOf(child); if (at >= 0) list.splice(at, 1); list.splice(Math.min(Math.max(targetIndex + (position === 'after' ? 1 : 0), 0), list.length), 0, child); scene.updateMatrixWorld(true); syncItems(); } });
      setStatus(child.name + (position === 'before' ? ' moved above ' : ' moved below ') + target.name);
    };
    const updateLightProperty = (id: string, property: string, value: number | string | boolean) => {
      const light = selectable.find(o => o.userData.editorId === id);
      if (!(light instanceof THREE.Light)) return;
      if (property === 'intensity') light.intensity = Number(value);
      else if (property === 'color') (light as any).color?.set(String(value));
      else if (property === 'distance' && light instanceof THREE.PointLight) light.distance = Math.max(0, Number(value));
      else if (property === 'distance' && light instanceof THREE.SpotLight) light.distance = Math.max(0, Number(value));
      else if (property === 'decay' && (light instanceof THREE.PointLight || light instanceof THREE.SpotLight)) light.decay = Math.max(0, Number(value));
      else if (property === 'angle' && light instanceof THREE.SpotLight) light.angle = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(value), 1, 89));
      else if (property === 'groundColor' && light instanceof THREE.HemisphereLight) light.groundColor.set(String(value));
      else if (property === 'shadowBias' && (light as any).shadow) (light as any).shadow.bias = Number(value);
      else if (property === 'shadowRadius' && (light as any).shadow) (light as any).shadow.radius = Math.max(0, Number(value));
      setStatus(light.name + ' · ' + property + ' updated');
    };
    const toggleLightEnabled = (id: string, enabled: boolean) => {
      const light = selectable.find(o => o.userData.editorId === id);
      if (light instanceof THREE.Light) { light.visible = enabled; setStatus(light.name + (enabled ? ' enabled' : ' disabled')); }
    };
    const toggleVisibility = (obj: THREE.Object3D) => {
      obj.visible = !obj.visible;
      syncItems();
      setStatus(obj.name + (obj.visible ? ' visible' : ' hidden'));
    };
    const selectObject = (obj?: THREE.Object3D) => {
      if (String(obj?.userData?.editorId || '') !== selectedRef.current) clearTopologyOverlay();
      if (!obj) {
        transform.detach();
        transform.getHelper().visible = false;
        setSelected('');
        selectedRef.current = '';
        setStatus('Nothing selected');
        return;
      }
      transform.attach(obj);
      transform.enabled = editModeRef.current === 'Object';
      transform.getHelper().visible = editModeRef.current === 'Object';
      transform.setMode(mode);
      transform.setSpace(space);
      if (obj instanceof THREE.Light) {
        setSettings(prev => ({ ...prev, lightIntensity: obj.intensity, lightColor: '#' + obj.color.getHexString(), ...(obj instanceof THREE.DirectionalLight ? { directionalIntensity: obj.intensity } : {}), ...(obj instanceof THREE.SpotLight ? { spotIntensity: obj.intensity, spotDistance: obj.distance, spotDecay: obj.decay, spotAngle: THREE.MathUtils.radToDeg(obj.angle) } : {}), ...(obj instanceof THREE.HemisphereLight ? { sunIntensity: obj.intensity, ambientIntensity: obj.intensity } : {}) }));
      }
      setSelected(String(obj.userData.editorId || ''));
      selectedRef.current = String(obj.userData.editorId || '');
      if (obj instanceof THREE.Mesh && editModeRef.current !== 'Object') refreshTopologyOverlay(obj);
      setStatus('Selected · ' + obj.name);
    };
    const addObject = (kind: string, name?: string, cloneOf?: THREE.Object3D) => {
      let obj: THREE.Object3D;
      if (cloneOf) {
        obj = cloneOf.clone(true);
        obj.traverse((child: any) => {
          if (child.isMesh) {
            child.geometry = child.geometry.clone();
            child.material = Array.isArray(child.material) ? child.material.map((m: any) => m.clone()) : child.material.clone();
          }
        });
        obj.position.x += 1.25;
      } else {
        const material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setHSL(Math.random() * 0.55 + 0.48, 0.62, 0.58), roughness: 0.35, metalness: 0.18, transmission: 0, clearcoat: 0, sheen: 0 });
        let geometry: THREE.BufferGeometry;
        if (kind === 'Sphere') geometry = new THREE.SphereGeometry(0.68, 32, 20);
        else if (kind === 'Cone') geometry = new THREE.ConeGeometry(0.68, 1.35, 32);
        else if (kind === 'Cylinder') geometry = new THREE.CylinderGeometry(0.62, 0.62, 1.25, 32);
        else if (kind === 'Torus') geometry = new THREE.TorusGeometry(0.62, 0.22, 14, 36);
        else geometry = new THREE.BoxGeometry(1.25, 1.25, 1.25);
        obj = new THREE.Mesh(geometry, material);
        const n = selectable.length;
        obj.position.set(((n % 4) - 1.5) * 1.45, 0.68, Math.floor(n / 4) * -1.5);
        (obj as THREE.Mesh).castShadow = true;
        (obj as THREE.Mesh).receiveShadow = true;
      }
      obj.name = name || kind + ' ' + (selectable.filter(o => o.name.startsWith(kind)).length + 1);
      obj.userData.editorId = uid();
      obj.userData.kind = kind;
      scene.add(obj);
      selectable.push(obj);
      syncItems();
      selectObject(obj);
      recordSceneAction({ label: 'Create ' + obj.name, undo: () => { obj.parent?.remove(obj); const i = selectable.indexOf(obj); if (i >= 0) selectable.splice(i, 1); syncItems(); selectObject(); }, redo: () => { if (!obj.parent) scene.add(obj); if (!selectable.includes(obj)) selectable.push(obj); syncItems(); selectObject(obj); } });
      setStatus(obj.name + ' added');
      return obj;
    };
    const createManualRig = () => {
      const rig = new THREE.Group();
      rig.name = 'Manual Rig ' + (rigChains.length + 1);
      rig.userData.editorId = uid();
      rig.userData.kind = 'Rig';
      const selectedObject = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (selectedObject) rig.position.copy(selectedObject.getWorldPosition(new THREE.Vector3()));
      const bones: THREE.Bone[] = [];
      for (let i = 0; i < 4; i++) {
        const bone = new THREE.Bone();
        bone.name = ['Root Bone', 'Spine Bone', 'Upper Bone', 'End Bone'][i];
        bone.userData.editorId = uid();
        bone.userData.kind = 'Bone';
        if (i > 0) { bone.position.set(0, 0.72, 0); bones[i - 1].add(bone); }
        bones.push(bone);
      }
      rig.add(bones[0]);
      scene.add(rig);
      const helper = new THREE.SkeletonHelper(bones[0]);
      helper.name = rig.name + ' Skeleton';
      (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff);
      scene.add(helper);
      selectable.push(rig, ...bones);
      rigChains.push({ bones, helper, target: null });
      syncItems();
      selectObject(bones[0]);
      setStatus('Manual bone chain created. Select bones in Scene Tree to pose them.');
      return rig;
    };
    const createIKTarget = () => {
      const target = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb45e, wireframe: true }));
      target.name = 'IK Target Handle';
      target.position.set(1.4, 2.1, 0.5);
      target.userData.editorId = uid();
      target.userData.kind = 'IK Target';
      scene.add(target);
      selectable.push(target);
      rigChains.forEach(chain => { chain.target = target; });
      syncItems();
      selectObject(target);
      setStatus('IK target handle created. Move it with the viewport gizmo, then Solve IK.');
      return target;
    };
    const solveIK = (chainLength = 3) => {
      const chain = [...rigChains].reverse().find(entry => entry.target);
      if (!chain || !chain.target) { setStatus('Create a manual bone chain and an IK target first'); return; }
      const bones = chain.bones.slice(Math.max(0, chain.bones.length - Math.max(1, Math.min(chainLength, chain.bones.length))));
      const targetPosition = chain.target.getWorldPosition(new THREE.Vector3());
      for (let iteration = 0; iteration < 12; iteration++) {
        for (let i = bones.length - 1; i >= 0; i--) {
          scene.updateMatrixWorld(true);
          const bone = bones[i];
          const origin = bone.getWorldPosition(new THREE.Vector3());
          const end = chain.bones[chain.bones.length - 1].getWorldPosition(new THREE.Vector3());
          const from = end.sub(origin);
          const to = targetPosition.clone().sub(origin);
          if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) continue;
          const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
          const desiredWorld = bone.getWorldQuaternion(new THREE.Quaternion());
          desiredWorld.premultiply(delta);
          if (bone.parent) bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredWorld));
          else bone.quaternion.copy(desiredWorld);
          bone.updateMatrixWorld(true);
        }
      }
      chain.helper.update();
      syncItems();
      setStatus('Auto-IK solved using ' + bones.length + ' bone joints');
    };
    const removeObject = (obj: THREE.Object3D, preserveForUndo = false) => {
      if (obj === camBody) {
        setStatus('MainCamera is required for CAM view');
        return;
      }
      transform.detach();
      transform.getHelper().visible = false;
      obj.parent?.remove(obj);
      const lightEntry = lightSources.find(entry => entry.object === obj);
      if (lightEntry && obj instanceof THREE.SpotLight) scene.remove(obj.target);
      const lightIndex = lightSources.findIndex(entry => entry.object === obj);
      if (lightIndex >= 0) lightSources.splice(lightIndex, 1);
      selectable.filter(candidate => candidate !== obj && candidate.parent === obj).forEach(child => {
        const childIndex = selectable.indexOf(child);
        if (childIndex >= 0) selectable.splice(childIndex, 1);
      });
      if (!preserveForUndo) obj.traverse((child: any) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose());
          else child.material?.dispose();
        }
      });
      const index = selectable.indexOf(obj);
      if (index >= 0) selectable.splice(index, 1);
      const next = { ...keysRef.current };
      delete next[String(obj.userData.editorId)];
      keysRef.current = next;
      setKeyframes(next);
      syncItems();
      setSelected('');
      selectedRef.current = '';
      setStatus(obj.name + ' deleted');
    };
    let pointerStart: { x: number; y: number; id: number } | null = null;
    let loopCutGesture: { pointerId: number; mesh: THREE.Mesh; indices: number[]; normal: THREE.Vector3; min: number; max: number; projection: number } | null = null;
    let orbitBeforeLoopCut = true;
    let activeOrbitBeforeLoopCut = false;
    const clearLoopCutPreview = () => { while (loopCutPreview.children.length) { const child = loopCutPreview.children[0]; loopCutPreview.remove(child); (child as any).geometry?.dispose?.(); (child as any).material?.dispose?.(); } };
    const updateLoopCutPreview = (event: PointerEvent) => {
      if (!loopCutGesture) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const viewCamera = runtime.current?.cameraView ? activeCamera : camera;
      raycaster.setFromCamera(pointer, viewCamera);
      const hit = raycaster.intersectObject(loopCutGesture.mesh, false)[0];
      if (!hit) return;
      const localHit = loopCutGesture.mesh.worldToLocal(hit.point.clone());
      loopCutGesture.projection = THREE.MathUtils.clamp(localHit.dot(loopCutGesture.normal), loopCutGesture.min + (loopCutGesture.max-loopCutGesture.min)*0.01, loopCutGesture.max - (loopCutGesture.max-loopCutGesture.min)*0.01);
      clearLoopCutPreview();
      const geometry = loopCutGesture.mesh.geometry;
      const pos = geometry.getAttribute('position');
      const index = geometry.index;
      const count = index ? index.count : pos.count;
      const localPoint = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i);
      const segments: THREE.Vector3[] = [];
      const epsilon = Math.max(1e-7, (loopCutGesture.max-loopCutGesture.min)*1e-6);
      for (let i = 0; i + 2 < count; i += 3) {
        const tri = [localPoint(i), localPoint(i+1), localPoint(i+2)];
        const crossings: THREE.Vector3[] = [];
        for (let edge = 0; edge < 3; edge++) {
          const a = tri[edge], b = tri[(edge+1)%3];
          const da = a.dot(loopCutGesture.normal)-loopCutGesture.projection;
          const db = b.dot(loopCutGesture.normal)-loopCutGesture.projection;
          if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) crossings.push(a.clone().lerp(b, da/(da-db)));
        }
        if (crossings.length >= 2) segments.push(loopCutGesture.mesh.localToWorld(crossings[0]), loopCutGesture.mesh.localToWorld(crossings[1]));
      }
      if (segments.length) {
        const preview = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segments), new THREE.LineBasicMaterial({ color: 0xff35b8, transparent: true, opacity: 1, depthTest: true }));
        preview.name = 'Loop Cut Pink Drag Preview'; preview.renderOrder = 1100; loopCutPreview.add(preview);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
      const active = runtime.current?.getActiveSubSelection?.();
      if (!runtime.current?.loopCutActive || editModeRef.current !== 'Face' || !active?.mesh || active.mesh !== selectable.find(o => String(o.userData.editorId) === selectedRef.current)) return;
      const mesh = active.mesh as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position');
      const unique = Array.from(new Set(active.indices)).filter((i: number) => i >= 0 && i < pos.count);
      if (unique.length < 3) return;
      const points = unique.slice(0,3).map((i: number) => new THREE.Vector3().fromBufferAttribute(pos, i));
      const faceNormal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      const edges = [[points[0],points[1]],[points[1],points[2]],[points[2],points[0]]].sort((a,b) => a[0].distanceTo(a[1])-b[0].distanceTo(b[1]));
      const normal = new THREE.Vector3().crossVectors(faceNormal, edges[0][1].clone().sub(edges[0][0]).normalize()).normalize();
      if (normal.lengthSq() < 1e-8) return;
      let min = Infinity, max = -Infinity;
      for (let i=0;i<pos.count;i++) { const d = new THREE.Vector3().fromBufferAttribute(pos,i).dot(normal); min=Math.min(min,d); max=Math.max(max,d); }
      if (max-min < 1e-7) return;
      loopCutGesture = { pointerId:event.pointerId, mesh, indices:unique, normal, min, max, projection:(min+max)*0.5 };
      orbitBeforeLoopCut = orbit.enabled;
      activeOrbitBeforeLoopCut = activeOrbit.enabled;
      orbit.enabled = false;
      activeOrbit.enabled = false;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      updateLoopCutPreview(event);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => { if (loopCutGesture?.pointerId === event.pointerId) { updateLoopCutPreview(event); event.preventDefault(); } };
    const onPointerUp = (event: PointerEvent) => {
      if (loopCutGesture?.pointerId === event.pointerId) {
        const gesture = loopCutGesture;
        const amount = THREE.MathUtils.clamp((gesture.projection-gesture.min)/Math.max(1e-8,gesture.max-gesture.min)*100, 1, 99);
        loopCutGesture = null; clearLoopCutPreview(); pointerStart = null;
        orbit.enabled = orbitBeforeLoopCut;
        activeOrbit.enabled = activeOrbitBeforeLoopCut;
        runtime.current?.commitLoopCut?.(gesture.mesh, gesture.indices, amount);
        return;
      }
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      pointerStart = null;
      if (moved > 7 || transform.dragging || (editModeRef.current === 'Object' && !transform.enabled)) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const viewCamera = runtime.current?.cameraView ? activeCamera : camera;
      raycaster.setFromCamera(pointer, viewCamera);
      raycaster.params.Line = { threshold: Math.max(0.025, viewCamera.position.length() * 0.0035) };
      const targetRoot = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      const roots = editModeRef.current === 'Object' ? selectable.filter(o => o.visible) : (targetRoot ? [targetRoot] : []);
      const hits = raycaster.intersectObjects(roots, true);
      if (hits.length && editModeRef.current !== 'Object' && selectedRef.current) {
        const hit = hits[0];
        const target = targetRoot;
        if (target && (target === hit.object || target.getObjectById(hit.object.id)) && hit.object instanceof THREE.Mesh && hit.face) {
          clearSubObjectHighlight();
          const mesh = hit.object as THREE.Mesh;
          const geometry = mesh.geometry as THREE.BufferGeometry;
          const pos = geometry.getAttribute('position');
          if (pos && pos.count) {
            const tri = [hit.face.a, hit.face.b, hit.face.c];
            const localHit = mesh.worldToLocal(hit.point.clone());
            const localVertex = (index: number) => new THREE.Vector3().fromBufferAttribute(pos, index);
            // Keep coincident render vertices synchronized during edits. This preserves
            // UV/material/normal seams because attributes and indices are not welded or rebuilt.
            const coincidentVertexIndices = (index: number) => {
              const anchor = localVertex(index);
              if (!geometry.boundingSphere) geometry.computeBoundingSphere();
              const radius = geometry.boundingSphere?.radius ?? 1;
              const epsilon = Math.max(1e-7, radius * 1e-6);
              const epsilonSq = epsilon * epsilon;
              const matches: number[] = [];
              for (let vertexIndex = 0; vertexIndex < pos.count; vertexIndex++) {
                if (anchor.distanceToSquared(localVertex(vertexIndex)) <= epsilonSq) matches.push(vertexIndex);
              }
              return matches.length ? matches : [index];
            };
            let indices = tri;
            let pivotLocal = localHit.clone();
            if (editModeRef.current === 'Vertex') {
              const selectedVertex = tri.reduce((best, index) => localHit.distanceTo(localVertex(index)) < localHit.distanceTo(localVertex(best)) ? index : best, tri[0]);
              // Move every render vertex at this logical position so adjacent triangles
              // and split-normal/UV seam copies stay visually connected.
              indices = coincidentVertexIndices(selectedVertex);
              pivotLocal.copy(localVertex(selectedVertex));
              const marker = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshBasicMaterial({ color: 0x55f5ff, emissive: 0x159ab5, depthTest: false }));
              marker.position.copy(mesh.localToWorld(pivotLocal.clone())); marker.renderOrder = 1000; subObjectHighlight.add(marker);
            } else if (editModeRef.current === 'Edge') {
              const isQuadGrid = Boolean(mesh.userData.nexusQuadGrid && !geometry.index && pos.count % 6 === 0);
              const quadBase = isQuadGrid ? Math.floor(hit.face.a / 6) * 6 : 0;
              const pairs = isQuadGrid
                ? [[quadBase, quadBase + 1], [quadBase + 1, quadBase + 2], [quadBase + 2, quadBase + 5], [quadBase + 5, quadBase]]
                : [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
              let bestPair = pairs[0], bestDistance = Infinity, bestPoint = pivotLocal.clone();
              pairs.forEach(pair => {
                const a = localVertex(pair[0]), b = localVertex(pair[1]);
                const ab = b.clone().sub(a);
                const t = THREE.MathUtils.clamp(localHit.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
                const point = a.addScaledVector(ab, t);
                const distance = point.distanceTo(localHit);
                if (distance < bestDistance) { bestDistance = distance; bestPair = pair; bestPoint = point; }
              });
              const selectedEdge = bestPair as number[];
              // Expand both endpoints to coincident render-vertex copies without welding
              // the geometry, changing indices, or destroying intentional attribute seams.
              indices = Array.from(new Set([
                ...coincidentVertexIndices(selectedEdge[0]),
                ...coincidentVertexIndices(selectedEdge[1]),
              ]));
              pivotLocal.copy(bestPoint);
              const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(selectedEdge.map(i => mesh.localToWorld(localVertex(i)))), new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false })); line.renderOrder = 1001; subObjectHighlight.add(line);
              const marker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc857, depthTest: false })); marker.position.copy(mesh.localToWorld(pivotLocal.clone())); marker.renderOrder = 1002; subObjectHighlight.add(marker);
            } else {
              const isQuadGrid = Boolean(mesh.userData.nexusQuadGrid && !geometry.index && pos.count % 6 === 0);
              if (isQuadGrid) {
                // One tap resolves directly to one canonical square cell. All six render
                // records belong to this one editable quad, including its repeated corners.
                const quadBase = Math.floor(hit.face.a / 6) * 6;
                const quadCorners = [quadBase, quadBase + 1, quadBase + 2, quadBase + 5];
                indices = [quadBase, quadBase + 1, quadBase + 2, quadBase + 3, quadBase + 4, quadBase + 5];
                const localCorners = quadCorners.map(localVertex);
                pivotLocal.set(0, 0, 0);
                localCorners.forEach(point => pivotLocal.add(point));
                pivotLocal.multiplyScalar(0.25);
                const worldCorners = localCorners.map(point => mesh.localToWorld(point.clone()));
                const faceVertices = [0, 1, 2, 0, 2, 3].flatMap(index => worldCorners[index].toArray());
                const faceGeometry = new THREE.BufferGeometry();
                faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(faceVertices, 3));
                faceGeometry.computeVertexNormals();
                const face = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({ color: 0x24d8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.32, depthTest: false }));
                face.renderOrder = 1000;
                subObjectHighlight.add(face);
                const outlineGeometry = new THREE.BufferGeometry().setFromPoints([...worldCorners, worldCorners[0]]);
                const outline = new THREE.Line(outlineGeometry, new THREE.LineBasicMaterial({ color: 0x05070a, depthTest: false }));
                outline.renderOrder = 1001;
                subObjectHighlight.add(outline);
              } else {
              pivotLocal.copy(localHit);
              const anchor = localVertex(tri[0]);
              const faceNormal = hit.face.normal.clone().normalize();
              const planeTolerance = Math.max(1e-6, (geometry.boundingSphere?.radius ?? 1) * 1e-5);
              const faceCandidates: number[][] = [];
              const indexAttribute = geometry.index;
              const triangleCount = indexAttribute ? indexAttribute.count : pos.count;
              for (let offset = 0; offset + 2 < triangleCount; offset += 3) {
                const idsForTriangle = indexAttribute
                  ? [indexAttribute.getX(offset), indexAttribute.getX(offset + 1), indexAttribute.getX(offset + 2)]
                  : [offset, offset + 1, offset + 2];
                const pointsLocal = idsForTriangle.map(localVertex);
                const triNormal = pointsLocal[1].clone().sub(pointsLocal[0]).cross(pointsLocal[2].clone().sub(pointsLocal[0])).normalize();
                const coplanar = pointsLocal.every(point => Math.abs(point.clone().sub(anchor).dot(faceNormal)) <= planeTolerance);
                // Keep candidates on the tapped planar surface only. Including every
                // quad in the mesh lets the flood cross cube corners into other sides.
                if (coplanar && Math.abs(triNormal.dot(faceNormal)) > 0.999) faceCandidates.push(idsForTriangle);
              }
              // A face is a connected coplanar region, not every triangle on the same
              // plane. Treat committed cut-loop edges as hard region boundaries so the
              // two new faces created by Subdivide / Loop Cut can be tapped independently.
              const localVertexKey = (point: THREE.Vector3) => [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
              const localEdgeKey = (a: THREE.Vector3, b: THREE.Vector3) => {
                const ka = localVertexKey(a), kb = localVertexKey(b);
                return ka < kb ? ka + '|' + kb : kb + '|' + ka;
              };
              const cutEdgeKeys = new Set<string>();
              const storedLoops = Array.isArray(mesh.userData.cutLoops) ? mesh.userData.cutLoops as number[][][] : [];
              storedLoops.forEach(loop => {
                for (let pointIndex = 0; pointIndex < loop.length - 1; pointIndex++) {
                  const a = new THREE.Vector3(...loop[pointIndex] as [number, number, number]);
                  const b = new THREE.Vector3(...loop[pointIndex + 1] as [number, number, number]);
                  cutEdgeKeys.add(localEdgeKey(a, b));
                }
              });
              // Cube grid loops are stored as long perimeter segments, while the rendered
              // face is triangulated into many shorter edges. Exact edge-key comparison
              // therefore misses the cut and floods selection across the whole side.
              // Detect every internal grid-line edge geometrically instead.
              const cubeBounds = mesh.userData.nexusCubeGridBounds as { min: number[]; max: number[] } | undefined;
              const cubeDivisions = Number(mesh.userData.nexusCubeGridDivisions || 0);
              const cubeMin = cubeBounds ? new THREE.Vector3().fromArray(cubeBounds.min as [number, number, number]) : null;
              const cubeMax = cubeBounds ? new THREE.Vector3().fromArray(cubeBounds.max as [number, number, number]) : null;
              const isCubeGridBoundary = (a: THREE.Vector3, b: THREE.Vector3) => {
                if (!cubeMin || !cubeMax || cubeDivisions < 2) return false;
                const epsilon = Math.max(1e-5, cubeMax.clone().sub(cubeMin).length() * 1e-5);
                for (let axis = 0; axis < 3; axis++) {
                  const minValue = cubeMin.getComponent(axis);
                  const step = (cubeMax.getComponent(axis) - minValue) / cubeDivisions;
                  if (step <= epsilon) continue;
                  const aValue = a.getComponent(axis), bValue = b.getComponent(axis);
                  const gridIndex = Math.round((aValue - minValue) / step);
                  if (gridIndex <= 0 || gridIndex >= cubeDivisions) continue;
                  const gridValue = minValue + gridIndex * step;
                  if (Math.abs(aValue - gridValue) <= epsilon && Math.abs(bValue - gridValue) <= epsilon) return true;
                }
                return false;
              };
              const edgeOwners = new Map<string, number[]>();
              faceCandidates.forEach((candidate, candidateIndex) => {
                for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
                  const edge = localEdgeKey(localVertex(candidate[edgeIndex]), localVertex(candidate[(edgeIndex + 1) % 3]));
                  const owners = edgeOwners.get(edge) || [];
                  owners.push(candidateIndex);
                  edgeOwners.set(edge, owners);
                }
              });
              const startKey = tri.map(index => localVertexKey(localVertex(index))).sort().join(';');
              const startIndex = faceCandidates.findIndex(candidate => candidate.map(index => localVertexKey(localVertex(index))).sort().join(';') === startKey);
              const faceTriangles: number[][] = [];
              const visitedFaces = new Set<number>();
              const pendingFaces = startIndex >= 0 ? [startIndex] : [];
              while (pendingFaces.length) {
                const candidateIndex = pendingFaces.pop()!;
                if (visitedFaces.has(candidateIndex)) continue;
                visitedFaces.add(candidateIndex);
                const candidate = faceCandidates[candidateIndex];
                faceTriangles.push(candidate);
                for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
                  const a = localVertex(candidate[edgeIndex]);
                  const b = localVertex(candidate[(edgeIndex + 1) % 3]);
                  const edge = localEdgeKey(a, b);
                  if (cutEdgeKeys.has(edge) || isCubeGridBoundary(a, b)) continue;
                  (edgeOwners.get(edge) || []).forEach(owner => {
                    if (owner !== candidateIndex && !visitedFaces.has(owner)) pendingFaces.push(owner);
                  });
                }
              }
              if (!faceTriangles.length) faceTriangles.push(tri);
              indices = Array.from(new Set(faceTriangles.flat()));
              // Face pivot belongs at the geometric center of the selected coplanar region,
              // not at the pointer hit point or an arbitrary corner.
              const uniqueFacePoints = indices.map(localVertex);
              pivotLocal.set(0, 0, 0);
              uniqueFacePoints.forEach(point => pivotLocal.add(point));
              pivotLocal.multiplyScalar(1 / Math.max(uniqueFacePoints.length, 1));
              const worldPoints = faceTriangles.flatMap(faceTri => faceTri.map(i => mesh.localToWorld(localVertex(i))));
              const faceGeometry = new THREE.BufferGeometry();
              faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(worldPoints.flatMap(p => [p.x, p.y, p.z]), 3));
              faceGeometry.computeVertexNormals();
              const face = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({ color: 0x24d8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.32, depthTest: false }));
              face.renderOrder = 1000; subObjectHighlight.add(face);
              // Draw only the perimeter of the selected coplanar face region. The old
              // triangle-by-triangle outline exposed internal triangulation diagonals as
              // unwanted dividing lines when selecting a face.
              const faceEdgeMap = new Map<string, { count: number; a: number; b: number }>();
              const vertexKey = (index: number) => {
                const point = localVertex(index);
                return [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
              };
              faceTriangles.forEach(faceTri => faceTri.forEach((vertexIndex, edgeIndex) => {
                const nextIndex = faceTri[(edgeIndex + 1) % 3];
                const aKey = vertexKey(vertexIndex), bKey = vertexKey(nextIndex);
                const key = aKey < bKey ? aKey + '|' + bKey : bKey + '|' + aKey;
                const edge = faceEdgeMap.get(key);
                if (edge) edge.count += 1;
                else faceEdgeMap.set(key, { count: 1, a: vertexIndex, b: nextIndex });
              }));
              const edgePoints: THREE.Vector3[] = [];
              faceEdgeMap.forEach(edge => {
                if (edge.count === 1) edgePoints.push(mesh.localToWorld(localVertex(edge.a)), mesh.localToWorld(localVertex(edge.b)));
              });
              const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
              const outline = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x05070a, depthTest: false }));
              outline.renderOrder = 1001; subObjectHighlight.add(outline);
              if (activeEditTool === 'Cutting') {
                const triPoints = tri.map(localVertex);
                const midA = triPoints[0].clone().add(triPoints[1]).multiplyScalar(0.5);
                const midB = triPoints[1].clone().add(triPoints[2]).multiplyScalar(0.5);
                const midC = triPoints[2].clone().add(triPoints[0]).multiplyScalar(0.5);
                const cutPoints = [mesh.localToWorld(midA), mesh.localToWorld(midB), mesh.localToWorld(midC)];
                const cutLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([cutPoints[0], cutPoints[1], cutPoints[2], cutPoints[0]]), new THREE.LineBasicMaterial({ color: 0x000000, depthTest: false }));
                cutLine.renderOrder = 1005; subObjectHighlight.add(cutLine);
              }
              }
            }
            const worldPivot = mesh.localToWorld(pivotLocal.clone());
            subObjectPivot.position.copy(worldPivot);
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
            const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
            subObjectPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
            activeSubSelection = { mesh, indices: Array.from(new Set(indices)), lastWorld: worldPivot.clone(), lastQuaternion: subObjectPivot.quaternion.clone(), lastScale: subObjectPivot.scale.clone() };
            transform.attach(subObjectPivot);
            transform.setMode(modeRef.current);
            transform.setSpace(spaceRef.current);
            transform.enabled = true;
            transform.getHelper().visible = true;
            setStatus(editModeRef.current + ' selected · pivot aligned to touch point');
          }
        }
        return;
      }
      if (hits.length) {
        let target: THREE.Object3D | null = hits[0].object;
        while (target && !target.userData.editorId) target = target.parent;
        if (target) selectObject(target);
      } else if (!transform.axis) selectObject();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (loopCutGesture?.pointerId !== event.pointerId) return;
      loopCutGesture = null;
      pointerStart = null;
      clearLoopCutPreview();
      orbit.enabled = orbitBeforeLoopCut;
      activeOrbit.enabled = activeOrbitBeforeLoopCut;
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    let transformBefore: { object: THREE.Object3D; state: TransformSnapshot } | null = null;
    transform.addEventListener('objectChange', () => {
      if (!activeSubSelection || transform.object !== subObjectPivot) {
        if (transform.object) { transform.object.updateMatrixWorld(true); setItems(prev => [...prev]); }
        return;
      }
      const selection = activeSubSelection;
      selection.mesh.updateWorldMatrix(true, false);
      const previousPivotWorld = selection.lastWorld.clone();
      const currentPivotWorld = subObjectPivot.position.clone();
      const translationWorld = currentPivotWorld.clone().sub(previousPivotWorld);
      const rotationDelta = subObjectPivot.quaternion.clone().multiply(selection.lastQuaternion.clone().invert());
      const scaleDelta = new THREE.Vector3(
        subObjectPivot.scale.x / Math.max(Math.abs(selection.lastScale.x), 1e-8),
        subObjectPivot.scale.y / Math.max(Math.abs(selection.lastScale.y), 1e-8),
        subObjectPivot.scale.z / Math.max(Math.abs(selection.lastScale.z), 1e-8),
      );
      const rotationChanged = 1 - Math.abs(rotationDelta.w) > 1e-8;
      const scaleChanged = Math.abs(scaleDelta.x - 1) + Math.abs(scaleDelta.y - 1) + Math.abs(scaleDelta.z - 1) > 1e-8;
      if (translationWorld.lengthSq() < 1e-12 && !rotationChanged && !scaleChanged) return;
      const pos = selection.mesh.geometry.getAttribute('position');
      // Resolve selected indices to logical positions, then apply translation, rotation,
      // and scale around the gizmo pivot to every matching render-vertex copy. This keeps
      // UV/material seam copies visually connected without welding their attributes.
      const logicalKeys = new Set<string>();
      const positionKey = (x: number, y: number, z: number) => [x, y, z].map(value => Math.round(value * 1e5)).join(',');
      selection.indices.forEach(index => { if (index >= 0 && index < pos.count) logicalKeys.add(positionKey(pos.getX(index), pos.getY(index), pos.getZ(index))); });
      for (let index = 0; index < pos.count; index++) {
        if (!logicalKeys.has(positionKey(pos.getX(index), pos.getY(index), pos.getZ(index)))) continue;
        const localPoint = new THREE.Vector3(pos.getX(index), pos.getY(index), pos.getZ(index));
        const worldPoint = selection.mesh.localToWorld(localPoint.clone());
        const relativeToPivot = worldPoint.clone().sub(previousPivotWorld);
        if (scaleChanged) {
          // Scale in the gizmo's orientation, not in world XYZ, so Local/World mode
          // and non-axis-aligned faces do not shear or skew the selected component.
          relativeToPivot.applyQuaternion(selection.lastQuaternion.clone().invert());
          relativeToPivot.multiply(scaleDelta);
          relativeToPivot.applyQuaternion(selection.lastQuaternion);
        }
        if (rotationChanged) relativeToPivot.applyQuaternion(rotationDelta);
        worldPoint.copy(relativeToPivot).add(previousPivotWorld).add(translationWorld);
        const updatedLocal = selection.mesh.worldToLocal(worldPoint);
        pos.setXYZ(index, updatedLocal.x, updatedLocal.y, updatedLocal.z);
      }
      pos.needsUpdate = true;
      selection.mesh.geometry.computeVertexNormals();
      selection.mesh.geometry.computeBoundingBox();
      selection.mesh.geometry.computeBoundingSphere();
      refreshTopologyOverlay(selection.mesh);
      selection.lastWorld.copy(subObjectPivot.position);
      selection.lastQuaternion.copy(subObjectPivot.quaternion);
      selection.lastScale.copy(subObjectPivot.scale);
    });
    transform.addEventListener('dragging-changed', (event: any) => {
      const inCameraView = Boolean(runtime.current?.cameraView);
      orbit.enabled = !event.value && !inCameraView;
      activeOrbit.enabled = !event.value && inCameraView;
      if (event.value) {
        const object = transform.object;
        if (object === subObjectPivot && activeSubSelection) subGeometryBefore = activeSubSelection.mesh.geometry.clone();
        else transformBefore = object ? { object, state: snapshot(object) } : null;
      } else {
        if (subGeometryBefore && activeSubSelection) {
          const mesh = activeSubSelection.mesh;
          const beforeGeometry = subGeometryBefore.clone();
          const afterGeometry = mesh.geometry.clone();
          if (beforeGeometry.getAttribute('position').count !== afterGeometry.getAttribute('position').count || beforeGeometry.getAttribute('position').array.some((value: number, index: number) => value !== afterGeometry.getAttribute('position').array[index])) {
            recordSceneAction({ label: 'Move sub-object ' + mesh.name, undo: () => { mesh.geometry.dispose(); mesh.geometry = beforeGeometry.clone(); mesh.geometry.computeVertexNormals(); }, redo: () => { mesh.geometry.dispose(); mesh.geometry = afterGeometry.clone(); mesh.geometry.computeVertexNormals(); } });
          } else beforeGeometry.dispose();
          subGeometryBefore.dispose(); subGeometryBefore = null;
        }
        // Vertex/Edge gizmo edits update the live mesh; refresh the working geometry
        // so the next Face tool starts from those exact positions.
        const editedMesh = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
        if (editedMesh instanceof THREE.Mesh) {
          editBaseGeometry.current?.dispose();
          editBaseGeometry.current = editedMesh.geometry.clone();
        }
        if (transformBefore) {
          const before = transformBefore;
          const after = snapshot(before.object);
          if (JSON.stringify(before.state) !== JSON.stringify(after)) recordSceneAction({ label: 'Transform ' + before.object.name, undo: () => { applySnapshot(before.object, before.state); selectObject(before.object); }, redo: () => { applySnapshot(before.object, after); selectObject(before.object); } });
          transformBefore = null;
        }
      }
    });
    const resize = () => {
      const w = Math.max(host.clientWidth, 1), h = Math.max(host.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      activeCamera.aspect = w / h;
      activeCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
      setPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', resize);
    transform.addEventListener('mouseUp', () => {
      if (autoKeyRef.current && selectedRef.current) captureRef.current();
    });
    const frameLoop = () => {
      orbit.update();
      if (!runtime.current?.cameraView) {
        activeCamera.position.copy(camBody.position);
        activeCamera.quaternion.copy(camBody.quaternion);
      } else {
        activeOrbit.update();
      }
      const inCam = Boolean(runtime.current?.cameraView);
      const topologyTarget = topologyOverlay.userData.targetMesh as THREE.Mesh | null;
      if (topologyTarget) {
        topologyTarget.updateWorldMatrix(true, false);
        topologyOverlay.matrix.copy(topologyTarget.matrixWorld);
        topologyOverlay.matrixWorldNeedsUpdate = true;
      }
      camBody.visible = !inCam;
      transform.getHelper().visible = Boolean(selectedRef.current);
      Object.entries(particleSystems).forEach(([type, points]) => {
        if (!points.visible) return;
        const position = points.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < position.count; i++) {
          const y = position.getY(i);
          if (type === 'Rain') position.setY(i, y < -0.3 ? 13 : y - 0.22);
          else if (type === 'Fire') position.setY(i, y > 5.5 ? 0 : y + 0.035);
          else if (type === 'Smoke') position.setY(i, y > 7 ? 0 : y + 0.012);
          else position.setY(i, y > 4 ? 0 : y + 0.004);
        }
        position.needsUpdate = true;
      });
      const mirrorObject = selectable.find(o => o.userData.editorId === selectedRef.current);
      if (mirrorObject) {
        const hasMirror = mirrorObject.children.some((child: any) => child.isMesh && (Array.isArray(child.material) ? child.material : [child.material]).some((m: any) => m.envMap === reflectionTarget.texture));
        if (hasMirror) {
          const world = new THREE.Vector3(); mirrorObject.getWorldPosition(world); reflectionCamera.position.copy(world);
          const wasVisible = mirrorObject.visible; mirrorObject.visible = false; reflectionCamera.update(renderer, scene); mirrorObject.visible = wasVisible;
        }
      }
      renderer.render(scene, inCam ? activeCamera : camera);
      runtime.current = { ...(runtime.current || {}), scene, camera, activeCamera, renderer, orbit, activeOrbit, transform, selectable, syncItems, addObject, createManualRig, createIKTarget, solveIK, selectObject, removeObject, toggleVisibility, reparentObject, reorderObject, updateLightProperty, toggleLightEnabled, camBody, lightSources, addSceneLight, applyPreset, applySettings, toggleParticle, grid, subObjectHighlight, topologyOverlay, refreshTopologyOverlay, clearSubSelection: () => { activeSubSelection = null; }, getActiveSubSelection: () => activeSubSelection, setActiveSubSelection: (selection: any) => { activeSubSelection = selection; }, restoreExtrudedFaceSelection: (mesh: THREE.Mesh, indices: number[]) => { const position = mesh.geometry.getAttribute('position'); if (!position || indices.length < 3) return; const unique = new Map<string, THREE.Vector3>(); indices.forEach(index => { if (index < 0 || index >= position.count) return; const point = new THREE.Vector3().fromBufferAttribute(position, index); const key = [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(','); unique.set(key, point); }); const center = new THREE.Vector3(); unique.forEach(point => center.add(point)); center.multiplyScalar(1 / Math.max(unique.size, 1)); const a = new THREE.Vector3().fromBufferAttribute(position, indices[0]); const b = new THREE.Vector3().fromBufferAttribute(position, indices[1]); const c = new THREE.Vector3().fromBufferAttribute(position, indices[2]); const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); mesh.updateWorldMatrix(true, false); const worldPivot = mesh.localToWorld(center.clone()); const worldNormal = normal.transformDirection(mesh.matrixWorld); subObjectPivot.position.copy(worldPivot); subObjectPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal); subObjectPivot.scale.set(1, 1, 1); activeSubSelection = { mesh, indices: [...new Set(indices)], lastWorld: worldPivot.clone(), lastQuaternion: subObjectPivot.quaternion.clone(), lastScale: subObjectPivot.scale.clone() }; transform.attach(subObjectPivot); transform.setMode(modeRef.current); transform.setSpace(spaceRef.current); transform.enabled = true; transform.getHelper().visible = true; } };
      raf = requestAnimationFrame(frameLoop);
    };
    let raf = requestAnimationFrame(frameLoop);
    syncItems();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      clearLoopCutPreview();
      orbit.dispose();
      activeOrbit.dispose();
      transform.dispose();
      subObjectPivot.parent?.remove(subObjectPivot);
      clearSubObjectHighlight();
      clearTopologyOverlay();
      reflectionTarget.dispose();
      Object.values(particleSystems).forEach(points => { points.geometry.dispose(); (points.material as THREE.Material).dispose(); });
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // Runtime is initialized once; handlers use refs for mutable editor state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  captureRef.current = () => {
    const r = runtime.current;
    const id = selectedRef.current;
    if (!r || !id) return;
    const obj = r.selectable.find((o: THREE.Object3D) => o.userData.editorId === id);
    if (!obj) return;
    const next: Keyframes = JSON.parse(JSON.stringify(keysRef.current));
    next[id] = { ...(next[id] || {}), [frameRef.current]: snapshot(obj) };
    commitKeys(next);
    setStatus('Keyframe set · F: ' + String(frameRef.current).padStart(3, '0'));
  };

  const runMode = (next: 'translate' | 'rotate' | 'scale') => {
    if (cameraView) return;
    modeRef.current = next;
    setMode(next);
    const transform = runtime.current?.transform;
    if (transform) {
      transform.setMode(next);
      const active = runtime.current?.getActiveSubSelection?.();
      const editingSubObject = editModeRef.current !== 'Object' && Boolean(active);
      transform.enabled = Boolean(selectedRef.current) && (editModeRef.current === 'Object' || editingSubObject);
      transform.getHelper().visible = transform.enabled;
    }
    setStatus(next === 'translate' ? 'Move tool active' : next === 'rotate' ? 'Rotate tool active' : 'Scale tool active');
  };
  const setAxisSpace = () => {
    if (cameraView) return;
    const next = spaceRef.current === 'world' ? 'local' : 'world';
    spaceRef.current = next;
    setSpace(next);
    runtime.current?.transform.setSpace(next);
    setStatus(next === 'world' ? 'World axis space' : 'Local axis space');
  };
  const add = (kind: string) => { if (!cameraView) runtime.current?.addObject(kind); };
  const applyGeometryTool = (tool: 'Extrude' | 'Subdivide' | 'Smooth' | 'LoopCut' | '', rawAmount: number, partOverride?: { mesh: THREE.Mesh; indices: number[] }) => {
    if (!tool) return;
    const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selectedRef.current);
    const savedLoop = tool === 'LoopCut' ? loopCutContext.current : null;
    const savedExtrude = tool === 'Extrude' ? extrudeContext.current : null;
    const part = partOverride || (savedLoop && target instanceof THREE.Mesh && String(target.userData.editorId) === savedLoop.meshId ? { mesh: target, indices: savedLoop.indices } : null) || (savedExtrude && target instanceof THREE.Mesh && String(target.userData.editorId) === savedExtrude.meshId ? { mesh: target, indices: savedExtrude.indices } : null) || runtime.current?.getActiveSubSelection?.() || ((tool === 'Subdivide' || tool === 'Smooth') && target instanceof THREE.Mesh ? { mesh: target, indices: Array.from({ length: target.geometry.getAttribute('position')?.count || 0 }, (_value, index) => index) } : null);
    if (!(target instanceof THREE.Mesh) || !part || part.mesh !== target) {
      setStatus('Select a vertex, edge, or face before using a geometry tool');
      return;
    }
    // The live mesh geometry is the single source of truth. editBaseGeometry is only
    // a temporary tool snapshot and can be stale after Vertex/Edge gizmo transforms.
    let geometry = target.geometry.clone();
    const before = target.geometry.clone();
    const ids = Array.from(new Set(part.indices as number[]));
    const original = geometry.getAttribute('position');
    if (!original || !ids.length) { geometry.dispose(); before.dispose(); return; }
    const pt = (i: number) => new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute, i);
    const selectedPoints = ids.slice(0, 3).map(pt);
    const same = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) < 1e-8;
    const depth = Math.max(0.01, rawAmount / 100) * 0.8;
    let extrudedCapIndices: number[] = [];
    let generatedCutLoops: number[][][] = [];
    const previousCutLoops = Array.isArray(target.userData.cutLoops) ? (target.userData.cutLoops as number[][][]).map(loop => loop.map(point => [...point])) : [];
    const captureQuadGridState = () => ({
      enabled: Boolean(target.userData.nexusQuadGrid),
      layout: typeof target.userData.nexusQuadGridLayout === 'string' ? target.userData.nexusQuadGridLayout : null,
      bounds: target.userData.nexusCubeGridBounds ? JSON.parse(JSON.stringify(target.userData.nexusCubeGridBounds)) : null,
      divisions: Number(target.userData.nexusCubeGridDivisions || 0),
    });
    const beforeQuadGridState = captureQuadGridState();
    const restoreQuadGridState = (state: ReturnType<typeof captureQuadGridState>) => {
      if (state.enabled) target.userData.nexusQuadGrid = true;
      else delete target.userData.nexusQuadGrid;
      if (state.layout) target.userData.nexusQuadGridLayout = state.layout;
      else delete target.userData.nexusQuadGridLayout;
      if (state.bounds) target.userData.nexusCubeGridBounds = JSON.parse(JSON.stringify(state.bounds));
      else delete target.userData.nexusCubeGridBounds;
      if (state.divisions > 0) target.userData.nexusCubeGridDivisions = state.divisions;
      else delete target.userData.nexusCubeGridDivisions;
    };

    if (tool === 'Subdivide' && target.userData.kind === 'Cube' && (geometry.index || target.userData.nexusQuadGrid === true) && target.userData.nexusHasExtrusion !== true) {
      // Three.js BoxGeometry stores each original quad as [A,B,D] and [B,C,D].
      // Reconstruct the perimeter [A,B,C,D] on the first pass. Nexus3D-generated
      // quads use [A,B,C,A,C,D], so later passes read [0,1,2,5].
      let sourceCornerOffsets: number[] | null = null;
      if (geometry.index) {
        const indexedSource = geometry;
        geometry = indexedSource.toNonIndexed();
        indexedSource.dispose();
        sourceCornerOffsets = [0, 1, 4, 2];
      } else if (target.userData.nexusQuadGrid === true) {
        sourceCornerOffsets = [0, 1, 2, 5];
      } else {
        geometry.dispose(); before.dispose();
        setStatus('Subdivide cancelled: this Cube has no verified square-quad layout. Existing geometry was preserved.');
        return;
      }
      const source = geometry.getAttribute('position') as THREE.BufferAttribute;
      const sourceUv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (!sourceCornerOffsets || source.count % 6 !== 0) {
        geometry.dispose(); before.dispose();
        setStatus('Quad Subdivide could not identify the current square-quad layout; existing geometry was preserved.');
        return;
      }
      const cellCount = source.count / 6;
      const deviceMemoryGb = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4);
      const safeVertexBudget = Math.min(1_200_000, Math.max(180_000, Math.floor(deviceMemoryGb * 180_000)));
      const outputVertexCount = cellCount * 24;
      if (outputVertexCount > safeVertexBudget) {
        geometry.dispose(); before.dispose();
        setStatus('Subdivide paused before the device memory budget; current mesh was preserved.');
        return;
      }
      const positions = new Float32Array(outputVertexCount * 3);
      const uvs = new Float32Array(outputVertexCount * 2);
      let positionCursor = 0;
      let uvCursor = 0;
      generatedCutLoops = [];
      const readPoint = (index: number) => new THREE.Vector3().fromBufferAttribute(source, index);
      const readUv = (index: number) => sourceUv ? new THREE.Vector2().fromBufferAttribute(sourceUv, index) : new THREE.Vector2();
      const lerpPoint = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, u: number, v: number) =>
        a.clone().multiplyScalar((1-u)*(1-v)).addScaledVector(b,u*(1-v)).addScaledVector(c,u*v).addScaledVector(d,(1-u)*v);
      const lerpUv = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, d: THREE.Vector2, u: number, v: number) =>
        a.clone().multiplyScalar((1-u)*(1-v)).addScaledVector(b,u*(1-v)).addScaledVector(c,u*v).addScaledVector(d,(1-u)*v);
      const pushQuad = (points: THREE.Vector3[], tex: THREE.Vector2[]) => {
        [0,1,2,0,2,3].forEach(index => {
          const point = points[index], uv = tex[index];
          positions[positionCursor++] = point.x;
          positions[positionCursor++] = point.y;
          positions[positionCursor++] = point.z;
          uvs[uvCursor++] = uv.x;
          uvs[uvCursor++] = uv.y;
        });
      };
      geometry.computeBoundingSphere();
      const geometryScale = Math.max(geometry.boundingSphere?.radius || 1, 1e-4);
      const minimumTriangleArea = geometryScale * geometryScale * 1e-10;
      let invalidQuad = false;
      for (let offset = 0; offset < source.count; offset += 6) {
        const corners = sourceCornerOffsets.map(cornerOffset => readPoint(offset + cornerOffset));
        const [p00, p10, p11, p01] = corners;
        const areaA = p10.clone().sub(p00).cross(p11.clone().sub(p00)).length();
        const areaB = p11.clone().sub(p00).cross(p01.clone().sub(p00)).length();
        if (
          corners.some(point => !point.toArray().every(Number.isFinite)) ||
          areaA <= minimumTriangleArea ||
          areaB <= minimumTriangleArea
        ) {
          invalidQuad = true;
          break;
        }
        const [t00, t10, t11, t01] = sourceCornerOffsets.map(cornerOffset => readUv(offset + cornerOffset));
        const pTop = lerpPoint(p00,p10,p11,p01,0.5,0);
        const pRight = lerpPoint(p00,p10,p11,p01,1,0.5);
        const pBottom = lerpPoint(p00,p10,p11,p01,0.5,1);
        const pLeft = lerpPoint(p00,p10,p11,p01,0,0.5);
        const pCenter = lerpPoint(p00,p10,p11,p01,0.5,0.5);
        const tTop = lerpUv(t00,t10,t11,t01,0.5,0);
        const tRight = lerpUv(t00,t10,t11,t01,1,0.5);
        const tBottom = lerpUv(t00,t10,t11,t01,0.5,1);
        const tLeft = lerpUv(t00,t10,t11,t01,0,0.5);
        const tCenter = lerpUv(t00,t10,t11,t01,0.5,0.5);
        pushQuad([p00,pTop,pCenter,pLeft],[t00,tTop,tCenter,tLeft]);
        pushQuad([pTop,p10,pRight,pCenter],[tTop,t10,tRight,tCenter]);
        pushQuad([pCenter,pRight,p11,pBottom],[tCenter,tRight,t11,tBottom]);
        pushQuad([pLeft,pCenter,pBottom,p01],[tLeft,tCenter,tBottom,t01]);
        generatedCutLoops.push([pTop.toArray(),pCenter.toArray(),pBottom.toArray()]);
        generatedCutLoops.push([pLeft.toArray(),pCenter.toArray(),pRight.toArray()]);
      }
      if (invalidQuad) {
        geometry.dispose(); before.dispose();
        setStatus('Subdivide cancelled: a collapsed or invalid face was detected. The existing mesh was preserved.');
        return;
      }
      geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
    } else if (tool === 'Subdivide') {
      // Rebuild the CURRENT live mesh as quad patches wherever two adjacent
      // triangles describe one face. Subdivide those patches into four quads;
      // never create visible diagonal triangle cuts inside a square face.
      const sourceGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
      if (sourceGeometry !== geometry) geometry.dispose();
      geometry = sourceGeometry;
      const sourcePosition = geometry.getAttribute('position');
      const triangleCount = Math.floor((sourcePosition?.count || 0) / 3);
      const deviceMemoryGb = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4);
      const safeTriangleBudget = Math.min(220000, Math.max(20000, Math.floor(deviceMemoryGb * 30000)));
      if (!sourcePosition || triangleCount < 1 || triangleCount * 12 > safeTriangleBudget) {
        geometry.dispose(); before.dispose();
        setStatus('Subdivide paused: mesh is empty or exceeds the safe mobile topology budget. Existing mesh was preserved.');
        return;
      }
      const attributeNames = Object.keys(geometry.attributes);
      const sourceAttributes = Object.fromEntries(attributeNames.map(name => [name, geometry.getAttribute(name)])) as Record<string, THREE.BufferAttribute>;
      const sourceGroups = [...geometry.groups];
      const getCorner = (vertex: number) => Object.fromEntries(attributeNames.map(name => {
        const attribute = sourceAttributes[name];
        return [name, Array.from({ length: attribute.itemSize }, (_v, component) => attribute.getComponent(vertex, component))];
      })) as Record<string, number[]>;
      const pointKey = (corner: Record<string, number[]>) => corner.position.map(value => Math.round(value * 1e5)).join(',');
      const midpoint = (a: Record<string, number[]>, b: Record<string, number[]>) =>
        Object.fromEntries(attributeNames.map(name => [name, a[name].map((value, component) => (value + b[name][component]) * 0.5)])) as Record<string, number[]>;
      const outputValues: Record<string, number[]> = Object.fromEntries(attributeNames.map(name => [name, []]));
      const appendQuad = (corners: Array<Record<string, number[]>>) => {
        // Quad perimeter [A,B,C,D], rendered as [A,B,C,A,C,D].
        [0, 1, 2, 0, 2, 3].forEach(index => {
          const corner = corners[index];
          attributeNames.forEach(name => outputValues[name].push(...corner[name]));
        });
      };
      const materialForTriangle = (triangle: number) => {
        const offset = triangle * 3;
        return sourceGroups.find(group => offset >= group.start && offset < group.start + group.count)?.materialIndex ?? 0;
      };
      const triangles = Array.from({ length: triangleCount }, (_, triangle) => ({
        triangle,
        corners: [getCorner(triangle * 3), getCorner(triangle * 3 + 1), getCorner(triangle * 3 + 2)],
        material: materialForTriangle(triangle),
      }));
      const used = new Set<number>();
      const quadPairs: Array<{ a: Record<string, number[]>; b: Record<string, number[]>; c: Record<string, number[]>; d: Record<string, number[]>; material: number }> = [];
      const edgeTriangles = new Map<string, number[]>();
      const edgeKey = (a: string, b: string) => a < b ? a + '|' + b : b + '|' + a;
      triangles.forEach((entry, index) => {
        const keys = entry.corners.map(pointKey);
        for (let edge = 0; edge < 3; edge++) {
          const key = edgeKey(keys[edge], keys[(edge + 1) % 3]);
          const list = edgeTriangles.get(key) || [];
          list.push(index);
          edgeTriangles.set(key, list);
        }
      });
      // Edge lookup keeps pairing linear-time on mobile-sized meshes.
      for (let i = 0; i < triangles.length; i++) {
        if (used.has(i)) continue;
        const first = triangles[i];
        const keysA = first.corners.map(pointKey);
        let match = -1;
        let shared: string[] = [];
        const candidates = new Set<number>();
        for (let edge = 0; edge < 3; edge++) {
          (edgeTriangles.get(edgeKey(keysA[edge], keysA[(edge + 1) % 3])) || []).forEach(candidate => {
            if (candidate > i && !used.has(candidate)) candidates.add(candidate);
          });
        }
        for (const candidate of candidates) {
          if (triangles[candidate].material !== first.material) continue;
          const keysB = triangles[candidate].corners.map(pointKey);
          const common = keysA.filter(key => keysB.includes(key));
          if (common.length === 2) { match = candidate; shared = common; break; }
        }
        if (match < 0) continue;
        const second = triangles[match];
        const firstOpposite = first.corners.find(corner => !shared.includes(pointKey(corner)));
        const secondOpposite = second.corners.find(corner => !shared.includes(pointKey(corner)));
        const sharedA = first.corners.find(corner => pointKey(corner) === shared[0]);
        const sharedB = first.corners.find(corner => pointKey(corner) === shared[1]);
        if (!firstOpposite || !secondOpposite || !sharedA || !sharedB) continue;
        quadPairs.push({ a: firstOpposite, b: sharedA, c: secondOpposite, d: sharedB, material: first.material });
        used.add(i);
        used.add(match);
      }
      const unmatched = triangles.filter(entry => !used.has(entry.triangle));
      const outputGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
      let currentMaterial = -1;
      let groupStart = 0;
      const finishGroup = () => {
        const count = outputValues.position.length / sourceAttributes.position.itemSize - groupStart;
        if (count > 0) outputGroups.push({ start: groupStart, count, materialIndex: currentMaterial });
      };
      const appendWithMaterial = (corners: Array<Record<string, number[]>>, material: number) => {
        if (currentMaterial !== material) {
          finishGroup();
          currentMaterial = material;
          groupStart = outputValues.position.length / sourceAttributes.position.itemSize;
        }
        appendQuad(corners);
      };
      generatedCutLoops = [];
      quadPairs.forEach(quad => {
        const { a, b, c, d } = quad;
        const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d), da = midpoint(d, a);
        const center = Object.fromEntries(attributeNames.map(name => [name, a[name].map((value, component) => (value + b[name][component] + c[name][component] + d[name][component]) * 0.25)])) as Record<string, number[]>;
        const material = quad.material;
        appendWithMaterial([a, ab, center, da], material);
        appendWithMaterial([ab, b, bc, center], material);
        appendWithMaterial([center, bc, c, cd], material);
        appendWithMaterial([da, center, cd, d], material);
      });
      unmatched.forEach(entry => {
        // Keep isolated triangles intact rather than drawing artificial diagonal cuts.
        if (currentMaterial !== entry.material) {
          finishGroup();
          currentMaterial = entry.material;
          groupStart = outputValues.position.length / sourceAttributes.position.itemSize;
        }
        entry.corners.forEach(corner => attributeNames.forEach(name => outputValues[name].push(...corner[name])));
      });
      finishGroup();
      const subdivided = new THREE.BufferGeometry();
      attributeNames.forEach(name => {
        const sourceAttribute = sourceAttributes[name];
        subdivided.setAttribute(name, new THREE.Float32BufferAttribute(outputValues[name], sourceAttribute.itemSize, sourceAttribute.normalized));
      });
      outputGroups.forEach(group => subdivided.addGroup(group.start, group.count, group.materialIndex));
      geometry.dispose();
      geometry = subdivided;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      target.userData.nexusQuadGrid = quadPairs.length > 0 && unmatched.length === 0;
      if (target.userData.nexusQuadGrid) {
        target.userData.nexusQuadGridLayout = 'paired-quad-grid';
        delete target.userData.nexusCubeGridBounds;
        delete target.userData.nexusCubeGridDivisions;
      } else {
        delete target.userData.nexusQuadGrid;
        delete target.userData.nexusQuadGridLayout;
        delete target.userData.nexusCubeGridBounds;
        delete target.userData.nexusCubeGridDivisions;
      }
    } else if (tool === 'Smooth') {
      if (target.userData.nexusQuadGrid === true && smoothQuadGridGeometry(geometry)) {
        geometry.deleteAttribute('normal');
        geometry.computeVertexNormals();
      } else {
      // Progressive whole-mesh Laplacian smoothing. Work from the CURRENT geometry
      // (including prior vertex/edge/face edits), weld coincident render vertices
      // logically for adjacency, then write the same smoothed position to every seam copy.
      // Unlike the old paired pass + bounding-box compensation, this intentionally
      // allows corners and edges to contract so a subdivided cube becomes rounded.
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const index = geometry.index;
      const keyOf = (v: THREE.Vector3) => [v.x, v.y, v.z].map(n => Math.round(n * 1e6)).join(',');
      const groups = new Map<string, { point: THREE.Vector3; indices: number[] }>();
      const vertexKeys: string[] = [];
      for (let i = 0; i < position.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(position, i);
        const key = keyOf(point);
        vertexKeys[i] = key;
        const group = groups.get(key);
        if (group) group.indices.push(i);
        else groups.set(key, { point, indices: [i] });
      }
      const neighbors = new Map<string, Set<string>>();
      groups.forEach((_group, key) => neighbors.set(key, new Set()));
      const triangleIndex = (offset: number) => index ? index.getX(offset) : offset;
      const triangleCount = index ? index.count : position.count;
      for (let i = 0; i + 2 < triangleCount; i += 3) {
        const keys = [0, 1, 2].map(k => vertexKeys[triangleIndex(i + k)]);
        for (let k = 0; k < 3; k++) {
          const a = keys[k], b = keys[(k + 1) % 3];
          if (!a || !b || a === b) continue;
          neighbors.get(a)?.add(b);
          neighbors.get(b)?.add(a);
        }
      }
      let smoothed = new Map<string, THREE.Vector3>();
      groups.forEach((group, key) => smoothed.set(key, group.point.clone()));
      // Apply multiple positive passes on ALL connected mesh vertices. Each press
      // compounds on the latest geometry, making the object progressively rounder.
      const smoothPasses = position.count > 36000 ? 1 : 3;
      for (let pass = 0; pass < smoothPasses; pass++) {
        const next = new Map<string, THREE.Vector3>();
        smoothed.forEach((point, key) => {
          const adjacent = neighbors.get(key);
          if (!adjacent?.size) {
            next.set(key, point.clone());
            return;
          }
          const average = new THREE.Vector3();
          adjacent.forEach(neighbor => average.add(smoothed.get(neighbor) || point));
          average.multiplyScalar(1 / adjacent.size);
          next.set(key, point.clone().lerp(average, 0.32));
        });
        smoothed = next;
      }
      smoothed.forEach((point, key) => {
        groups.get(key)?.indices.forEach(i => position.setXYZ(i, point.x, point.y, point.z));
      });
      position.needsUpdate = true;
      geometry.deleteAttribute('normal');
      geometry.computeVertexNormals();
      }
        } else if (tool === 'Subdivide' || tool === 'LoopCut') {
      // Safe plane-based loop split for compatible planar faces: split each intersected
      // triangle at the same cut plane and interpolate every existing vertex attribute.
      if ((tool === 'LoopCut' && editModeRef.current !== 'Face') || selectedPoints.length < 3) { geometry.dispose(); before.dispose(); setStatus(tool === 'LoopCut' ? 'Loop Cut requires a selected face' : 'Subdivide needs a mesh with valid triangles'); return; }
      geometry = geometry.toNonIndexed();
      const p = geometry.getAttribute('position');
      const faceNormal = selectedPoints[1].clone().sub(selectedPoints[0]).cross(selectedPoints[2].clone().sub(selectedPoints[0])).normalize();
      const edges = [[selectedPoints[0], selectedPoints[1]], [selectedPoints[1], selectedPoints[2]], [selectedPoints[2], selectedPoints[0]]].sort((u, v) => u[0].distanceTo(u[1]) - v[0].distanceTo(v[1]));
      const edgeDirection = edges[0][1].clone().sub(edges[0][0]).normalize();
      const cutNormal = new THREE.Vector3().crossVectors(faceNormal, edgeDirection).normalize();
      const center = new THREE.Vector3(); ids.forEach(i => center.add(pt(i))); center.multiplyScalar(1 / ids.length);
      if (cutNormal.lengthSq() < 1e-8) { geometry.dispose(); before.dispose(); setStatus(tool + ' cancelled: incompatible mesh topology'); return; }
      // Slide the real cut plane across the mesh bounds. 50 creates the default centered cut.
      let minProjection = Infinity, maxProjection = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const projection = pt(i).dot(cutNormal);
        minProjection = Math.min(minProjection, projection);
        maxProjection = Math.max(maxProjection, projection);
      }
      const cutProjection = minProjection + (maxProjection - minProjection) * THREE.MathUtils.clamp(rawAmount, 1, 99) / 100;
      center.addScaledVector(cutNormal, cutProjection - center.dot(cutNormal));
      const names = Object.keys(geometry.attributes), groups = [...geometry.groups];
      const interpolate = (a: Record<string, number[]>, b: Record<string, number[]>, t: number) => Object.fromEntries(names.map(name => [name, a[name].map((value, k) => value + (b[name][k] - value) * t)]));
      const getCorner = (i: number) => Object.fromEntries(names.map(name => { const attr = geometry.getAttribute(name); return [name, Array.from({ length: attr.itemSize }, (_v, c) => attr.getComponent(i, c))]; }));
      const getPos = (v: Record<string, number[]>) => new THREE.Vector3().fromArray(v.position as [number, number, number]);
      const materialAt = (offset: number) => groups.find(group => offset >= group.start && offset < group.start + group.count)?.materialIndex ?? 0;
      const output: Array<{ tri: Array<Record<string, number[]>>; materialIndex: number }> = [];
      const cutSegments: Array<[THREE.Vector3, THREE.Vector3]> = [];
      let crossed = 0;
      const emitPoly = (poly: Array<Record<string, number[]>>, materialIndex: number) => { for (let i = 1; i < poly.length - 1; i++) output.push({ tri: [poly[0], poly[i], poly[i + 1]], materialIndex }); };
      const clip = (corners: Array<Record<string, number[]>>, sign: number, materialIndex: number) => {
        const poly: Array<Record<string, number[]>> = [];
        for (let i = 0; i < corners.length; i++) {
          const a = corners[i], b = corners[(i + 1) % corners.length];
          const da = getPos(a).sub(center).dot(cutNormal) * sign, db = getPos(b).sub(center).dot(cutNormal) * sign;
          if (da >= -1e-6) poly.push(a);
          if ((da < -1e-6 && db > 1e-6) || (da > 1e-6 && db < -1e-6)) { const t = da / (da - db); poly.push(interpolate(a, b, t)); }
        }
        if (poly.length >= 3) emitPoly(poly, materialIndex);
      };
      for (let i = 0; i + 2 < p.count; i += 3) {
        const corners = [getCorner(i), getCorner(i + 1), getCorner(i + 2)];
        const distances = corners.map(corner => getPos(corner).sub(center).dot(cutNormal));
        if (Math.min(...distances) < -1e-6 && Math.max(...distances) > 1e-6) {
          crossed++;
          const intersections: THREE.Vector3[] = [];
          for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
            const a = getPos(corners[edgeIndex]);
            const b = getPos(corners[(edgeIndex + 1) % 3]);
            const da = a.clone().sub(center).dot(cutNormal);
            const db = b.clone().sub(center).dot(cutNormal);
            if ((da < -1e-6 && db > 1e-6) || (da > 1e-6 && db < -1e-6)) {
              const point = a.lerp(b, da / (da - db));
              if (!intersections.some(existing => existing.distanceToSquared(point) < 1e-10)) intersections.push(point);
            }
          }
          if (intersections.length === 2) cutSegments.push([intersections[0], intersections[1]]);
        }
        clip(corners, 1, materialAt(i)); clip(corners, -1, materialAt(i));
      }
      if (!crossed || !cutSegments.length) { geometry.dispose(); before.dispose(); setStatus(tool + ' cancelled: no compatible closed cut crosses this mesh'); return; }
      // Join per-triangle intersections into connected closed loops using quantized
      // local-space endpoints. Reject open chains instead of drawing misleading fragments.
      const pointKey = (point: THREE.Vector3) => [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
      const vertices = new Map<string, THREE.Vector3>();
      const adjacency = new Map<string, Set<string>>();
      cutSegments.forEach(([a, b]) => {
        const ka = pointKey(a), kb = pointKey(b);
        if (ka === kb) return;
        vertices.set(ka, a.clone()); vertices.set(kb, b.clone());
        if (!adjacency.has(ka)) adjacency.set(ka, new Set());
        if (!adjacency.has(kb)) adjacency.set(kb, new Set());
        adjacency.get(ka)?.add(kb); adjacency.get(kb)?.add(ka);
      });
      const visitedEdges = new Set<string>();
      const edgeKey = (a: string, b: string) => a < b ? a + '|' + b : b + '|' + a;
      adjacency.forEach((neighbors, start) => {
        neighbors.forEach(first => {
          const initialKey = edgeKey(start, first);
          if (visitedEdges.has(initialKey)) return;
          const chain = [start];
          let previous = start, current = first, closed = false;
          for (let guard = 0; guard < adjacency.size + 4; guard++) {
            visitedEdges.add(edgeKey(previous, current));
            chain.push(current);
            if (current === start) { closed = true; break; }
            const nextOptions = Array.from(adjacency.get(current) || []).filter(next => next !== previous && !visitedEdges.has(edgeKey(current, next)));
            if (nextOptions.length !== 1) break;
            previous = current; current = nextOptions[0];
          }
          if (closed && chain.length >= 4) generatedCutLoops.push(chain.map(key => vertices.get(key)!.toArray()));
        });
      });
      if (!generatedCutLoops.length) { geometry.dispose(); before.dispose(); setStatus(tool + ' cancelled: cut did not form a complete closed loop'); return; }
      names.forEach(name => { const attr = geometry.getAttribute(name); const values: number[] = []; output.forEach(({ tri }) => tri.forEach(corner => values.push(...corner[name]))); geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attr.itemSize, attr.normalized)); });
      geometry.clearGroups();
      let groupStart = 0, lastMaterial = output[0]?.materialIndex ?? 0, groupCount = 0;
      output.forEach(({ materialIndex }, index) => { if (materialIndex !== lastMaterial) { if (groupCount) geometry.addGroup(groupStart, groupCount, lastMaterial); groupStart += groupCount; groupCount = 0; lastMaterial = materialIndex; } groupCount += 3; });
      if (groupCount) geometry.addGroup(groupStart, groupCount, lastMaterial);
      geometry.computeVertexNormals();
    } else if (tool === 'Extrude') {
      const normal = new THREE.Vector3();
      if (selectedPoints.length >= 3) normal.crossVectors(selectedPoints[1].clone().sub(selectedPoints[0]), selectedPoints[2].clone().sub(selectedPoints[0])).normalize();
      if (normal.lengthSq() < 1e-9) normal.set(0,0,1);
      const offset = normal.multiplyScalar(depth);
      if (editModeRef.current === 'Face' && selectedPoints.length === 3) {
        const selectedVertexIds = new Set(ids);
        const sourcePosition = geometry.getAttribute('position');
        const sourceIndex = geometry.index;
        const pointKey = (v: THREE.Vector3) =>
          [v.x, v.y, v.z].map(n => Math.round(n * 1e5)).join(',');
        const triangleKey = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
          [pointKey(a), pointKey(b), pointKey(c)].sort().join('|');
        const selectedTriangleKeys = new Set<string>();
        const sourceCount = sourceIndex ? sourceIndex.count : (sourcePosition?.count || 0);
        const sourceVertex = (offset: number) =>
          sourceIndex ? sourceIndex.getX(offset) : offset;
        if (sourcePosition) {
          for (let start = 0; start + 2 < sourceCount; start += 3) {
            const vertexIds = [sourceVertex(start), sourceVertex(start + 1), sourceVertex(start + 2)];
            if (!vertexIds.every(index => selectedVertexIds.has(index))) continue;
            const points = vertexIds.map(index =>
              new THREE.Vector3().fromBufferAttribute(sourcePosition, index)
            );
            selectedTriangleKeys.add(triangleKey(points[0], points[1], points[2]));
          }
        }
        if (!selectedTriangleKeys.size) {
          geometry.dispose(); before.dispose();
          setStatus('Extrude cancelled: selected face region has no matching triangles');
          return;
        }
        geometry = geometry.toNonIndexed();
        const p = geometry.getAttribute('position');
        const data: number[] = Array.from(p.array as ArrayLike<number>);
        const boundary = new Map<string, { count: number; a: THREE.Vector3; b: THREE.Vector3 }>();
        let movedTriangles = 0;
        for (let start = 0; start + 2 < p.count; start += 3) {
          const tri = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, start + k));
          if (!selectedTriangleKeys.has(triangleKey(tri[0], tri[1], tri[2]))) continue;
          movedTriangles++;
          tri.forEach((v, k) => {
            extrudedCapIndices.push(start + k);
            const moved = v.clone().add(offset);
            data[(start + k) * 3] = moved.x;
            data[(start + k) * 3 + 1] = moved.y;
            data[(start + k) * 3 + 2] = moved.z;
          });
          for (let k = 0; k < 3; k++) {
            const a = tri[k], b = tri[(k + 1) % 3];
            const keyA = pointKey(a), keyB = pointKey(b);
            const key = keyA < keyB ? keyA + '|' + keyB : keyB + '|' + keyA;
            const entry = boundary.get(key);
            if (entry) entry.count += 1;
            else boundary.set(key, { count: 1, a, b });
          }
        }
        if (movedTriangles) {
          boundary.forEach(edge => {
            if (edge.count !== 1) return;
            const a = edge.a, b = edge.b, an = a.clone().add(offset), bn = b.clone().add(offset);
            [a, b, bn, a, bn, an].forEach(v => data.push(v.x, v.y, v.z));
            // Commit each extruded side-wall perimeter as explicit topology lines.
            // This keeps the raised cell outline visible even where faces are coplanar.
            generatedCutLoops.push([a, b, bn, an, a].map(point => point.toArray()));
          });
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
        } else {
          geometry.dispose(); before.dispose();
          setStatus('Extrude cancelled: selected face region could not be matched after triangulation');
          return;
        }
      } else if (editModeRef.current === 'Edge' && selectedPoints.length >= 2) {
        const p = geometry.getAttribute('position');
        const a=selectedPoints[0], b=selectedPoints[1], an=a.clone().add(offset), bn=b.clone().add(offset);
        const data: number[] = Array.from(p.array as ArrayLike<number>);
        [a,b,bn,a,bn,an].forEach(v => data.push(v.x,v.y,v.z));
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data,3));
      } else {
        const p = geometry.getAttribute('position');
        ids.forEach(i => { if (i>=0 && i<p.count) p.setXYZ(i,p.getX(i)+offset.x,p.getY(i)+offset.y,p.getZ(i)+offset.z); });
        p.needsUpdate = true;
      }
      geometry.computeVertexNormals();
    }
    // Re-weld coincident vertices after topology-changing operations so adjacent faces share indices.
    // UVs are regenerated safely if topology changes; normals and bounds are always rebuilt below.
    if (tool === 'Extrude') {
      target.userData.nexusHasExtrusion = true;
      // Keep UV and material seams as authored; the new side walls receive interpolated
      // fallback UVs only when no usable UV attribute exists.
      geometry.computeVertexNormals();
    }
    const finalPosition = geometry.getAttribute('position');
    if (finalPosition) {
      Object.entries(geometry.attributes).forEach(([name, rawAttribute]: [string, any]) => {
        if (name === 'position' || rawAttribute.count === finalPosition.count) return;
        if (name === 'normal') { geometry.deleteAttribute('normal'); return; }
        const values = new Float32Array(finalPosition.count * rawAttribute.itemSize);
        values.set(Array.from(rawAttribute.array as ArrayLike<number>).slice(0, values.length));
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, rawAttribute.itemSize, rawAttribute.normalized));
      });
      if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(finalPosition.count * 2), 2));
    }
    const finalPositions = geometry.getAttribute('position');
    if (finalPositions) finalPositions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (tool === 'Subdivide' || tool === 'LoopCut' || tool === 'Extrude') {
      const retainedLoops = previousCutLoops;
      target.userData.cutLoops = [...retainedLoops, ...generatedCutLoops.map(loop => loop.map(point => [...point]))];
    }
    const afterCutLoops = Array.isArray(target.userData.cutLoops) ? (target.userData.cutLoops as number[][][]).map(loop => loop.map(point => [...point])) : [];
    const after = geometry.clone();
    const afterQuadGridState = tool === 'Subdivide' && target.userData.nexusQuadGrid === true
      ? { enabled: true, layout: 'canonical-v1', bounds: null, divisions: 0 }
      : tool === 'Subdivide'
        ? { enabled: false, layout: null, bounds: null, divisions: 0 }
        : tool === 'LoopCut'
        ? { enabled: false, layout: null, bounds: null, divisions: 0 }
        : captureQuadGridState();
    target.geometry.dispose(); target.geometry = geometry;
    restoreQuadGridState(afterQuadGridState);
    // Keep the working snapshot synchronized with the committed live mesh.
    editBaseGeometry.current?.dispose();
    editBaseGeometry.current = target.geometry.clone();
    const beforeSnapshot = before.clone();
    recordSceneAction({
      label: tool + ' selected ' + editModeRef.current.toLowerCase() + ' on ' + target.name,
      undo: () => {
        target.geometry.dispose(); target.geometry = beforeSnapshot.clone();
        target.geometry.computeVertexNormals(); target.geometry.computeBoundingBox();
        target.userData.cutLoops = previousCutLoops.map(loop => loop.map(point => [...point]));
        restoreQuadGridState(beforeQuadGridState);
        runtime.current?.refreshTopologyOverlay?.(target);
      },
      redo: () => {
        target.geometry.dispose(); target.geometry = after.clone();
        target.geometry.computeVertexNormals(); target.geometry.computeBoundingBox();
        target.userData.cutLoops = afterCutLoops.map(loop => loop.map(point => [...point]));
        restoreQuadGridState(afterQuadGridState);
        runtime.current?.refreshTopologyOverlay?.(target);
      }
    });
    before.dispose();
    if (tool === 'Subdivide' || tool === 'LoopCut' || tool === 'Extrude' || tool === 'Smooth') {
      runtime.current?.refreshTopologyOverlay?.(target);
    }
    if (tool === 'Extrude' && editModeRef.current === 'Face' && extrudedCapIndices.length >= 3) {
      // Keep the moved cap selected: the gizmo and future depth-slider updates stay
      // attached to the top face instead of disappearing after the extrusion.
      runtime.current?.restoreExtrudedFaceSelection?.(target, extrudedCapIndices);
      runtime.current?.refreshTopologyOverlay?.(target);
    } else runtime.current?.clearSubSelection?.();
    if (tool !== 'LoopCut') loopCutContext.current = null;
    if (tool !== 'Extrude') extrudeContext.current = null;
    if (tool === 'LoopCut') setActiveEditTool('');
    setStatus(tool === 'Extrude' ? 'Face extruded · gizmo stays on the raised face; edge loops are visible' : tool === 'LoopCut' ? 'Loop Cut committed to mesh geometry' : tool + ' applied to actual mesh geometry · reselect the edited face to continue');
  };
  if (runtime.current) {
    runtime.current.loopCutActive = activeEditTool === 'Cutting';
    runtime.current.commitLoopCut = (mesh: THREE.Mesh, indices: number[], amount: number) => {
      loopCutContext.current = { meshId: String(mesh.userData.editorId), indices: [...indices] };
      editBaseGeometry.current?.dispose();
      editBaseGeometry.current = mesh.geometry.clone();
      setEditAmount(amount);
      applyGeometryTool('LoopCut', amount, { mesh, indices });
    };
  }
  const deleteSelected = () => {
    const r = runtime.current;
    if (!r || !selected || cameraView) { setStatus('Select an object to delete'); return; }
    const obj = r.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected);
    if (!obj || obj === r.camBody) return;
    const parent = obj.parent || r.scene;
    r.removeObject(obj, true);
    recordSceneAction({ label: 'Delete ' + obj.name, undo: () => { if (parent === r.scene) r.scene.add(obj); else parent.add(obj); if (!r.selectable.includes(obj)) r.selectable.push(obj); r.selectObject(obj); setItems(r.selectable.map((o: THREE.Object3D) => ({ id: o.userData.editorId, name: o.name, object: o, kind: o.userData.kind || o.type }))); setObjectCount(r.selectable.length); }, redo: () => r.removeObject(obj, true) });
  };
  const duplicate = () => {
    const r = runtime.current;
    const obj = r?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected);
    if (obj && !cameraView) r.addObject(obj.userData.kind || obj.name.split(' ')[0], obj.name + ' copy', obj);
    else setStatus('Select an object to duplicate');
  };
  const toggleCamera = () => {
    const r = runtime.current;
    if (!r) return;
    const next = !cameraView;
    r.cameraView = next;
    setCameraView(next);
    if (next) {
        r.activeCamera.position.copy(r.camBody.position);
        r.activeCamera.quaternion.copy(r.camBody.quaternion);
        r.activeOrbit.target.copy(r.activeCamera.position).add(new THREE.Vector3(0, 0, -3).applyQuaternion(r.activeCamera.quaternion));
      } else {
        r.camBody.position.copy(r.activeCamera.position);
        r.camBody.quaternion.copy(r.activeCamera.quaternion);
      }
      r.orbit.enabled = !next;
      r.activeOrbit.enabled = next;
      r.transform.enabled = editModeRef.current === 'Object';
      r.transform.camera = next ? r.activeCamera : r.camera;
      r.transform.getHelper().visible = Boolean(selectedRef.current);
    setStatus(next ? 'CAM: Cine camera perspective active' : 'Perspective User View restored');
  };
  useEffect(() => {
    let controlHeld = false;
    let shiftHeld = false;
    const applySnap = (enabled: boolean, fine: boolean) => {
      const t = runtime.current?.transform;
      if (!t) return;
      t.setTranslationSnap(enabled ? 0.5 / (fine ? 10 : 1) : null);
      t.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15 / (fine ? 3 : 1)) : null);
      t.setScaleSnap(enabled ? 0.1 / (fine ? 2 : 1) : null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control' && !controlHeld) {
        controlHeld = true;
        applySnap(true, shiftHeld);
      }
      if (event.key === 'Shift' && !shiftHeld) {
        shiftHeld = true;
        if (snapOn || controlHeld) applySnap(true, true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
        controlHeld = false;
        applySnap(snapOn, shiftHeld && snapOn);
      }
      if (event.key === 'Shift') {
        shiftHeld = false;
        applySnap(snapOn || controlHeld, false);
      }
    };
    const onBlur = () => {
      controlHeld = false;
      shiftHeld = false;
      applySnap(snapOn, false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [snapOn]);

  const toggleSnap = () => {
    const next = !snapOn;
    setSnapOn(next);
    const t = runtime.current?.transform;
    if (t) {
      t.setTranslationSnap(next ? 0.5 : null);
      t.setRotationSnap(next ? THREE.MathUtils.degToRad(15) : null);
      t.setScaleSnap(next ? 0.1 : null);
    }
    setStatus(next ? 'Snapping enabled · Ctrl temporary · Shift fine snap' : 'Snapping disabled');
  };
  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
      try { await (screen.orientation as any)?.lock?.('landscape'); } catch { /* Browser or OS may block orientation locking. */ }
      setFullscreen(Boolean(document.fullscreenElement));
    } catch { setStatus('Use your browser menu for fullscreen mode'); }
  };
  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    const alreadyStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const timer = !alreadyStandalone && !sessionStorage.getItem('nexus3d-install-dismissed')
      ? window.setTimeout(() => setShowInstall(true), 1800)
      : undefined;
    const fn = () => setFullscreen(Boolean(document.fullscreenElement));
    const orient = () => setPortrait(window.innerHeight > window.innerWidth);

    document.addEventListener('fullscreenchange', fn);
    window.addEventListener('orientationchange', orient);
    orient();
    return () => { if (timer) window.clearTimeout(timer); document.removeEventListener('fullscreenchange', fn); window.removeEventListener('orientationchange', orient); window.removeEventListener('beforeinstallprompt', onInstall); };
  }, []);

  const applyInterpolatedFrame = (atFrame: number) => {
    const r = runtime.current;
    if (!r) return;
    Object.entries(keysRef.current).forEach(([id, track]) => {
      const obj = r.selectable.find((o: THREE.Object3D) => o.userData.editorId === id);
      if (!obj) return;
      const entries = Object.keys(track).map(Number).sort((a, b) => a - b).map(key => ({ frame: key, value: track[key] }));
      if (!entries.length) return;
      let left = entries[0], right = entries[entries.length - 1];
      if (atFrame <= left.frame) { applySnapshot(obj, left.value); return; }
      if (atFrame >= right.frame) { applySnapshot(obj, right.value); return; }
      for (let i = 0; i < entries.length - 1; i++) {
        if (atFrame >= entries[i].frame && atFrame <= entries[i + 1].frame) { left = entries[i]; right = entries[i + 1]; break; }
      }
      const span = Math.max(1, right.frame - left.frame);
      let t = THREE.MathUtils.clamp((atFrame - left.frame) / span, 0, 1);
      if (interpolation === 'Ease In-Out') t = t * t * (3 - 2 * t);
      else if (interpolation === 'Bounce') { const n = 7.5625, d = 2.75; if (t < 1 / d) t = n * t * t; else if (t < 2 / d) { t -= 1.5 / d; t = n * t * t + .75; } else if (t < 2.5 / d) { t -= 2.25 / d; t = n * t * t + .9375; } else { t -= 2.625 / d; t = n * t * t + .984375; } }
      else if (interpolation === 'Anticipation') { const s = 1 + curveTension / 25; t = t * t * ((s + 1) * t - s); }
      else if (interpolation === 'Spring Damping') { const raw = 1 - Math.exp(-(3 + curveWeight / 15) * t) * Math.cos((5 + curveTangent / 8) * t); const end = 1 - Math.exp(-(3 + curveWeight / 15)) * Math.cos(5 + curveTangent / 8); t = THREE.MathUtils.clamp(raw / Math.max(.001, end), -0.15, 1.15); }
      else if (interpolation === 'Ease In') t = Math.pow(t, 1 + curveWeight / 25);
      else if (interpolation === 'Ease Out') t = 1 - Math.pow(1 - t, 1 + curveWeight / 25);
      const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * t);
      applySnapshot(obj, { position: mix(left.value.position, right.value.position), rotation: mix(left.value.rotation, right.value.rotation), scale: mix(left.value.scale, right.value.scale) });
    });
  };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setFrame(current => {
        const nextFrame = current >= workEnd ? (loopPlayback ? workStart : workEnd) : Math.min(workEnd, current + Math.max(1, Math.round(frameRate / 30)));
        frameRef.current = nextFrame;
        applyInterpolatedFrame(nextFrame);
        if (nextFrame === workEnd && !loopPlayback) setPlaying(false);
        return nextFrame;
      });
    }, Math.max(8, Math.round(1000 / frameRate)));
    return () => window.clearInterval(timer);
  }, [playing, frameRate, loopPlayback, interpolation, curveWeight, curveTension, curveTangent, workStart, workEnd]);

  const setCurrentFrame = (nextFrame: number) => {
    const rawFrame = Math.max(workStart, Math.min(workEnd, Math.round(nextFrame)));
    const clamped = snapOn ? Math.round(rawFrame / 5) * 5 : rawFrame;
    frameRef.current = clamped;
    setFrame(clamped);
    applyInterpolatedFrame(clamped);
    if (autoKeyRef.current) captureRef.current();
  };
  const copyFrame = () => {
    const data: FrameData = {};
    Object.entries(keysRef.current).forEach(([id, frames]) => { if (frames[frame]) data[id] = frames[frame]; });
    if (!Object.keys(data).length && selected) {
      const obj = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected);
      if (obj) data[selected] = snapshot(obj);
    }
    setCopiedFrame(data);
    setStatus(Object.keys(data).length ? 'Frame data copied' : 'No frame data to copy');
  };
  const pasteFrame = () => {
    if (!copiedFrame) { setStatus('Copy a frame first'); return; }
    const next: Keyframes = JSON.parse(JSON.stringify(keysRef.current));
    Object.entries(copiedFrame).forEach(([id, data]) => { next[id] = { ...(next[id] || {}), [frame]: data }; });
    commitKeys(next);
    Object.entries(copiedFrame).forEach(([id, data]) => {
      const obj = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === id);
      if (obj) applySnapshot(obj, data);
    });
    setStatus('Frame data pasted at F: ' + String(frame).padStart(3, '0'));
  };
  const deleteFrame = () => {
    const next: Keyframes = JSON.parse(JSON.stringify(keysRef.current));
    let removed = false;
    const target = selectedKeyframe || null;
    if (target && next[target.id]?.[target.frame] !== undefined) { delete next[target.id][target.frame]; removed = true; if (!Object.keys(next[target.id]).length) delete next[target.id]; }
    else Object.keys(next).forEach(id => { if (next[id][frame] !== undefined) { delete next[id][frame]; removed = true; } if (!Object.keys(next[id]).length) delete next[id]; });
    if (removed) { commitKeys(next); setSelectedKeyframe(null); }
    setStatus(removed ? 'Selected keyframe deleted' : 'No keyframe selected at this frame');
  };
  const undo = () => {
    if (actionUndoStack.length) {
      const action = actionUndoStack[actionUndoStack.length - 1];
      action.undo(); setActionUndoStack(prev => prev.slice(0, -1)); setActionRedoStack(prev => [...prev, action]); setStatus(action.label + ' undone'); return;
    }
    if (!undoStack.length) { setStatus('Nothing to undo'); return; }
    const previous = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, JSON.parse(JSON.stringify(keysRef.current))]);
    setUndoStack(prev => prev.slice(0, -1));
    keysRef.current = previous; setKeyframes(previous); setStatus('Timeline edit undone');
  };
  const redo = () => {
    if (actionRedoStack.length) {
      const action = actionRedoStack[actionRedoStack.length - 1];
      action.redo(); setActionRedoStack(prev => prev.slice(0, -1)); setActionUndoStack(prev => [...prev, action]); setStatus(action.label + ' redone'); return;
    }
    if (!redoStack.length) { setStatus('Nothing to redo'); return; }
    const next = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, JSON.parse(JSON.stringify(keysRef.current))]);
    setRedoStack(prev => prev.slice(0, -1));
    keysRef.current = next; setKeyframes(next); setStatus('Timeline edit redone');
  };
  const totalKeys = Object.values(keyframes).reduce((n, track) => n + Object.keys(track).length, 0);
  const setEditorSetting = (key: string, value: number | string | boolean) => {
    const previous = settings[key];
    if (previous !== value) recordSceneAction({ label: 'Change ' + key, undo: () => { setSettings(prev => ({ ...prev, [key]: previous })); runtime.current?.applySettings(key, previous as number | string | boolean); }, redo: () => { setSettings(prev => ({ ...prev, [key]: value })); runtime.current?.applySettings(key, value); } });
    setSettings(prev => ({ ...prev, [key]: value }));
    runtime.current?.applySettings(key, value);
  };
  const menuCategories = [
    { title: 'Project & File', icon: <FileJson size={13} /> },
    { title: 'Editor Settings & Preferences', icon: <Settings2 size={13} /> },
    { title: 'Help & System Info', icon: <Info size={13} /> },
  ];
  const settingSlider = (label: string, key: string, min: number, max: number, step = 0.01) => {
    const locked = Boolean(lockedSliders[key]);
    return <label className={'setting-slider ' + (locked ? 'slider-locked' : '')} key={key}>
      <span className="setting-slider-heading"><span>{label}</span><output>{Number(settings[key] ?? min).toFixed(step < 1 ? 2 : 0)}</output><button type="button" className="slider-lock" aria-label={(locked ? 'Unlock ' : 'Lock ') + label} title={locked ? 'Unlock slider' : 'Lock slider'} onClick={e => { e.preventDefault(); e.stopPropagation(); setLockedSliders(prev => ({ ...prev, [key]: !prev[key] })); }}>{locked ? <Lock size={11} /> : <Unlock size={11} />}</button></span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={Number(settings[key] ?? min)} disabled={locked} onChange={e => setEditorSetting(key, Number(e.target.value))} />
    </label>;
  };
  const settingColor = (label: string, key: string) => (
    <label className="setting-color" key={key}><span>{label}</span><input aria-label={label} type="color" value={String(settings[key] || '#ffffff')} onChange={e => setEditorSetting(key, e.target.value)} /></label>
  );
  const lightPanel = (type: 'Directional' | 'Point' | 'Spot' | 'Ambient' | 'Hemisphere', title: string, icon: React.ReactNode) => {
    const lights = items.filter(item => item.kind === 'Light' && item.object.userData.lightType === type);
    return <section className="light-control-card" key={type}>
      <div className="light-control-heading"><button type="button" onClick={() => setLightPanelOpen(prev => ({ ...prev, [type]: !prev[type] }))}>{icon}<strong>{title}</strong><span>{lights.length}</span>{lightPanelOpen[type] ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</button><button type="button" className="light-add" onClick={() => runtime.current?.addSceneLight(type)} aria-label={'Add ' + title}>+</button></div>
      {lightPanelOpen[type] && <div className="light-control-body">{lights.length === 0 && <small className="light-empty">No {title.toLowerCase()} added</small>}{lights.map(item => {
        const object = item.object as THREE.Light;
        const locked = Boolean(lightLocks[item.id]);
        const color = 'color' in object ? '#' + (object as any).color.getHexString() : '#ffffff';
        const numeric = (label: string, property: string, value: number, step = 0.1) => <label className="light-number" key={property}><span>{label}</span><BufferedNumberInput ariaLabel={item.name + ' ' + label} value={Number.isFinite(value) ? value : 0} step={step} disabled={locked} onCommit={n => runtime.current?.updateLightProperty(item.id, property, n)}/></label>;
        return <div className={'light-source-card ' + (selected === item.id ? 'light-source-selected' : '')} key={item.id}>
          <div className="light-source-title"><button type="button" className="light-source-name" onClick={() => runtime.current?.selectObject(item.object)}>{item.name}</button><label className="light-power"><input type="checkbox" aria-label={'Enable ' + item.name} checked={object.visible} onChange={e => runtime.current?.toggleLightEnabled(item.id, e.target.checked)}/><span>{object.visible ? 'ON' : 'OFF'}</span></label><button type="button" className={'light-lock ' + (locked ? 'is-locked' : '')} title={locked ? 'Unlock light properties' : 'Lock light properties'} aria-label={(locked ? 'Unlock ' : 'Lock ') + item.name} onClick={() => setLightLocks(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>{locked ? <Lock size={11}/> : <Unlock size={11}/>}</button></div>
          <label className="light-color-field"><span>Color</span><input aria-label={item.name + ' color'} type="color" value={color} disabled={locked} onChange={e => runtime.current?.updateLightProperty(item.id, 'color', e.target.value)}/></label>
          {numeric('Intensity', 'intensity', object.intensity, 0.1)}
          {(object instanceof THREE.PointLight || object instanceof THREE.SpotLight) && <>{numeric('Range / Distance', 'distance', object.distance, 0.5)}{numeric('Decay', 'decay', object.decay, 0.1)}</>}
          {object instanceof THREE.SpotLight && numeric('Cone Angle °', 'angle', THREE.MathUtils.radToDeg(object.angle), 1)}
          {object instanceof THREE.HemisphereLight && <label className="light-color-field"><span>Ground Color</span><input type="color" aria-label={item.name + ' ground color'} value={'#' + object.groundColor.getHexString()} disabled={locked} onChange={e => runtime.current?.updateLightProperty(item.id, 'groundColor', e.target.value)}/></label>}
          {(object as any).shadow && <>{numeric('Shadow Bias', 'shadowBias', (object as any).shadow.bias, 0.0001)}{numeric('Shadow Radius', 'shadowRadius', (object as any).shadow.radius, 0.1)}</>}
        </div>;
      })}</div>}
    </section>;
  };
  const handleTextureUpload = (event: React.ChangeEvent<HTMLInputElement>, hdr = false) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (hdr) {
      setHdrPreview(file.name);
      import('three/examples/jsm/loaders/RGBELoader.js').then(({ RGBELoader }) => {
        new RGBELoader().load(url, (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          if (runtime.current?.scene) runtime.current.scene.environment = texture;
          setStatus('HDR environment loaded');
        }, undefined, () => setStatus('Could not read HDR environment'));
      }).catch(() => setStatus('HDR loader unavailable'));
    } else {
      setTexturePreview(file.name);
      new THREE.TextureLoader().load(url, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const obj = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selectedRef.current);
        if (!obj) { setStatus('Select a mesh before applying an image texture'); return; }
        obj.traverse((node: any) => { if (node.isMesh) (Array.isArray(node.material) ? node.material : [node.material]).forEach((m: any) => { m.map = texture; m.needsUpdate = true; }); });
        setStatus('Texture applied to selected object');
      }, undefined, () => setStatus('Texture image could not be loaded'));
    }
  };

  const getProjectData = () => {
    const r = runtime.current;
    return {
      app: 'Nexus3D',
      version: 2,
      savedAt: new Date().toISOString(),
      keyframes: JSON.parse(JSON.stringify(keysRef.current)),
      objects: (r?.selectable || []).map((obj: THREE.Object3D) => ({
        editorId: obj.userData.editorId || null,
        // Preserve editor-specific metadata used by topology, modeling and other tools.
        editorData: (() => {
          try {
            return JSON.parse(JSON.stringify(obj.userData, (key, value) =>
              key === 'parent' || key === 'object' || key === 'mesh' || key === 'scene' ? undefined : value
            ));
          } catch { return {}; }
        })(),
        name: obj.name,
        kind: obj.userData.kind || obj.type,
        objectType: obj.type,
        lightType: obj.userData.lightType || null,
        light: obj instanceof THREE.Light ? {
          color: obj.color?.getHexString?.() || 'ffffff',
          intensity: obj.intensity,
          distance: obj instanceof THREE.PointLight || obj instanceof THREE.SpotLight ? obj.distance : undefined,
          decay: obj instanceof THREE.PointLight || obj instanceof THREE.SpotLight ? obj.decay : undefined,
          angle: obj instanceof THREE.SpotLight ? obj.angle : undefined,
          groundColor: obj instanceof THREE.HemisphereLight ? obj.groundColor.getHexString() : undefined,
          shadowBias: (obj as any).shadow?.bias,
          shadowRadius: (obj as any).shadow?.radius
        } : undefined,
        geometry: obj instanceof THREE.Mesh ? {
          attributes: Object.fromEntries(Object.entries(obj.geometry.attributes).map(([key, attribute]: [string, any]) => [key, { itemSize: attribute.itemSize, normalized: attribute.normalized, array: Array.from(attribute.array as ArrayLike<number>) }])),
          index: obj.geometry.index ? Array.from(obj.geometry.index.array as ArrayLike<number>) : null,
          groups: obj.geometry.groups.map(group => ({ ...group }))
        } : undefined,
        material: obj instanceof THREE.Mesh ? (Array.isArray(obj.material) ? obj.material : [obj.material]).map((mat: any) => ({
          type: mat.type,
          color: mat.color?.getHexString?.() || null,
          roughness: Number.isFinite(mat.roughness) ? mat.roughness : null,
          metalness: Number.isFinite(mat.metalness) ? mat.metalness : null,
          opacity: Number.isFinite(mat.opacity) ? mat.opacity : 1,
          transparent: Boolean(mat.transparent),
          emissive: mat.emissive?.getHexString?.() || null,
          emissiveIntensity: Number.isFinite(mat.emissiveIntensity) ? mat.emissiveIntensity : 0
        })) : undefined,
        meshTopology: obj instanceof THREE.Mesh ? {
          cutLoops: Array.isArray(obj.userData.cutLoops) ? obj.userData.cutLoops.map((loop: number[][]) => loop.map(point => [...point])) : [],
          quadGrid: Boolean(obj.userData.nexusQuadGrid),
          quadGridLayout: obj.userData.nexusQuadGridLayout || null,
          cubeGridBounds: obj.userData.nexusCubeGridBounds ? JSON.parse(JSON.stringify(obj.userData.nexusCubeGridBounds)) : null,
          cubeGridDivisions: Number(obj.userData.nexusCubeGridDivisions || 0)
        } : undefined,
        position: obj.position.toArray(),
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: obj.scale.toArray(),
        visible: obj.visible,
        castShadow: Boolean((obj as any).castShadow),
        receiveShadow: Boolean((obj as any).receiveShadow),
        parentEditorId: obj.parent?.userData?.editorId || null,
        parentName: obj.parent?.userData?.editorId ? obj.parent.name : null
      }))
    };
  };
  const saveProject = () => {
    try {
      const data = getProjectData();
      const serialized = JSON.stringify({ ...data, projectName: projectName.trim() || 'Project.nexus' }, null, 2);
      localStorage.setItem('nexus3d-project-v1', serialized);
      const blob = new Blob([serialized], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeName = (projectName.trim() || 'Project.nexus').replace(/[^a-z0-9._-]/gi, '_');
      link.download = safeName.toLowerCase().endsWith('.nexus') || safeName.toLowerCase().endsWith('.json') ? safeName : safeName + '.nexus';
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Project saved and downloaded as ' + link.download);
    } catch {
      setStatus('Unable to save project on this device');
    }
  };
  const loadProject = () => {
    if (projectFileRef.current) projectFileRef.current.click();
  };
  const handleProjectFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result || '');
        const data = JSON.parse(raw);
        const r = runtime.current;
        if (!r || !Array.isArray(data.objects)) {
          setStatus('Project file is invalid or contains no scene objects');
          return;
        }
        if (data.projectName) setProjectName(String(data.projectName));
        const restoredById = new Map<string, THREE.Object3D>();
        const restoredByName = new Map<string, THREE.Object3D>();

        // First pass: resolve existing editor objects, or create missing scene objects.
        // This is the key difference from the old loader, which only updated objects
        // already present in the current scene.
        data.objects.forEach((saved: any) => {
          if (!saved || typeof saved.name !== 'string') return;
          let obj = saved.editorId
            ? r.selectable.find((candidate: THREE.Object3D) => candidate.userData.editorId === saved.editorId)
            : undefined;
          if (!obj) {
            obj = r.selectable.find((candidate: THREE.Object3D) =>
              candidate.name === saved.name &&
              (candidate.userData.kind || candidate.type) === saved.kind
            );
          }

          if (!obj && saved.kind === 'Light' && saved.lightType && typeof r.addSceneLight === 'function') {
            obj = r.addSceneLight(saved.lightType);
          } else if (!obj && saved.geometry?.attributes?.position?.array) {
            const geometry = new THREE.BufferGeometry();
            Object.entries(saved.geometry.attributes).forEach(([key, value]: [string, any]) => {
              if (!Array.isArray(value?.array) || !Number.isInteger(value.itemSize) || value.itemSize < 1) return;
              geometry.setAttribute(key, new THREE.Float32BufferAttribute(value.array, value.itemSize, Boolean(value.normalized)));
            });
            if (Array.isArray(saved.geometry.index)) geometry.setIndex(saved.geometry.index);
            if (Array.isArray(saved.geometry.groups)) saved.geometry.groups.forEach((group: any) => {
              if (Number.isFinite(group.start) && Number.isFinite(group.count)) geometry.addGroup(group.start, group.count, Number(group.materialIndex) || 0);
            });
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            const materialData = Array.isArray(saved.material) ? saved.material[0] : null;
            const material = new THREE.MeshPhysicalMaterial({
              color: materialData?.color ? '#' + materialData.color : '#b6d8ff',
              roughness: Number.isFinite(materialData?.roughness) ? materialData.roughness : 0.35,
              metalness: Number.isFinite(materialData?.metalness) ? materialData.metalness : 0.18,
              opacity: Number.isFinite(materialData?.opacity) ? materialData.opacity : 1,
              transparent: Boolean(materialData?.transparent),
              emissive: materialData?.emissive ? '#' + materialData.emissive : '#000000',
              emissiveIntensity: Number.isFinite(materialData?.emissiveIntensity) ? materialData.emissiveIntensity : 0
            });
            obj = new THREE.Mesh(geometry, material);
            obj.name = saved.name;
            obj.userData.kind = saved.kind || 'Mesh';
            obj.userData.editorId = saved.editorId || uid();
            obj.castShadow = saved.castShadow !== false;
            obj.receiveShadow = saved.receiveShadow !== false;
            r.scene.add(obj);
            r.selectable.push(obj);
          } else if (!obj && saved.kind === 'Bone') {
            obj = new THREE.Bone();
            obj.name = saved.name;
            obj.userData.kind = 'Bone';
            obj.userData.editorId = saved.editorId || uid();
            r.scene.add(obj);
            r.selectable.push(obj);
          } else if (!obj) {
            obj = new THREE.Group();
            obj.name = saved.name;
            obj.userData.kind = saved.kind || 'Group';
            obj.userData.editorId = saved.editorId || uid();
            r.scene.add(obj);
            r.selectable.push(obj);
          }

          if (!obj) return;
          obj.name = saved.name;
          if (saved.editorData && typeof saved.editorData === 'object') {
            Object.entries(saved.editorData).forEach(([key, value]) => {
              if (key !== 'editorId') obj!.userData[key] = value;
            });
          }
          obj.userData.kind = saved.kind || obj.userData.kind || obj.type;
          if (saved.editorId) obj.userData.editorId = saved.editorId;
          if (obj instanceof THREE.Mesh && saved.geometry?.attributes?.position?.array) {
            const restored = new THREE.BufferGeometry();
            Object.entries(saved.geometry.attributes).forEach(([key, value]: [string, any]) => {
              if (Array.isArray(value?.array) && Number.isInteger(value.itemSize) && value.itemSize > 0) {
                restored.setAttribute(key, new THREE.Float32BufferAttribute(value.array, value.itemSize, Boolean(value.normalized)));
              }
            });
            if (Array.isArray(saved.geometry.index)) restored.setIndex(saved.geometry.index);
            if (Array.isArray(saved.geometry.groups)) saved.geometry.groups.forEach((group: any) => {
              if (Number.isFinite(group.start) && Number.isFinite(group.count)) restored.addGroup(group.start, group.count, Number(group.materialIndex) || 0);
            });
            restored.computeVertexNormals();
            restored.computeBoundingBox();
            restored.computeBoundingSphere();
            obj.geometry.dispose();
            obj.geometry = restored;
            if (Array.isArray(saved.material) && saved.material.length) {
              const materials = saved.material.map((mat: any) => new THREE.MeshPhysicalMaterial({
                color: mat.color ? '#' + mat.color : '#b6d8ff',
                roughness: Number.isFinite(mat.roughness) ? mat.roughness : 0.35,
                metalness: Number.isFinite(mat.metalness) ? mat.metalness : 0.18,
                opacity: Number.isFinite(mat.opacity) ? mat.opacity : 1,
                transparent: Boolean(mat.transparent),
                emissive: mat.emissive ? '#' + mat.emissive : '#000000',
                emissiveIntensity: Number.isFinite(mat.emissiveIntensity) ? mat.emissiveIntensity : 0
              }));
              obj.material = materials.length === 1 ? materials[0] : materials;
            }
            if (saved.meshTopology) {
              obj.userData.cutLoops = Array.isArray(saved.meshTopology.cutLoops) ? saved.meshTopology.cutLoops.map((loop: number[][]) => loop.map(point => [...point])) : [];
              if (saved.meshTopology.quadGrid === true) {
                obj.userData.nexusQuadGrid = true;
                obj.userData.nexusQuadGridLayout = saved.meshTopology.quadGridLayout || 'canonical-v1';
              } else {
                delete obj.userData.nexusQuadGrid;
                delete obj.userData.nexusQuadGridLayout;
              }
              if (saved.meshTopology.cubeGridBounds) obj.userData.nexusCubeGridBounds = saved.meshTopology.cubeGridBounds;
              else delete obj.userData.nexusCubeGridBounds;
              if (Number(saved.meshTopology.cubeGridDivisions) > 0) obj.userData.nexusCubeGridDivisions = Number(saved.meshTopology.cubeGridDivisions);
              else delete obj.userData.nexusCubeGridDivisions;
            }
          }
          if (Array.isArray(saved.position) && saved.position.length === 3) obj.position.fromArray(saved.position);
          if (Array.isArray(saved.rotation) && saved.rotation.length === 3) obj.rotation.set(saved.rotation[0], saved.rotation[1], saved.rotation[2]);
          if (Array.isArray(saved.scale) && saved.scale.length === 3) obj.scale.fromArray(saved.scale);
          if (typeof saved.visible === 'boolean') obj.visible = saved.visible;
          if (obj instanceof THREE.Light && saved.light) {
            if (saved.light.color) obj.color.set('#' + saved.light.color);
            if (Number.isFinite(saved.light.intensity)) obj.intensity = saved.light.intensity;
            if ((obj instanceof THREE.PointLight || obj instanceof THREE.SpotLight) && Number.isFinite(saved.light.distance)) obj.distance = saved.light.distance;
            if ((obj instanceof THREE.PointLight || obj instanceof THREE.SpotLight) && Number.isFinite(saved.light.decay)) obj.decay = saved.light.decay;
            if (obj instanceof THREE.SpotLight && Number.isFinite(saved.light.angle)) obj.angle = saved.light.angle;
            if (obj instanceof THREE.HemisphereLight && saved.light.groundColor) obj.groundColor.set('#' + saved.light.groundColor);
            if ((obj as any).shadow && Number.isFinite(saved.light.shadowBias)) (obj as any).shadow.bias = saved.light.shadowBias;
            if ((obj as any).shadow && Number.isFinite(saved.light.shadowRadius)) (obj as any).shadow.radius = saved.light.shadowRadius;
          }
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = saved.castShadow !== false;
            obj.receiveShadow = saved.receiveShadow !== false;
          }
          if (saved.editorId) restoredById.set(saved.editorId, obj);
          restoredByName.set(saved.name, obj);
        });

        // Second pass: restore parent-child links after every saved object exists.
        data.objects.forEach((saved: any) => {
          const obj = saved?.editorId ? restoredById.get(saved.editorId) : restoredByName.get(saved?.name);
          if (!obj || obj === r.camBody) return;
          const parent = saved.parentEditorId
            ? restoredById.get(saved.parentEditorId)
            : saved.parentName ? restoredByName.get(saved.parentName) : null;
          const targetParent = parent && parent !== obj && !obj.getObjectById(parent.id) ? parent : r.scene;
          if (obj.parent !== targetParent) targetParent.add(obj);
        });

        if (data.keyframes && typeof data.keyframes === 'object') {
          const restoredKeys = data.keyframes as Keyframes;
          keysRef.current = restoredKeys;
          setKeyframes(restoredKeys);
          setUndoStack([]);
          setRedoStack([]);
          setActionUndoStack([]);
          setActionRedoStack([]);
        }
        r.scene.updateMatrixWorld(true);
        // Refresh React's Scene Tree from the restored runtime objects before
        // selecting one, so every loaded object gets the same editor controls
        // (select, visibility, rename, transform, hierarchy, delete) as a new object.
        r.syncItems?.();
        const restoredCount = data.objects.filter((saved: any) => saved && typeof saved.name === 'string').length;
        const firstSaved = data.objects.find((saved: any) => saved && typeof saved.name === 'string');
        const firstRestored = firstSaved
          ? (firstSaved.editorId ? restoredById.get(firstSaved.editorId) : restoredByName.get(firstSaved.name))
          : undefined;
        if (firstRestored) r.selectObject?.(firstRestored);
        else r.selectObject?.();
        setStatus('Project loaded · ' + restoredCount + ' saved scene objects restored to Scene Tree');
      } catch (error) {
        console.error('Nexus3D project load failed:', error);
        setStatus('Project file could not be loaded: invalid JSON or unsupported project data');
      }
    };
    reader.onerror = () => setStatus('Unable to read selected project file');
    reader.readAsText(file);
  };
  const createNewProject = () => {
    if (!window.confirm('Create new project? Unsaved progress will be lost')) return;
    const r = runtime.current;
    if (!r) return;
    const removable = [...(r.selectable || [])].filter((obj: THREE.Object3D) => obj.userData.kind !== 'Camera' && obj.name !== 'MainCamera');
    removable.forEach((obj: THREE.Object3D) => {
      obj.parent?.remove(obj);
      const index = r.selectable.indexOf(obj);
      if (index >= 0) r.selectable.splice(index, 1);
    });
    setSelected('');
    selectedRef.current = '';
    setFrame(0);
    frameRef.current = 0;
    setPlaying(false);
    setStatus('New project created');
    setMenuOpen(false);
  };
  const importModel = async (file?: File) => {
    if (!file || !runtime.current?.scene) return;
    const r = runtime.current;
    try {
      let object: THREE.Object3D;
      if (file.name.toLowerCase().endsWith('.obj')) {
        object = new OBJLoader().parse(await file.text());
      } else if (file.name.toLowerCase().endsWith('.gltf') || file.name.toLowerCase().endsWith('.glb')) {
        const buffer = await file.arrayBuffer();
        object = await new Promise<THREE.Object3D>((resolve, reject) => new GLTFLoader().parse(buffer, '', gltf => resolve(gltf.scene), reject));
      } else {
        setStatus('This browser build supports OBJ, GLTF and GLB import. FBX is not enabled yet.');
        return;
      }
      object.name = file.name.replace(/\\.(gltf|glb|obj|fbx)$/i, '') || 'Imported Model';
      const importedNodes: THREE.Object3D[] = [];
      object.traverse((node: any) => {
        if (!node.userData.editorId) node.userData.editorId = uid();
        node.userData.kind = node === object ? 'Imported Model' : node.isBone ? 'Bone' : node.isMesh ? 'Mesh' : 'GLTF Node';
        importedNodes.push(node);
        if (node.isMesh && node.geometry) {
          // Preserve indexed topology and shared vertex references from GLTF; do not flatten to non-indexed triangles.
          node.geometry.computeVertexNormals();
          node.geometry.computeBoundingBox();
          node.geometry.computeBoundingSphere();
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      r.scene.add(object);
      importedNodes.forEach(node => { if (!r.selectable.includes(node)) r.selectable.push(node); });
      r.syncItems?.();
      setStatus('Imported ' + file.name);
    } catch {
      setStatus('Model import failed. Check that the selected file is a valid OBJ, GLTF or GLB.');
    }
  };
  const exportProject = () => {
    const blob = new Blob([JSON.stringify(getProjectData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nexus3d-scene.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Scene JSON exported');
  };

  const exportRenderImage = () => {
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) { setStatus('Render image unavailable: viewport canvas not found'); return; }
    try {
      const link = document.createElement('a');
      link.download = 'nexus3d-render.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      setStatus('Render image downloaded as PNG');
    } catch {
      setStatus('Render image export failed; the canvas may contain a cross-origin texture');
    }
  };

  const toggleRenderRecording = () => {
    const canvas = hostRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (renderRecording && videoRecorder.current) { videoRecorder.current.stop(); return; }
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      setStatus('Video recording is not supported by this browser'); return;
    }
    const mimeType = renderFormat === 'MP4' && MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
    if (!mimeType) { setStatus('No supported video recording format found; choose WebM on a compatible browser'); return; }
    try {
      videoChunks.current = [];
      const stream = canvas.captureStream(renderFps);
      const recorder = new MediaRecorder(stream, { mimeType });
      videoRecorder.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size > 0) videoChunks.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(videoChunks.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'nexus3d-animation.' + (mimeType.includes('mp4') ? 'mp4' : 'webm');
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        stream.getTracks().forEach(track => track.stop());
        videoRecorder.current = null;
        setRenderRecording(false);
        setRenderProgress(100);
        setStatus('Viewport recording exported');
      };
      recorder.start(250);
      setRenderRecording(true);
      setRenderProgress(0);
      setStatus('Recording viewport video. Tap Stop Render to export.');
    } catch {
      setRenderRecording(false);
      setStatus('Could not start viewport recording in this browser');
    }
  };

  return (
    <main className={'editor-shell ' + (animationMode ? 'animation-mode' : '')}>
      <div className={'viewport ' + (pathTool ? 'path-tool-active' : '')} ref={hostRef} onPointerDown={e => { if (!pathTool || animationMode) return; const rect = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - rect.left) / rect.width - .5) * 20; const z = ((e.clientY - rect.top) / rect.height - .5) * -20; setMotionPathPoints(prev => [...prev, {x, y:0.05, z}]); }} onDragOver={e => { if (e.dataTransfer.types.includes('text/nexus3d-object')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={e => { const childId = e.dataTransfer.getData('text/nexus3d-object'); if (!childId) return; e.preventDefault(); const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); if (child) runtime.current?.reparentObject(child); }} />
      <div className={'camera-mode-hud ' + (cameraView ? 'cine-active' : '')} aria-live="polite"><span className="camera-mode-dot" />{cameraView ? 'CINE CAMERA VIEW' : 'PERSPECTIVE MODE'}</div>
      {!animationMode && !cameraView && <div className="quick-access-rail" aria-label="Quick access controls">
        <button type="button" className={quickPanel === 'lights' ? 'active' : ''} onClick={() => { setQuickPanel(quickPanel === 'lights' ? null : 'lights'); setInspectorOpen(false); setPanel(false); setMenuOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Quick Light Controls"><Sun size={14}/><span>LIGHTS</span></button>
        <button type="button" className={quickPanel === 'materials' ? 'active' : ''} onClick={() => { setQuickPanel(quickPanel === 'materials' ? null : 'materials'); setInspectorOpen(false); setPanel(false); setMenuOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Quick Material and Color Controls"><Palette size={14}/><span>MATERIAL</span></button>
        <button type="button" className={inspectorOpen ? 'active' : ''} onClick={() => { setInspectorOpen(v => !v); setQuickPanel(null); setPanel(false); setMenuOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Unified Transform Inspector"><SlidersHorizontal size={14}/><span>PROPS</span></button>
      </div>}
      {inspectorOpen && !animationMode && !cameraView && <aside className="quick-access-panel inspector-panel left-panel-props"><div className="quick-panel-heading"><strong>TRANSFORM INSPECTOR</strong><button type="button" onClick={() => setInspectorOpen(false)} aria-label="Close inspector"><X size={14}/></button></div><div className="quick-panel-content"><div className="quick-panel-note">Signed numeric inputs · edit applies immediately{autoKey ? ' · Auto-key enabled' : ''}</div>{!selected && <div className="quick-panel-note">Select an object in the scene tree to edit Position, Rotation, and Scale.</div>}{(['position','rotation','scale'] as const).map(group => <section className="transform-group" key={group}><strong>{group.toUpperCase()}</strong>{(['x','y','z'] as const).map(axis => { const object = items.find(item => item.id === selected)?.object; const value = object ? group === 'position' ? object.position[axis] : group === 'rotation' ? THREE.MathUtils.radToDeg(object.rotation[axis]) : object.scale[axis] : 0; return <label key={axis}><span>{axis.toUpperCase()}</span><BufferedNumberInput ariaLabel={group+' '+axis.toUpperCase()} step={0.1} value={Number(value.toFixed(3))} disabled={!object} onCommit={n => { if (!object || !Number.isFinite(n)) return; const target = object; try { if (group === 'position') target.position[axis] = n; else if (group === 'rotation') target.rotation[axis] = THREE.MathUtils.degToRad(n); else target.scale[axis] = n; target.updateMatrixWorld(true); setItems(prev => [...prev]); if (autoKeyRef.current) captureRef.current(); } catch (error) { console.warn('Transform numeric update skipped safely', error); } }}/></label>; })}</section>)}</div></aside>}
      {quickPanel && !animationMode && !cameraView && <aside className={'quick-access-panel ' + (quickPanel === 'lights' ? 'left-panel-lights' : 'left-panel-materials')}>
        <div className="quick-panel-heading"><strong>{quickPanel === 'lights' ? 'LIGHT CONTROL' : quickPanel === 'materials' ? 'MATERIAL / COLOR' : 'TRANSFORM'}</strong><button type="button" onClick={() => setQuickPanel(null)} aria-label="Close quick panel"><X size={14}/></button></div>
        <div className="quick-panel-content">
          {quickPanel === 'lights' && <><div className="quick-panel-note">Five light types · live visibility · per-light freeze</div><div className="light-panel-stack">{lightPanel('Directional', 'Directional Light', <Sun size={13}/>)}{lightPanel('Point', 'Point Light', <Circle size={13}/>)}{lightPanel('Spot', 'Spot Light', <Focus size={13}/>)}{lightPanel('Ambient', 'Ambient Light', <Waves size={13}/>)}{lightPanel('Hemisphere', 'Hemisphere Light', <Globe size={13}/>)}</div><div className="preset-row">{['Morning','Noon','Afternoon','Night'].map(p => <button key={p} onClick={() => runtime.current?.applyPreset(p)}>{p}</button>)}</div></>}
          {quickPanel === 'materials' && <><div className="quick-panel-note">Changes apply to the selected mesh only.</div>{settingColor('Base Color', 'textureColor')}<div className="color-swatches">{['#b6d8ff','#f5f7fa','#ffb86b','#8deaff','#e5a9ff','#101820'].map(color => <button key={color} style={{background:color}} aria-label={'Set color '+color} onClick={() => setEditorSetting('textureColor', color)} />)}</div>{settingSlider('Roughness','roughness',0,1)}{settingSlider('Metalness','metalness',0,1)}{settingSlider('Opacity','opacity',0,1)}{settingSlider('Transmission','transmission',0,1)}{settingSlider('Clearcoat','clearcoat',0,1)}{settingSlider('Sheen','sheen',0,1)}{settingSlider('Emissive / Glow','emissive',0,10,0.1)}<label className="upload-control"><Upload size={12}/><span>Upload Texture Image</span><input type="file" accept="image/*" onChange={e => handleTextureUpload(e)} /></label><div className="texture-box">{texturePreview || 'Texture preview'}</div></>}
          {quickPanel === 'transform' && <><div className="quick-panel-note">Select an object in the scene tree, then choose a transform mode.</div><div className="quick-transform-row"><button type="button" className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')}><Move size={14}/>Move</button><button type="button" className={mode === 'rotate' ? 'active' : ''} onClick={() => setMode('rotate')}><Rotate3D size={14}/>Rotate</button><button type="button" className={mode === 'scale' ? 'active' : ''} onClick={() => setMode('scale')}><Scaling size={14}/>Scale</button></div><div className="quick-panel-note">The viewport gizmo follows the current selection.</div></>}
        </div>
      </aside>}
      <header className={'topbar ' + (cameraView ? 'view-disabled' : '')}>
        <div className="brand">
          <div className="brand-mark"><Cuboid size={17} /></div>
          <div><strong>Nexus<span>3D</span></strong></div>
        </div>
        <div className="top-actions">
          <button className={'icon-btn ' + (panel ? 'active' : '')} id="btn-hierarchy" onClick={() => { const opening = !panel; setPanel(opening); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title={panel ? 'Hide Scene Tree' : 'Show Scene Tree'} disabled={cameraView}><Layers size={14} /></button>
          <button className="icon-btn" onClick={() => { setMenuOpen(v => !v); setPanel(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Menu"><Settings2 size={14} /></button>
          <div className="tool-divider" />
          <button className="icon-btn" onClick={undo} disabled={!actionUndoStack.length && !undoStack.length} title="Undo scene or timeline action"><Undo2 size={15} /></button>
          <button className="icon-btn" onClick={redo} disabled={!actionRedoStack.length && !redoStack.length} title="Redo scene or timeline action"><Redo2 size={15} /></button>
          <button className={'icon-btn ' + (shapeLibraryOpen ? 'active' : '')} onClick={() => { setShapeLibraryOpen(v => !v); setMenuOpen(false); setPanel(false); setQuickPanel(null); setInspectorOpen(false); setMeshToolsOpen(false); }} title="Open Shape Library" aria-label="Open Shape Library"><Box size={14} /></button>
          <button className={'icon-btn ' + (meshToolsOpen ? 'active' : '')} onClick={() => { const candidate = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected); if (!(candidate instanceof THREE.Mesh)) { setStatus('Select a mesh to enable Mesh Editing'); return; } const opening = !meshToolsOpen; setMeshToolsOpen(opening); setShapeLibraryOpen(false); setPanel(false); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); if (opening) { setEditMode('Object'); editModeRef.current = 'Object'; setActiveEditTool(''); runtime.current?.clearSubSelection?.(); const tr = runtime.current?.transform; if (tr) { tr.detach(); tr.enabled = false; tr.getHelper().visible = false; } } else { const tr = runtime.current?.transform; if (tr) { tr.detach(); tr.attach(candidate); tr.setMode(mode); tr.setSpace(space); tr.enabled = true; tr.getHelper().visible = true; } } }} disabled={!selected || !(runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected) instanceof THREE.Mesh)} title="Toggle Mesh Editing" aria-label="Toggle Mesh Editing"><Scissors size={15}/></button>
          <span className="toolbar-center-spacer" aria-hidden="true" />
          <button className="icon-btn render-toolbar-btn" onClick={exportRenderImage} title="Render Image (PNG)" aria-label="Render Image" disabled={cameraView}><Aperture size={15} /></button>
          <button className={'icon-btn render-toolbar-btn ' + (renderVideoOpen ? 'active' : '')} onClick={() => { setRenderVideoOpen(v => !v); setRenderVideoCategory('Resolution'); setSkyboxOpen(false); setMeshToolsOpen(false); setPanel(false); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); }} title="Render Video Settings" aria-label="Render Video" disabled={cameraView}><Film size={15} /></button>
          <button className={'icon-btn render-toolbar-btn ' + (skyboxOpen ? 'active' : '')} id="btn-skybox" onClick={() => { setSkyboxOpen(v => !v); setSkyboxCategory('Time-of-Day Presets'); setRenderVideoOpen(false); setMeshToolsOpen(false); setPanel(false); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); }} title="Skybox & Environment" aria-label="Skybox"><Globe size={15} /></button>
          <button className={'icon-btn ' + (space === 'world' ? 'active' : '')} onClick={setAxisSpace} title="Toggle World / Local gizmo axes" disabled={cameraView}>{space === 'world' ? <Globe size={15} /> : <Focus size={15} />}<span className="tiny-label">{space.toUpperCase()}</span></button>
          <button className={'icon-btn ' + (mode === 'translate' ? 'active' : '')} onClick={() => runMode('translate')} title="Move selected object or mesh component" disabled={cameraView}><Move size={16} /></button>
          <button className={'icon-btn ' + (mode === 'rotate' ? 'active' : '')} onClick={() => runMode('rotate')} title="Rotate selected object or mesh component" disabled={cameraView}><Rotate3D size={16} /></button>
          <button className={'icon-btn ' + (mode === 'scale' ? 'active' : '')} onClick={() => runMode('scale')} title="Scale selected object or mesh component" disabled={cameraView}><Scaling size={16} /></button>
          <button className={'icon-btn ' + (snapOn ? 'active snap-active' : '')} onClick={toggleSnap} title="Toggle grid and angle snapping" disabled={cameraView}><Magnet size={16} /></button>
        </div>
        <div className="right-actions">
          <span className="live-dot" /><span className="ready-label">LOCAL SCENE</span>
          <button className="icon-btn fullscreen-btn" onClick={enterFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}><Maximize size={16} /></button>
        </div>
      </header>

      {skyboxOpen && !cameraView && !animationMode && <aside className="skybox-panel" aria-label="Skybox Environment Settings"><div className="skybox-heading"><strong><Globe size={13}/> SKYBOX / ENVIRONMENT</strong><button type="button" aria-label="Close Skybox panel" onClick={() => setSkyboxOpen(false)}><X size={13}/></button></div><nav className="skybox-categories" aria-label="Skybox categories">{[{name:'Time-of-Day Presets',icon:<Sun size={12}/>},{name:'Skybox Type',icon:<Globe size={12}/>},{name:'Atmosphere & Sun',icon:<Aperture size={12}/>},{name:'Clouds & Fog',icon:<CloudFog size={12}/>}].map(category => <button key={category.name} type="button" className={skyboxCategory === category.name ? 'active' : ''} onClick={() => setSkyboxCategory(skyboxCategory === category.name ? '' : category.name)}>{category.icon}<span>{category.name}</span></button>)}</nav>{skyboxCategory && <div className="skybox-body"><strong className="skybox-subtitle">{skyboxCategory}</strong>{skyboxCategory === 'Time-of-Day Presets' && <><div className="skybox-preset-grid">{['Morning','Noon','Afternoon','Night'].map(preset => <button type="button" key={preset} onClick={() => { runtime.current?.applyPreset(preset); setStatus(preset + ' environment preset applied to scene lighting and sky'); }}>{preset}</button>)}</div><p>Presets update sky color and available ambient/directional lights. Add lights from the LIGHTS dock for full lighting changes.</p></>}{skyboxCategory === 'Skybox Type' && <><label>Background Type<select value={skyboxType} onChange={e => { const type = e.target.value as typeof skyboxType; setSkyboxType(type); const scene = runtime.current?.scene; if (scene && type === 'Solid Color') scene.background = new THREE.Color(skyColorBottom); if (scene && type === 'Procedural Gradient') scene.background = new THREE.Color(skyColorTop); setStatus(type + ' selected'); }}><option>Procedural Gradient</option><option>Solid Color</option><option>HDRI Equirectangular</option></select></label><label>Sky Color<input type="color" value={skyColorTop} onChange={e => { setSkyColorTop(e.target.value); if (skyboxType !== 'HDRI Equirectangular' && runtime.current?.scene) runtime.current.scene.background = new THREE.Color(e.target.value); }}/></label><label>Horizon / Solid Color<input type="color" value={skyColorBottom} onChange={e => { setSkyColorBottom(e.target.value); if (skyboxType === 'Solid Color' && runtime.current?.scene) runtime.current.scene.background = new THREE.Color(e.target.value); }}/></label>{skyboxType === 'HDRI Equirectangular' && <label className="upload-control"><Upload size={12}/><span>Load HDR / RGBE Environment</span><input type="file" accept=".hdr,.rgbe" onChange={e => handleTextureUpload(e,true)}/></label>}<p>HDRI loads an equirectangular environment map; the color modes set the scene background.</p></>}{skyboxCategory === 'Atmosphere & Sun' && <><label>Sun Azimuth <output>{sunAzimuth}°</output><input type="range" min="0" max="360" value={sunAzimuth} onChange={e => { const value = Number(e.target.value); setSunAzimuth(value); runtime.current?.lightSources?.filter((light: any) => light.type === 'DirectionalLight' || light.type === 'SpotLight').forEach((light: any) => { light.object.position.x = Math.cos(THREE.MathUtils.degToRad(value)) * 10; light.object.position.z = Math.sin(THREE.MathUtils.degToRad(value)) * 10; }); }}/></label><label>Sun Elevation <output>{sunElevation}°</output><input type="range" min="-5" max="90" value={sunElevation} onChange={e => { const value = Number(e.target.value); setSunElevation(value); runtime.current?.lightSources?.filter((light: any) => light.type === 'DirectionalLight' || light.type === 'SpotLight').forEach((light: any) => { light.object.position.y = Math.sin(THREE.MathUtils.degToRad(value)) * 10; }); }}/></label><label>Light Intensity <output>{sunIntensity.toFixed(1)}</output><input type="range" min="0" max="8" step="0.1" value={sunIntensity} onChange={e => { const value = Number(e.target.value); setSunIntensity(value); runtime.current?.lightSources?.filter((light: any) => light.type === 'DirectionalLight' || light.type === 'SpotLight').forEach((light: any) => { light.object.intensity = value; }); }}/></label><label>Sky Tint<input type="color" value={skyColorTop} onChange={e => { setSkyColorTop(e.target.value); if (runtime.current?.scene && skyboxType !== 'HDRI Equirectangular') runtime.current.scene.background = new THREE.Color(e.target.value); }}/></label><p>Sun controls adjust existing directional and spot lights; create a light in LIGHTS to add a sun source.</p></>}{skyboxCategory === 'Clouds & Fog' && <><label>Cloud Density <output>{cloudDensity.toFixed(2)}</output><input type="range" min="0" max="1" step="0.01" value={cloudDensity} onChange={e => setCloudDensity(Number(e.target.value))}/></label><label>Fog Density <output>{Number(settings.fogDensity).toFixed(2)}</output><input type="range" min="0" max="1" step="0.01" value={Number(settings.fogDensity)} onChange={e => setEditorSetting('fogDensity', Number(e.target.value))}/></label><label>Fog Color<input type="color" value={String(settings.fogColor)} onChange={e => setEditorSetting('fogColor', e.target.value)}/></label><p>Fog density and tint affect the scene; cloud density is a stored environment preference and does not generate volumetric cloud geometry.</p></>}</div>}</aside>}
      {renderVideoOpen && !cameraView && !animationMode && <aside className="render-video-panel" aria-label="Render Video Settings"><div className="render-video-heading"><strong><Film size={13}/> RENDER VIDEO</strong><button type="button" aria-label="Close Render Video panel" onClick={() => setRenderVideoOpen(false)}><X size={13}/></button></div><nav className="render-video-categories" aria-label="Render categories">{[{name:'Resolution',icon:<Aperture size={12}/>},{name:'Time Range',icon:<Film size={12}/>},{name:'Environment',icon:<Globe size={12}/>},{name:'Effects',icon:<Sparkles size={12}/>},{name:'Watermark',icon:<Layers size={12}/>},{name:'Export',icon:<Download size={12}/>}].map(category => <button key={category.name} type="button" className={renderVideoCategory === category.name ? 'active' : ''} onClick={() => setRenderVideoCategory(renderVideoCategory === category.name ? '' : category.name)}>{category.icon}<span>{category.name}</span></button>)}</nav>{renderVideoCategory && <div className="render-video-category-body" key={renderVideoCategory}><strong className="render-video-subtitle">{renderVideoCategory}</strong>{renderVideoCategory === 'Resolution' && <><label>Aspect Ratio<select value={renderAspect} onChange={e => setRenderAspect(e.target.value)}><option>16:9</option><option>21:9</option><option>4:3</option><option>1:1</option></select></label><label>Format<select value={renderFormat} onChange={e => setRenderFormat(e.target.value)}><option>WebM</option><option>MP4</option></select></label><label>FPS<select value={renderFps} onChange={e => setRenderFps(Number(e.target.value))}><option value={24}>24 FPS</option><option value={25}>25 FPS</option><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></label><p>Recording captures the live viewport canvas at the selected frame rate. Aspect ratio is an export preset, not a viewport crop.</p></>}{renderVideoCategory === 'Time Range' && <><label>Range<select value={renderRange} onChange={e => setRenderRange(e.target.value)}><option>Full Animation</option><option>Work Area IN/OUT</option></select></label><label className="render-video-check"><input type="checkbox" checked={renderLoop} onChange={e => setRenderLoop(e.target.checked)}/>Loop playback preference</label><p>{renderRange === 'Work Area IN/OUT' ? 'Work area markers are configured in the timeline; recording captures until you stop it.' : 'Recording duration is controlled manually with Start / Stop Render.'}</p></>}{renderVideoCategory === 'Environment' && <><label className="render-video-check"><input type="checkbox" checked={renderAlpha} onChange={e => setRenderAlpha(e.target.checked)}/>Alpha transparency preference</label><label className="render-video-check"><input type="checkbox" checked={renderGrid} onChange={e => setRenderGrid(e.target.checked)}/>Show grid preference</label><label className="render-video-check"><input type="checkbox" checked={renderSkybox} onChange={e => setRenderSkybox(e.target.checked)}/>Show skybox preference</label><label>Background color<input type="color" value={renderBackground} onChange={e => setRenderBackground(e.target.value)}/></label><p>These environment options are saved as render preferences; they do not override the live editor viewport yet.</p></>}{renderVideoCategory === 'Effects' && <><label className="render-video-check"><input type="checkbox" checked={Boolean(settings.dofBlur)} onChange={e => setEditorSetting('dofBlur', e.target.checked ? 2 : 0)}/>Depth of Field preference</label><label className="render-video-check"><input type="checkbox" checked={Number(settings.bloomStrength) > 0} onChange={e => setEditorSetting('bloomStrength', e.target.checked ? 0.8 : 0)}/>Bloom / Glow preference</label><label className="render-video-check"><input type="checkbox" checked={Number(settings.ssao) > 0} onChange={e => setEditorSetting('ssao', e.target.checked ? 0.5 : 0)}/>Ambient Occlusion preference</label><label>Color Grading<select defaultValue="Neutral"><option>Neutral</option><option>Cinematic</option><option>Warm</option><option>Cool</option></select></label><p>Effect toggles update editor settings where supported; browser recording captures the current viewport output.</p></>}{renderVideoCategory === 'Watermark' && <><label>Watermark text<input type="text" maxLength={80} value={renderWatermark} onChange={e => setRenderWatermark(e.target.value)} placeholder="Optional watermark text"/></label><label>Position<select defaultValue="Bottom Right"><option>Bottom Right</option><option>Bottom Left</option><option>Top Right</option><option>Top Left</option><option>Center</option></select></label><p>Watermark settings are stored for the render workflow; watermark compositing is not applied to the recording yet.</p></>}{renderVideoCategory === 'Export' && <><div className="render-preview"><span>LIVE VIEWPORT PREVIEW</span><strong>{renderAspect} · {renderFps} FPS · {renderFormat}</strong></div><div className="render-progress-track"><span style={{width: renderProgress + '%'}}/></div><div className="render-progress-label">{renderRecording ? 'Recording…' : renderProgress === 100 ? 'Export complete' : 'Ready'} <span>{renderProgress}%</span></div><button className="render-start-button" type="button" onClick={toggleRenderRecording}><Film size={13}/>{renderRecording ? 'Stop Render & Download' : 'Start Render'}</button><p>MP4 is used only if the browser supports it; otherwise choose WebM for compatible recording.</p></>}</div>}</aside>}
      {meshToolsOpen && selected && !cameraView && runtime.current?.selectable.some((o: THREE.Object3D) => String(o.userData.editorId) === selected && o instanceof THREE.Mesh) && <section className={'mesh-edit-panel ' + (editMode === 'Face' ? 'face-edit-active' : '')} aria-label="Unified Sub-Object Mesh Editor" role="dialog"><div className="shape-edit-modes">{(['Object', 'Vertex', 'Edge', 'Face'] as const).map(level => <button key={level} className={editMode === level ? 'active' : ''} onClick={() => { editModeRef.current = level; setEditMode(level); const tr = runtime.current?.transform; const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selectedRef.current); if (tr) { if (level === 'Object') { tr.detach(); if (target) tr.attach(target); tr.setMode(mode); tr.setSpace(space); tr.enabled = Boolean(target); tr.getHelper().visible = Boolean(target); } else { tr.detach(); tr.enabled = false; tr.getHelper().visible = false; } } if (level === 'Object') { runtime.current?.clearSubSelection?.(); const group = runtime.current?.subObjectHighlight as THREE.Group | undefined; if (group) { while (group.children.length) { const child = group.children[0]; group.remove(child); child.traverse((node: any) => { node.geometry?.dispose?.(); if (node.material?.dispose) node.material.dispose(); }); } } } else if (target instanceof THREE.Mesh) { runtime.current?.refreshTopologyOverlay?.(target); } setStatus(level === 'Object' ? 'Object transform enabled' : level + ' mode · committed mesh cuts remain visible'); }} title={level + ' selection mode'}>{level === 'Vertex' ? <GitBranch size={13}/> : level === 'Edge' ? <Scissors size={13}/> : level === 'Face' ? <Layers size={13}/> : <Move size={13}/>}<span>{level}</span></button>)}</div>{editMode === 'Face' && <div className="shape-edit-actions" aria-label="Face editing actions">{(['Extrude', 'Subdivide', 'Smooth', 'Loop Cut'] as const).map(tool => <button key={tool} className={activeEditTool === (tool === 'Loop Cut' ? 'Cutting' : tool) ? 'active' : ''} onClick={() => { if (tool === 'Loop Cut') { const target = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected); const active = runtime.current?.getActiveSubSelection?.(); if (!(target instanceof THREE.Mesh) || !active || active.mesh !== target) { setStatus('Select a face before Loop Cut'); return; } setActiveEditTool('Cutting'); setEditAmount(50); loopCutContext.current = { meshId: String(target.userData.editorId), indices: [...active.indices] }; editBaseGeometry.current?.dispose(); editBaseGeometry.current = target.geometry.clone(); setStatus('Loop Cut active · drag across the selected face; pink preview follows your finger'); return; } const target = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected); if (!(target instanceof THREE.Mesh)) { setStatus('Select a mesh to edit geometry'); return; } if (tool === 'Extrude' && !runtime.current?.getActiveSubSelection?.()) { setStatus(tool + ' requires a highlighted mesh component'); return; } setActiveEditTool(tool); const meshId = String(target.userData.editorId); const cutAmount = tool === 'Subdivide' ? 50 : 35; if (tool === 'Subdivide') subdivideCutCount.current[meshId] = (subdivideCutCount.current[meshId] || 0) + 1; setEditAmount(cutAmount); editBaseGeometry.current?.dispose(); editBaseGeometry.current = target.geometry.clone(); if (tool === 'Extrude') { const active = runtime.current?.getActiveSubSelection?.(); extrudeContext.current = active ? { meshId: meshId, indices: [...active.indices] } : null; } applyGeometryTool(tool, cutAmount); if (tool !== 'Extrude') { editBaseGeometry.current?.dispose(); editBaseGeometry.current = target.geometry.clone(); } }} title={tool + ' selected geometry'}>{tool === 'Extrude' ? <Move size={13}/> : tool === 'Subdivide' ? <GitBranch size={13}/> : tool === 'Smooth' ? <Sparkles size={13}/> : <Scissors size={13}/>}<span>{tool}</span></button>)}</div>}{activeEditTool === 'Extrude' && <div className="shape-edit-slider"><label>Extrude depth <strong>{(editAmount / 100).toFixed(2)}</strong></label><input aria-label="Extrude depth" type="range" min="10" max="100" step="1" value={editAmount} onChange={e => { const amount = Number(e.target.value); setEditAmount(amount); applyGeometryTool('Extrude', amount); }}/><button onClick={() => { setActiveEditTool(''); extrudeContext.current = null; editBaseGeometry.current?.dispose(); editBaseGeometry.current = null; }} aria-label="Close extrude adjustment"><X size={12}/></button></div>}{activeEditTool === 'Cutting' && <div className="shape-edit-slider"><label>Loop Position <strong>{editAmount}%</strong></label><input aria-label="Loop cut position" type="range" min="1" max="99" step="1" value={editAmount} onChange={e => { const amount = Number(e.target.value); setEditAmount(amount); const context = loopCutContext.current; const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === context?.meshId); if (target instanceof THREE.Mesh && context) applyGeometryTool('LoopCut', amount, { mesh: target, indices: context.indices }); }}/><button onClick={() => { setActiveEditTool(''); loopCutContext.current = null; extrudeContext.current = null; editBaseGeometry.current?.dispose(); editBaseGeometry.current = null; }} aria-label="Close loop cutting"><X size={12}/></button></div>}</section>}

      {shapeLibraryOpen && !cameraView && <section className="shape-library-popover" role="dialog" aria-label="Shape Library"><div className="shape-library-heading"><strong><Cuboid size={14} /> Shape Library</strong><button onClick={() => setShapeLibraryOpen(false)} aria-label="Close Shape Library"><X size={13} /></button></div><div className="shape-library-grid">{[{name:'Cube',icon:<Box size={18}/>},{name:'Sphere',icon:<Circle size={18}/>},{name:'Cylinder',icon:<Cylinder size={18}/>},{name:'Cone',icon:<Cone size={18}/>},{name:'Torus',icon:<Circle size={18}/>},{name:'Directional Light',icon:<Sun size={18}/>},{name:'Spotlight',icon:<Flashlight size={18}/>},{name:'Flashlight',icon:<Lightbulb size={18}/>}].map(shape => <button key={shape.name} onClick={() => { if (shape.name.endsWith('Light') || shape.name === 'Spotlight' || shape.name === 'Flashlight') runtime.current?.addSceneLight(shape.name === 'Directional Light' ? 'Directional' : shape.name === 'Spotlight' ? 'Spot' : 'Flashlight'); else add(shape.name); setShapeLibraryOpen(false); }}><span>{shape.icon}</span><small>{shape.name}</small></button>)}</div><p>Choose an item to add it to the current scene.</p></section>}

      {animOpen && !cameraView && <section className="interpolation-float" aria-label="Interpolation editor"><div className="interpolation-float-head"><strong>INTERPOLATION</strong><span>{interpolation}</span></div><svg viewBox="0 0 180 76" role="img" aria-label="Bezier interpolation curve"><path d="M8 66 L172 8" stroke="#26394f" strokeDasharray="3 3" fill="none"/><path d={`M8 66 C ${8 + curveTangent * 0.55} ${66 - curveWeight * 0.5}, ${172 - curveTangent * 0.55} ${8 + curveTension * 0.5}, 172 8`} stroke="#59ddff" strokeWidth="2.5" fill="none"/><circle cx={8 + curveTangent * 0.55} cy={66 - curveWeight * 0.5} r="4" fill="#ff73c8"/><circle cx={172 - curveTangent * 0.55} cy={8 + curveTension * 0.5} r="4" fill="#59ddff"/></svg><label>CURVE WEIGHT <span>{(curveWeight / 50).toFixed(2)}</span><input type="range" min="0" max="100" value={curveWeight} onChange={e => setCurveWeight(Number(e.target.value))}/></label><label>TENSION <span>{(curveTension / 40).toFixed(2)}</span><input type="range" min="0" max="100" value={curveTension} onChange={e => setCurveTension(Number(e.target.value))}/></label><label>BIAS <span>{((curveTangent - 50) / 40).toFixed(2)}</span><input type="range" min="0" max="100" value={curveTangent} onChange={e => setCurveTangent(Number(e.target.value))}/></label></section>}

      {!panel && !cameraView && <button className={'floating-menu-toggle ' + (menuOpen ? 'active' : '')} id="btn-menu-panel" onClick={() => { const opening = !menuOpen; setMenuOpen(opening); if (opening) { setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); } }} title={menuOpen ? 'Close Menu Panel' : 'Open Menu Panel'}><span className="menu-glyph">☰</span><span>MENU</span></button>}

      {menuOpen && !panel && !cameraView && <aside className="menu-panel">
        <div className="panel-heading"><div><Settings2 size={13} /><span>Menu</span></div><button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={13} /></button></div>
        {menuCategories.map(category => <section className="menu-category" key={category.title}>
          <button className={'menu-category-button ' + (menuAccordion === category.title ? 'expanded' : '')} onClick={() => setMenuAccordion(menuAccordion === category.title ? '' : category.title)}>
            {category.icon}<span>{category.title}</span>{menuAccordion === category.title ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {menuAccordion === category.title && <div className="menu-category-content">
            {category.title === 'Project & File' && <>
              <button className="menu-option" onClick={createNewProject}><FileJson size={13} /><span>New Project</span></button>
              <button className="menu-option" onClick={() => setSaveAccordionOpen(v => !v)}><Save size={13} /><span>Save Project</span>{saveAccordionOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</button>
              {saveAccordionOpen && <div className="project-save-inline"><label htmlFor="nexus-project-name">Project Name</label><input id="nexus-project-name" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Project.nexus" /><button className="menu-option save-inline-action" onClick={saveProject}><Save size={12}/><span>[ SAVE ]</span></button></div>}
              <button className="menu-option" onClick={loadProject}><FolderOpen size={13} /><span>Load Project File</span></button>
              <button className="menu-option" onClick={() => modelFileRef.current?.click()}><Upload size={13} /><span>Import 3D Model</span></button>
              <button className="menu-option" onClick={exportProject}><Download size={13} /><span>Export Scene JSON</span></button>
              <input ref={projectFileRef} type="file" accept=".nexus,.json,application/json" hidden onChange={e => { handleProjectFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              <input ref={modelFileRef} type="file" accept=".gltf,.glb,.obj,.fbx,model/gltf+json,model/gltf-binary,text/plain" hidden onChange={e => { void importModel(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </>}
            {category.title === 'Editor Settings & Preferences' && <>
              <button className="menu-option" onClick={setAxisSpace}><Globe size={13} /><span>Toggle World / Local</span></button>
              <button className="menu-option" onClick={toggleSnap}><Magnet size={13} /><span>{snapOn ? 'Disable Snapping' : 'Enable Snapping'}</span></button>
              <button className="menu-option" onClick={enterFullscreen}><Maximize size={13} /><span>Toggle Fullscreen</span></button>
              <button className="menu-option" onClick={() => { setShowInstall(true); setMenuOpen(false); }}><Download size={13} /><span>Install Nexus3D</span></button>
            </>}
            {category.title === 'Help & System Info' && <>
              <div className="menu-info"><Keyboard size={13} /><span>Touch: tap to select; drag the gizmo to transform. Pinch or orbit to navigate the view.</span></div>
              <div className="menu-info"><Info size={13} /><span>Three.js / WebGL. Objects: {objectCount}. Keyframes: {totalKeys}. Renderer: {settings.pathTracer ? 'Path trace preview' : 'Real-time'}.</span></div>
              <button className="menu-option" onClick={() => setMenuOpen(false)}><Check size={13} /><span>Done</span></button>
            </>}
            {category.title === 'Texture Materials' && <>
              <div className="menu-subtitle">Texture Color</div>
              {settingColor('Base Color', 'textureColor')}
              <div className="color-swatches">{['#b6d8ff','#f5f7fa','#ffb86b','#8deaff','#e5a9ff','#101820'].map(color => <button key={color} style={{background:color}} aria-label={'Set color '+color} onClick={() => setEditorSetting('textureColor', color)} />)}</div>
              {settingSlider('Roughness','roughness',0,1)}{settingSlider('Metalness','metalness',0,1)}{settingSlider('Opacity','opacity',0,1)}{settingSlider('Transmission','transmission',0,1)}{settingSlider('Clearcoat','clearcoat',0,1)}{settingSlider('Sheen','sheen',0,1)}{settingSlider('Emissive / Neon','emissive',0,10,0.1)}{settingSlider('Normal / Bump Depth','normalDepth',0,5,0.1)}
              <div className="menu-subtitle">Texture Image</div>
              <label className="upload-control"><Upload size={12}/><span>Upload Texture Image</span><input type="file" accept="image/*" onChange={e => handleTextureUpload(e)} /></label>
              <div className="texture-box">{texturePreview || 'Texture preview box'}</div>
              <div className="menu-subtitle">Texture HDR</div>
              <label className="upload-control"><Upload size={12}/><span>Upload HDR Environment</span><input type="file" accept=".hdr,.rgbe" onChange={e => handleTextureUpload(e,true)} /></label>
              <div className="texture-box">{hdrPreview || 'HDR preview box'}</div>
            </>}
            {category.title === 'Mirror Effect' && <>
              {settingSlider('Reflectivity / Intensity','mirrorReflectivity',0,1)}{settingSlider('Roughness / Blur','mirrorRoughness',0,1)}{settingColor('Mirror Tint','mirrorTint')}
              <button className="menu-option" onClick={() => { setEditorSetting('mirrorReflectivity', 1); setEditorSetting('mirrorRoughness', 0.03); }}><Sparkles size={13}/><span>Apply Mirror Preset to Selected Object</span></button>
              <div className="menu-info">Live CubeCamera reflections are applied only to the selected mesh. Select a mesh before adjusting.</div>
            </>}
            {category.title === 'Post-Processing & Lens Effects' && <>
              {settingSlider('Bloom Strength','bloomStrength',0,5)}{settingSlider('Bloom Radius','bloomRadius',0,5)}{settingSlider('DoF Focus Distance','dofFocus',0,10)}{settingSlider('DoF Blur','dofBlur',0,10)}{settingSlider('Chromatic Aberration','chromatic',0,1)}{settingSlider('Vignette Intensity','vignette',0,1)}
              <div className="menu-info">Bloom adjusts render exposure; other lens controls are saved as preview settings.</div>
            </>}
            {category.title === 'Light Settings' && <>
              <div className="light-panel-stack">
                {lightPanel('Directional', 'Directional Light', <Sun size={13}/>)}
                {lightPanel('Point', 'Point Light', <Circle size={13}/>)}
                {lightPanel('Spot', 'Spot Light', <Focus size={13}/>)}
                {lightPanel('Ambient', 'Ambient Light', <Waves size={13}/>)}
                {lightPanel('Hemisphere', 'Hemisphere Light', <Globe size={13}/>)}
              </div>
              <div className="menu-subtitle">Environment Presets</div>
              <div className="preset-row">{['Morning','Noon','Afternoon','Night'].map(p => <button key={p} onClick={() => runtime.current?.applyPreset(p)}>{p}</button>)}</div>
            </>}
            {category.title === 'Atmosphere & Environment' && <>
              {settingSlider('Volumetric Fog Density','fogDensity',0,1,0.01)}{settingColor('Fog Color','fogColor')}{settingSlider('God Rays / Sun Shafts','godRays',0,5,0.1)}{settingSlider('SSAO Shadow Depth','ssao',0,2,0.1)}
              <div className="menu-info">Fog is applied to the scene; god rays and SSAO controls remain viewport render settings.</div>
            </>}
            {category.title === 'Special Effects & Particles' && <>
              <div className="menu-subtitle">Viewport Particle Systems</div>
              {(['Rain', 'Fire', 'Smoke', 'Thunder', 'Dust'] as const).map(type => <label className="setting-toggle" key={type}><input type="checkbox" checked={Boolean(particleToggles[type])} onChange={e => runtime.current?.toggleParticle(type, e.target.checked)} /><span>{type}</span></label>)}
              <div className="menu-info">Particles are rendered inside the 3D viewport only. Thunder toggles a subtle scene flash light.</div>
            </>}
            {category.title === 'Path Tracer / Render Settings' && <>
              <label className="setting-toggle"><input type="checkbox" checked={Boolean(settings.pathTracer)} onChange={e => setEditorSetting('pathTracer',e.target.checked)}/><span>Real-Time Path Tracer</span></label>
              <div className="menu-subtitle">Targeted Ray Controls</div>
              {settingSlider('Ray-Traced Reflection Intensity','rayReflectionIntensity',0,1,0.01)}
              {settingSlider('Transmission / Refraction IOR','refractionIndex',1,2.33,0.01)}
              {settingSlider('Soft Shadow Penumbra / Blur','rayPenumbra',0,10,0.1)}
              {settingSlider('Max Ray Bounces','rayBounces',1,8,1)}
              {settingSlider('Progressive Samples','raySamples',1,128,1)}
              {settingSlider('Preview Samples','samples',1,128,1)}{settingSlider('Preview Bounces','bounces',1,8,1)}
              <div className="menu-info">Ray controls target only highly reflective meshes (metalness above 0.8 and roughness below 0.2), transmissive / glass-like materials, and active directional or spot lights for soft-shadow radius. The renderer currently provides a real-time preview; these settings do not enable a physically complete path-tracing engine.</div>
            </>}
          </div>}
        </section>)}
      </aside>}

      {panel && !cameraView && <aside className="hierarchy-panel">
        <div className="panel-heading"><div><Layers size={13} /><span>Scenes Tree</span></div><span className="count">{items.length.toString().padStart(2, '0')}</span></div>
        <div className="tree-search"><Search size={12} /><input aria-label="Search scene tree" value={treeSearch} onChange={e => setTreeSearch(e.target.value)} placeholder="Search scene…" /></div>
        <div className={'tree-root ' + (dragTargetId === 'root' ? 'drop-target' : '')} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragTargetId('root'); }} onDragLeave={() => setDragTargetId('')} onDrop={e => { e.preventDefault(); setDragTargetId(''); const childId = e.dataTransfer.getData('text/nexus3d-object'); const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); if (child) runtime.current?.reparentObject(child); }} title="Drop an object here to move it to the Scene root"><span className="tree-caret">⌄</span><Grid2X2 size={12} /><span>Scene Root</span></div>
        <div className={'tree-list ' + (dragTargetId === 'empty' ? 'drop-target' : '')} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (e.target === e.currentTarget) setDragTargetId('empty'); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragTargetId(''); }} onDrop={e => { e.preventDefault(); setDragTargetId(''); const childId = e.dataTransfer.getData('text/nexus3d-object'); const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); if (child) runtime.current?.reparentObject(child); }}>
          {items.filter(item => {
            const query = treeSearch.trim().toLowerCase();
            if (query) return item.name.toLowerCase().includes(query) || item.kind.toLowerCase().includes(query);
            let parent = item.object.parent;
            while (parent) {
              const parentId = String(parent.userData.editorId || '');
              if (parentId && expanded[parentId] === false) return false;
              parent = parent.parent;
            }
            return true;
          }).map(item => {
            let depth = 0;
            let parent = item.object.parent;
            while (parent) { if (parent.userData.editorId) depth += 1; parent = parent.parent; }
            const hasChildren = items.some(other => other.object.parent === item.object);
            return <div key={item.id} data-tree-id={item.id} className={'tree-row ' + (selected === item.id ? 'selected' : '') + (dragTargetId === item.id ? ' drop-target' : '')}
              draggable={true}
              onDragStart={e => { e.dataTransfer.setData('text/nexus3d-object', item.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDragTargetId(item.id); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragTargetId(''); }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragTargetId(''); const childId = e.dataTransfer.getData('text/nexus3d-object'); const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); if (!child || child === item.object) return; const rect = e.currentTarget.getBoundingClientRect(); const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1); runtime.current?.reorderObject(child, item.object, ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside'); }}
              onTouchStart={e => { const touch = e.touches[0]; touchDragId.current = item.id; touchPoint.current = touch ? { x: touch.clientX, y: touch.clientY } : null; setDragTargetId(item.id); }}
              onTouchMove={e => { const touch = e.touches[0]; if (!touch || !touchDragId.current) return; e.preventDefault(); touchPoint.current = { x: touch.clientX, y: touch.clientY }; const hit = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-tree-id]') as HTMLElement | null; if (hit?.dataset.treeId) setDragTargetId(hit.dataset.treeId); }}
              onTouchEnd={e => { const touch = e.changedTouches[0]; const point = touchPoint.current || (touch ? { x: touch.clientX, y: touch.clientY } : null); const childId = touchDragId.current; touchDragId.current = ''; touchPoint.current = null; setDragTargetId(''); if (!point || !childId) return; const rootHit = document.elementFromPoint(point.x, point.y)?.closest('.tree-root'); const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-tree-id]') as HTMLElement | null; const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); const target = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === hit?.dataset.treeId); if (child && rootHit) runtime.current?.reparentObject(child); else if (child && target && child !== target) { const rect = hit!.getBoundingClientRect(); const ratio = (point.y - rect.top) / Math.max(rect.height, 1); runtime.current?.reorderObject(child, target, ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside'); } }}>
              <button className={'tree-item ' + (selected === item.id ? 'selected' : '')} style={{ paddingLeft: 5 + depth * 12 }} onClick={() => { if (!cameraView) runtime.current?.selectObject(item.object); }} disabled={cameraView}>
                {hasChildren ? <span className="tree-expand" onClick={e => { e.stopPropagation(); setExpanded(prev => ({ ...prev, [item.id]: prev[item.id] === false })); }}>{expanded[item.id] === false ? <ChevronRight size={11} /> : <ChevronDown size={11} />}</span> : <span className="tree-expand empty" />}
                {item.kind === 'Sphere' ? <Circle size={13} /> : item.kind === 'Cylinder' ? <Cylinder size={13} /> : item.kind === 'Cone' ? <Cone size={13} /> : item.kind === 'Torus' ? <Circle size={13} /> : item.kind === 'Camera' ? <Film size={13} /> : <Box size={13} />}
                <span className="tree-name">{item.name}</span>{selected === item.id && <span className="tree-selected-dot" />}
              </button>
              <button className="tree-eye" aria-label={(item.object.visible ? 'Hide ' : 'Show ') + item.name} title={item.object.visible ? 'Hide object' : 'Show object'} onClick={() => runtime.current?.toggleVisibility(item.object)}>{item.object.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
            </div>;
          })}
        </div>
        <div className="panel-footer"><span className="live-dot" /> {objectCount} objects in scene</div>
      </aside>}



      <div className="right-rail">
        <button className={'rail-btn ' + (cameraView ? 'active' : '')} onClick={toggleCamera} title={cameraView ? 'Return to User View' : 'Directly view through MainCamera'}><Camera size={17} /><span>{cameraView ? 'USER' : 'CAM'}</span></button>
        <button className={'rail-btn animation-rail-btn ' + (animationMode ? 'active' : '')} onClick={() => { if (animationMode) { setPlaybackControlsOpen(v => !v); } else { if (!cameraView) toggleCamera(); setPlaying(false); setAnimationMode(true); setAnimationObjectsOpen(true); setAnimOpen(false); setPlaybackControlsOpen(false); setTimelineOptionsOpen(false); } }} title={animationMode ? (playbackControlsOpen ? 'Hide playback controls' : 'Show playback controls') : 'Open Animation System Viewport'} aria-label="Toggle Animation Mode"><Film size={17} /><span>ANIM</span></button>
        <button className={'rail-btn rig-rail-btn ' + (rigPanelOpen ? 'active' : '')} onClick={() => { setRigPanelOpen(v => !v); setPanel(false); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Open Manual Rigging and Auto-IK" aria-label="Rigging controls"><GitBranch size={17}/><span>RIG</span></button>
      </div>

      {rigPanelOpen && !cameraView && !animationMode && <aside className="rigging-panel" aria-label="Rigging controls">
        <div className="quick-panel-heading"><strong>CHARACTER RIGGING</strong><button type="button" onClick={() => setRigPanelOpen(false)} aria-label="Close rigging panel"><X size={14}/></button></div>
        <section className="rigging-section">
          <button className="rigging-section-toggle" type="button" onClick={() => setManualRigOpen(v => !v)}><span>MANUAL BONES &amp; HIERARCHY</span>{manualRigOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
          {manualRigOpen && <div className="rigging-section-body"><p>Create an editable bone chain, then select bones in Scene Tree to pose them.</p><button type="button" className="rigging-action" onClick={() => runtime.current?.createManualRig()}>＋ Create Bone Chain</button><button type="button" className="rigging-action secondary" onClick={() => { const target = items.find(item => item.id === selected)?.object; if (target && target.userData.kind === 'Bone') { const child = new THREE.Bone(); child.name = 'Manual Bone'; child.position.set(0, 0.7, 0); child.userData.editorId = uid(); child.userData.kind = 'Bone'; target.add(child); runtime.current?.selectable.push(child); setItems(prev => [...prev, { id: child.userData.editorId, name: child.name, object: child, kind: 'Bone' }]); setStatus('Child bone added to selected bone'); } else setStatus('Select a bone in Scene Tree before adding a child bone'); }}>＋ Add Child Bone</button></div>}
        </section>
        <section className="rigging-section">
          <button className="rigging-section-toggle" type="button" onClick={() => setAutoIKOpen(v => !v)}><span>AUTO-IK SOLVER</span>{autoIKOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
          {autoIKOpen && <div className="rigging-section-body"><label className="rigging-check"><input type="checkbox" checked={ikEnabled} onChange={e => { setIkEnabled(e.target.checked); if (e.target.checked) runtime.current?.solveIK(ikChainLength); }}/><span>Enable Auto-IK solver</span></label><label className="rigging-field"><span>Chain length</span><select aria-label="IK chain length" value={ikChainLength} onChange={e => setIkChainLength(Number(e.target.value))}><option value={1}>1 joint</option><option value={2}>2 joints</option><option value={3}>3 joints</option><option value={4}>4 joints</option></select></label><button type="button" className="rigging-action secondary" onClick={() => runtime.current?.createIKTarget()}>＋ Create / Reset Target Handle</button><button type="button" className="rigging-action" disabled={!ikEnabled} onClick={() => runtime.current?.solveIK(ikChainLength)}>Solve IK</button><p>Move the target handle with the viewport gizmo, then solve the selected bone chain.</p></div>}
        </section>
      </aside>}

      {animationMode && animationObjectsOpen && <aside className="animation-objects-panel" aria-label="Animation Objects hierarchy">
        <div className="animation-objects-heading"><div><Layers size={13}/><strong>ANIMATION OBJECTS</strong></div><button type="button" aria-label="Close animation objects" onClick={() => setAnimationObjectsOpen(false)}><X size={13}/></button></div>
        <button type="button" className="animation-object-row animation-root-row" onClick={() => setSelected('')}><span className="animation-target-diamond">◆</span><span>Root</span></button>
        {items.map(item => <button type="button" key={item.id} className={'animation-object-row ' + (selected === item.id ? 'selected' : '')} onClick={() => { setSelected(item.id); runtime.current?.selectObject(item.object); }}><span className="animation-target-diamond">{selected === item.id ? '◆' : '◇'}</span><span className="animation-object-name">{item.kind === 'Light' ? 'Main Light' : item.kind === 'Camera' ? 'Main Camera' : item.name}</span><small>{item.kind.toUpperCase()}</small></button>)}
        {!items.length && <p className="animation-objects-empty">Create a scene object to add an animation target.</p>}
      </aside>}
      {animationMode && <section className="sequence-controller" aria-label="Alphabetical animation sequence">
        <div className="sequence-scroll" aria-label="Resizable state sequence">
          {sequenceStates.map((state, index) => <div className={'sequence-item ' + (selectedSequenceState === state.id ? 'selected' : '')} key={state.id}>
            <button type="button" className={'sequence-letter ' + (selectedSequenceState === state.id ? 'active' : '')} onClick={() => { const drag = sequenceDrag.current; if (drag?.moved) { sequenceDrag.current = null; return; } sequenceDrag.current = null; setSelectedSequenceState(prev => prev === state.id ? '' : state.id); }} onPointerDown={index > 0 ? event => { event.currentTarget.setPointerCapture(event.pointerId); sequenceDrag.current = { targetIndex: index - 1, startX: event.clientX, startWidth: sequenceStates[index - 1].width, moved: false }; } : undefined} onPointerMove={index > 0 ? event => { const drag = sequenceDrag.current; if (!drag || drag.targetIndex !== index - 1) return; const delta = event.clientX - drag.startX; if (Math.abs(delta) > 4) drag.moved = true; if (!drag.moved) return; const nextWidth = Math.max(80, drag.startWidth + delta); setSequenceStates(prev => prev.map((entry, entryIndex) => entryIndex === drag.targetIndex ? { ...entry, width: nextWidth } : entry)); } : undefined} onPointerUp={index > 0 ? () => { if (!sequenceDrag.current?.moved) sequenceDrag.current = null; } : undefined} onPointerCancel={index > 0 ? () => { sequenceDrag.current = null; } : undefined} aria-label={'Open timeline for state ' + state.label} title={index > 0 ? 'Tap to toggle timeline; drag this letter horizontally to resize the preceding timeline' : 'Tap to toggle timeline'}>{state.label}</button>
            {selectedSequenceState === state.id && <div className="sequence-timeline" style={{ width: state.width }} aria-label={'Timeline for state ' + state.label}>
              <div className="sequence-ruler">{Array.from({ length: Math.max(2, Math.floor(state.width / 72) + 1) }, (_, tick) => <span key={tick} className="sequence-major-tick" style={{ left: (tick / Math.max(1, Math.floor(state.width / 72))) * 100 + '%' }}>{tick * 10}f</span>)}</div>
              <div className="sequence-key-lane">{Array.from({ length: Math.max(2, Math.floor(state.width / 24)) }, (_, keyIndex) => <button key={keyIndex} type="button" className={'sequence-key-dot ' + (frame === keyIndex * 5 ? 'active' : '')} style={{ left: (keyIndex / Math.max(1, Math.floor(state.width / 24) - 1)) * 100 + '%' }} title={'Select frame ' + (keyIndex * 5)} aria-label={'Select frame ' + (keyIndex * 5)} onClick={() => setCurrentFrame(keyIndex * 5)} />)}<i className="sequence-playhead" style={{ left: Math.max(0, Math.min(100, (frame / Math.max(1, Math.floor(state.width / 24) - 1) / 5) * 100)) + '%' }} /></div><div className="sequence-duration-label">------ Timeline {state.label} ------</div>
            </div>}
          </div>)}
          <button type="button" className="sequence-add-state" onClick={() => { const next = { id: uid(), label: sequenceLabel(sequenceStates.length), width: 240 }; sequenceDrag.current = null; setSequenceStates(prev => [...prev, next]); setStatus('State ' + next.label + ' added to animation sequence'); }} title="Add the next alphabet state"><span>＋</span> State</button>
        </div>
      </section>}

      {animOpen && !animationMode && !cameraView && <section className="timeline-panel">
        <div className="timeline-heading"><div><Film size={13} /><strong>Animation Timeline</strong><span className="timeline-sub">{totalKeys} keys · {frameRate} FPS</span></div><div className="timeline-heading-actions"><button className={'timeline-close ' + (timelineOptionsOpen ? 'tool-active' : '')} onClick={() => setTimelineOptionsOpen(v => !v)} title="Timeline settings"><Settings2 size={14} /></button><button className="timeline-close" onClick={() => setAnimOpen(false)} title="Close timeline"><X size={14} /></button></div></div>
        {timelineOptionsOpen && <div className="timeline-options"><label>FPS<select value={frameRate} onChange={e => setFrameRate(Number(e.target.value))}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select></label><label>Time Scale<select value={timeUnit} onChange={e => setTimeUnit(e.target.value as 'seconds' | 'milliseconds')}><option value="seconds">Seconds</option><option value="milliseconds">Milliseconds</option></select></label><label>Duration · {timeUnit === 'seconds' ? 'seconds' : 'milliseconds'}<input aria-label="Timeline duration" type="range" min="1" max="60" value={timelineDuration} onChange={e => setTimelineDuration(Number(e.target.value))}/><strong>{String(timelineDuration).padStart(2,'0')} {timeUnit === 'seconds' ? 'seconds' : 'ms'}</strong></label><label className="timeline-check"><input type="checkbox" checked={autoKey} onChange={e => { setAutoKey(e.target.checked); autoKeyRef.current = e.target.checked; }} /> Auto-key</label><label className="timeline-check"><input type="checkbox" checked={snapOn} onChange={e => { setSnapOn(e.target.checked); const t = runtime.current?.transform; if (t) { t.setTranslationSnap(e.target.checked ? 0.25 : null); t.setRotationSnap(e.target.checked ? THREE.MathUtils.degToRad(15) : null); t.setScaleSnap(e.target.checked ? 0.1 : null); } }} /> Snap</label><label className="timeline-check"><input type="checkbox" checked={loopPlayback} onChange={e => setLoopPlayback(e.target.checked)} /> Loop</label><label>Interpolation<select value={interpolation} onChange={e => setInterpolation(e.target.value)}><option>Linear</option><option>Ease In</option><option>Ease Out</option><option>Ease In-Out</option><option>Bounce</option><option>Anticipation</option><option>Spring Damping</option></select></label><div className="curve-editor"><div className="curve-editor-title">EASING CURVE <span>{interpolation}</span></div><svg viewBox="0 0 180 62" role="img" aria-label="Live interpolation curve"><path d="M 4 56 L 176 4" stroke="#26394f" strokeWidth="1" fill="none" strokeDasharray="3 3"/><path d={`M 4 56 C ${4 + curveTangent * 0.55} ${56 - curveWeight * 0.5}, ${176 - curveTangent * 0.55} ${4 + curveTension * 0.5}, 176 4`} stroke="#59ddff" strokeWidth="2.5" fill="none"/></svg><label>Curve Weight <input type="range" min="0" max="100" value={curveWeight} onChange={e => setCurveWeight(Number(e.target.value))}/></label><label>Tension <input type="range" min="0" max="100" value={curveTension} onChange={e => setCurveTension(Number(e.target.value))}/></label><label>Tangents <input type="range" min="0" max="100" value={curveTangent} onChange={e => setCurveTangent(Number(e.target.value))}/></label></div></div>}
        <div className="timeline-toolbar" aria-label="Timeline tools">
          <button title="Rewind to Work Area start" onClick={() => setCurrentFrame(workStart)}><Rewind size={15} /></button>
          <button title="Previous keyframe" onClick={() => { const frames = Object.keys(keyframes[selected] || {}).map(Number).filter(n => n < frame).sort((a,b) => b-a); if (frames.length) setCurrentFrame(frames[0]); }} aria-label="Previous keyframe">‹|</button>
          <button title={playing ? 'Pause playback' : 'Play animation'} className={playing ? 'tool-active' : ''} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
          <button title="Next keyframe" onClick={() => { const frames = Object.keys(keyframes[selected] || {}).map(Number).filter(n => n > frame).sort((a,b) => a-b); if (frames.length) setCurrentFrame(frames[0]); }} aria-label="Next keyframe">|›</button>
          <button title="Stop and rewind" onClick={() => { setPlaying(false); setCurrentFrame(workStart); }}><Rewind size={15} /></button>
          <button title={loopPlayback ? 'AutoPlay loop enabled' : 'Enable AutoPlay loop'} className={loopPlayback ? 'tool-active' : ''} onClick={() => setLoopPlayback(v => !v)} aria-label="Toggle AutoPlay"><Rewind size={15} /></button>
          <div className="timeline-compact-controls" aria-label="Compact timeline framing controls"><label title="Timeline scale"><span>TIME</span><select aria-label="Timeline time scale" value={timeUnit} onChange={e => setTimeUnit(e.target.value as 'seconds' | 'milliseconds')}><option value="seconds">SEC</option><option value="milliseconds">MS</option></select></label><label title="Timeline duration"><span>LEN</span><select aria-label="Timeline duration" value={timelineDuration} onChange={e => setTimelineDuration(Number(e.target.value))}>{[1,5,10,15,30,45,60].map(n => <option key={n} value={n}>{String(n).padStart(2,'0')}</option>)}</select></label><label title="Interpolation effect"><span>EASE</span><select aria-label="Interpolation effect" value={interpolation} onChange={e => setInterpolation(e.target.value)}><option>Linear</option><option>Ease In</option><option>Ease Out</option><option>Ease In-Out</option><option>Bounce</option><option>Anticipation</option><option>Spring Damping</option></select></label><button title={timelineOptionsOpen ? 'Hide interpolation panel' : 'Open interpolation panel'} className={timelineOptionsOpen ? 'tool-active' : ''} onClick={() => setTimelineOptionsOpen(v => !v)} aria-label="Toggle interpolation panel"><Settings2 size={14}/></button></div>
          <button title={pathTool ? 'Stop Motion Path drawing' : 'Draw Motion Path'} className={pathTool ? 'tool-active' : ''} onClick={() => { setPathTool(v => !v); setStatus(pathTool ? 'Motion Path tool disabled' : 'Motion Path tool active · tap scene to add curve points'); }} aria-label="Motion Path Tool"><GitBranch size={15}/></button>
          <button title="Record keyframe" onClick={() => captureRef.current()}><Diamond size={15} /></button>
          <button title="Copy frame data" onClick={copyFrame}><ClipboardCopy size={15} /></button>
          <button title="Paste frame data" onClick={pasteFrame} disabled={!copiedFrame}><ClipboardPaste size={15} /></button>
          <button title={selectedKeyframe ? 'Delete selected keyframe' : 'Delete keyframe on current frame'} onClick={deleteFrame}><Trash2 size={15} /></button>
          <button title="Undo timeline edit" onClick={undo} disabled={!undoStack.length}><Undo2 size={15} /></button>
          <button title="Redo timeline edit" onClick={redo} disabled={!redoStack.length}><Redo2 size={15} /></button>
        </div>
        <div className="scene-duration-track" aria-label="Scene timeline duration"><span>SCENE 0.00s</span><div className="scene-duration-line"><i /></div><span>{Number(timelineDuration).toFixed(2)}s</span></div>
        <div className="work-area-controls"><label>IN <input aria-label="Work area start frame" type="range" min="0" max={Math.max(0,workEnd-1)} value={workStart} onChange={e => { const n=Number(e.target.value); setWorkStart(n); if(frame<n)setCurrentFrame(n); }}/><strong>{(workStart/500*timelineDuration).toFixed(2)}s</strong></label><label>OUT <input aria-label="Work area end frame" type="range" min={Math.min(500,workStart+1)} max="500" value={workEnd} onChange={e => { const n=Number(e.target.value); setWorkEnd(n); if(frame>n)setCurrentFrame(n); }}/><strong>{(workEnd/500*timelineDuration).toFixed(2)}s</strong></label></div>
        <div className="scrubber-row"><label htmlFor="frame-scrubber">TIME</label><input id="frame-scrubber" type="range" min={workStart} max={workEnd} step="1" value={Math.max(workStart,Math.min(workEnd,frame))} onChange={e => setCurrentFrame(Number(e.target.value))} /><strong>{timeUnit === 'seconds' ? ((frame / 500) * timelineDuration).toFixed(2) + ' s' : ((frame / 500) * timelineDuration).toFixed(1) + ' ms'}</strong></div>
        <div className="ruler" aria-label="Timeline ruler">{Array.from({ length: 11 }, (_, i) => <span key={i}>{timeUnit === 'seconds' ? ((workStart/500*timelineDuration + (i / 10) * ((workEnd-workStart)/500*timelineDuration))).toFixed(1) + 's' : ((workStart/500*timelineDuration + (i / 10) * ((workEnd-workStart)/500*timelineDuration))).toFixed(1) + 'ms'}</span>)}</div>
        {motionPathPoints.length > 0 && <div className="motion-path-status"><GitBranch size={12}/> Motion Path: {motionPathPoints.length} control points <button type="button" onClick={() => { setMotionPathPoints([]); setPathTool(false); }}>Clear Path</button><button type="button" onClick={() => { const obj=items.find(item=>item.id===selected)?.object; if(!obj || motionPathPoints.length<2){setStatus('Select an object and add at least two path points');return;} const curve=new THREE.CatmullRomCurve3(motionPathPoints.map(p=>new THREE.Vector3(p.x,p.y,p.z))); const points=curve.getPoints(80); const geometry=new THREE.BufferGeometry().setFromPoints(points); const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x58dcff})); line.name='Motion Path'; line.userData.editorId=uid(); line.userData.kind='MotionPath'; runtime.current?.scene.add(line); setStatus('Motion path curve created; path following requires keyframe binding'); }}>Create Curve</button></div>}
        <div className="track-area">
          <div className="track-labels">
            <div className="auto-key-row"><button className={'auto-key ' + (autoKey ? 'active' : '')} onClick={() => { setAutoKey(!autoKey); autoKeyRef.current = !autoKey; }}><span className="auto-dot" />AUTO-KEY</button><button className="key-now" onClick={() => captureRef.current()} title="Set keyframe on selected object"><Diamond size={12} /> KEY</button></div>
            {items.filter(item => item.kind !== 'Camera').map(item => <div className="track-label" key={item.id}><span className="track-object-dot" />{item.name}<small>POS / ROT / SCALE</small></div>)}
          </div>
          <div className="track-lanes">
            <div className="lane auto-lane"><span className="playhead" style={{ left: (frame / 5) + '%' }} /></div>
            {items.filter(item => item.kind !== 'Camera').map(item => {
              const track = keyframes[item.id] || {};
              return <div className="lane" key={item.id} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setCurrentFrame(Math.round(((e.clientX - rect.left) / rect.width) * 500)); }}>
                {Object.keys(track).map(k => <button key={k} className={'key-diamond ' + (selectedKeyframe?.id === item.id && selectedKeyframe.frame === Number(k) ? 'key-selected' : '') }title={'Select keyframe · ' + item.name + ' · Frame ' + k} aria-label={'Select keyframe for ' + item.name + ' at frame ' + k} style={{ left: (Number(k) / 5) + '%' }} onClick={e => { e.stopPropagation(); setSelectedKeyframe({ id: item.id, frame: Number(k) }); setCurrentFrame(Number(k)); }} />)}
                <span className="playhead" style={{ left: (frame / 5) + '%' }} />
              </div>;
            })}
          </div>
        </div>
      </section>}

      {!cameraView && !animationMode && <div className={'bottom-bar action-dock ' + (animOpen ? 'timeline-open' : '')} aria-label="Object actions"><button onClick={duplicate} disabled={!selected || items.some(item => item.id === selected && item.kind === 'Camera')} title="Duplicate selected object" aria-label="Duplicate selected object"><Copy size={17}/></button><button className="delete-btn" onClick={deleteSelected} disabled={!selected || items.some(item => item.id === selected && item.kind === 'Camera')} title="Delete selected object" aria-label="Delete selected object"><Trash2 size={17}/></button></div>}

      {animationMode && <><div className="animation-mode-controls" aria-label="Animation mode controls"><button title="Exit Animation Mode" aria-label="Exit Animation Mode" onClick={() => { setPlaying(false); setAnimationMode(false); setAnimOpen(false); setPlaybackControlsOpen(false); setTimelineOptionsOpen(false); if (cameraView) toggleCamera(); }}><X size={19}/></button><button className={playbackControlsOpen ? 'active' : ''} title={playbackControlsOpen ? 'Hide playback controls' : 'Show playback controls'} aria-label="Toggle playback controls" onClick={() => setPlaybackControlsOpen(v => !v)}><Film size={16}/><span>Anim</span></button></div>
        {playbackControlsOpen && <div className="sequence-playback-controls" aria-label="Playback controls"><button type="button" onClick={() => setCurrentFrame(Math.max(workStart, frame - 1))}>BACK</button><button type="button" className={playing ? 'active' : ''} onClick={() => setPlaying(v => !v)}>{playing ? 'PAUSE' : 'PLAY'}</button><button type="button" onClick={() => setCurrentFrame(Math.min(workEnd, frame + 1))}>FORWARD</button></div>}</>}

      {showInstall && !portrait && !window.matchMedia('(display-mode: standalone)').matches && <div className="install-backdrop"><section className="install-card" role="dialog" aria-modal="true" aria-labelledby="install-title"><div className="install-icon"><Download size={19} /></div><button className="install-close" aria-label="Later" onClick={() => { setShowInstall(false); sessionStorage.setItem('nexus3d-install-dismissed', '1'); }}><X size={14} /></button><small>NEXUS3D / APP INSTALLER</small><h2 id="install-title">Install Nexus3D App / APK for fullscreen desktop-like experience?</h2><p>Install the web app for a cleaner standalone workspace. Android APK is not generated by this web install prompt.</p><div className="install-actions"><button className="install-later" onClick={() => { setShowInstall(false); sessionStorage.setItem('nexus3d-install-dismissed', '1'); }}>Later</button><button className="install-now" onClick={async () => { if (installPrompt && typeof installPrompt.prompt === 'function') { await installPrompt.prompt(); const choice = await installPrompt.userChoice; setStatus(choice?.outcome === 'accepted' ? 'Install accepted' : 'Install dismissed'); setInstallPrompt(null); setShowInstall(false); } else { setStatus('Use your browser menu: Install app / Add to Home screen'); setShowInstall(false); } }}><Download size={13} /> Install</button></div></section></div>}
      {portrait && <div className="rotate-overlay"><div className="rotate-card"><div className="rotate-icon"><Rotate3D size={35} /></div><strong>Please rotate your device to Landscape Mode to use Nexus3D</strong><p>Nexus3D is optimized for a widescreen workspace.</p><div className="rotate-phone"><span /></div></div></div>}
    </main>
  );
}
