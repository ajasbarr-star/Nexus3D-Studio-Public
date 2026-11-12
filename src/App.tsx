import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import JSZip from 'jszip';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  Box, Camera, Circle, Copy, Cuboid, Cylinder, Cone, Focus, Globe, Grid2X2,
  Layers, Maximize, Move, Rotate3D, Scaling, Trash2, Magnet, Gauge,
  Play, Pause, Rewind, ClipboardCopy, ClipboardPaste, Diamond, Undo2, Redo2,
  Film, Lightbulb, X, Check, Eye, EyeOff, Search, ChevronDown, ChevronRight, Download,
  Save, FolderOpen, FileJson, Settings2, Info, Keyboard, Sun, Flashlight, Palette, Upload,
  Sparkles, Waves, Aperture, SlidersHorizontal, CloudFog, ScanEye, Lock, Unlock, Scissors, GitBranch,
  Plus, Target, Link2, Unlink, RefreshCw, GitMerge, Activity, Code2, Folder, FolderPlus, MoreHorizontal, Pencil,
} from 'lucide-react';
import './index.css';

type NexusProjectFilesPlugin = {
  saveProject(options: { fileName: string; content: string }): Promise<{ uri: string; name: string }>;
  loadProject(): Promise<{ content: string; name: string }>;
  loadProjectArchive(): Promise<{ base64: string; name: string }>;
  saveProjectArchive(options: { fileName: string; base64: string }): Promise<{ uri: string; name: string }>;
  clearAppCache(): Promise<{ cleared: boolean; message: string }>;
};
const NexusProjectFiles = registerPlugin<NexusProjectFilesPlugin>('NexusProjectFiles');

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

type DiagnosticEntry = { id: string; time: string; level: 'ERROR' | 'WARN' | 'INFO'; source: string; message: string; details?: string };
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
  const ikHostRef = useRef<HTMLDivElement>(null);
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
  // Scene Tree and Menu share one dock slot. Drag the right-center handle
  // toward the right to widen whichever panel is currently active.
  const [sharedPanelWidth, setSharedPanelWidth] = useState(172);
  const panelResizeStart = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const panelResizeMoveRef = useRef<((event: PointerEvent) => void) | null>(null);
  const panelResizeEndRef = useRef<((event: PointerEvent) => void) | null>(null);
  const beginPanelResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (panelResizeMoveRef.current) window.removeEventListener('pointermove', panelResizeMoveRef.current);
    if (panelResizeEndRef.current) {
      window.removeEventListener('pointerup', panelResizeEndRef.current);
      window.removeEventListener('pointercancel', panelResizeEndRef.current);
    }
    const start = { x: event.clientX, width: sharedPanelWidth, pointerId: event.pointerId };
    panelResizeStart.current = start;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      moveEvent.preventDefault();
      const maxWidth = Math.max(220, Math.min(420, Math.floor(window.innerWidth * 0.48)));
      setSharedPanelWidth(Math.max(150, Math.min(maxWidth, start.width + moveEvent.clientX - start.x)));
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== start.pointerId) return;
      panelResizeStart.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      panelResizeMoveRef.current = null;
      panelResizeEndRef.current = null;
    };
    panelResizeMoveRef.current = move;
    panelResizeEndRef.current = end;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const movePanelResize = (_event: React.PointerEvent<HTMLButtonElement>) => {};
  const endPanelResize = (_event: React.PointerEvent<HTMLButtonElement>) => {
    panelResizeStart.current = null;
    if (panelResizeMoveRef.current) window.removeEventListener('pointermove', panelResizeMoveRef.current);
    if (panelResizeEndRef.current) {
      window.removeEventListener('pointerup', panelResizeEndRef.current);
      window.removeEventListener('pointercancel', panelResizeEndRef.current);
    }
    panelResizeMoveRef.current = null;
    panelResizeEndRef.current = null;
  };

  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticEntry[]>(() => {
    try {
      const saved = localStorage.getItem('nexus3d_realtime_diagnostics_v1');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.slice(-400) as DiagnosticEntry[] : [];
    } catch { return []; }
  });
  const [diagnosticFilter, setDiagnosticFilter] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO'>('ALL');
  const [diagnosticPanelOpen, setDiagnosticPanelOpen] = useState(false);
  const [interactionTraceOpen, setInteractionTraceOpen] = useState(false);
  const diagnosticSinkRef = useRef<(level: DiagnosticEntry['level'], source: string, message: string, details?: string) => void>(() => {});
  const diagnosticQueueRef = useRef<DiagnosticEntry[]>([]);
  const pushDiagnostic = (level: DiagnosticEntry['level'], source: string, message: string, details?: string) => {
    // Capture immediately; UI state and localStorage are flushed in small batches.
    diagnosticQueueRef.current.push({ id: uid(), time: new Date().toLocaleTimeString(), level, source, message: String(message).slice(0, 1200), details: details ? String(details).slice(0, 5000) : undefined });
    if (diagnosticQueueRef.current.length > 100) diagnosticQueueRef.current.splice(0, diagnosticQueueRef.current.length - 100);
  };
  const clearDiagnosticLogs = () => {
    diagnosticQueueRef.current = [];
    setDiagnosticLogs([]);
    try { localStorage.removeItem('nexus3d_realtime_diagnostics_v1'); } catch { /* ignore unavailable storage */ }
  };
  const clearInteractionTraceLogs = () => {
    diagnosticQueueRef.current = diagnosticQueueRef.current.filter(entry => entry.source !== 'Interaction Trace');
    setDiagnosticLogs(previous => {
      const next = previous.filter(entry => entry.source !== 'Interaction Trace');
      try { localStorage.setItem('nexus3d_realtime_diagnostics_v1', JSON.stringify(next)); } catch { /* storage may be unavailable or full */ }
      return next;
    });
    setStatus('Cleared all RIT interaction events');
  };
  diagnosticSinkRef.current = pushDiagnostic;
  const recordInteractionTrace = (action: string, details: Record<string, unknown> = {}) => {
    diagnosticSinkRef.current('INFO', 'Interaction Trace', action, JSON.stringify(details));
  };
  useEffect(() => {
    const flush = () => {
      if (!diagnosticQueueRef.current.length) return;
      const batch = diagnosticQueueRef.current.splice(0, 100);
      setDiagnosticLogs(previous => {
        const next = [...previous, ...batch].slice(-400);
        try { localStorage.setItem('nexus3d_realtime_diagnostics_v1', JSON.stringify(next)); } catch { /* storage may be unavailable or full */ }
        return next;
      });
    };
    const timer = window.setInterval(flush, 180);
    return () => { window.clearInterval(timer); flush(); };
  }, []);
  const copyDiagnosticText = async (entries: DiagnosticEntry[]) => {
    const report = entries.map(entry => `[${entry.time}] [${entry.level}] [${entry.source}] ${entry.message}${entry.details ? '\\n' + entry.details : ''}`).join('\\n\\n');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(report);
      else {
        const field = document.createElement('textarea'); field.value = report; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.appendChild(field); field.select();
        const copied = document.execCommand('copy'); field.remove(); if (!copied) throw new Error('Clipboard permission unavailable');
      }
      setStatus(`Copied ${entries.length} diagnostic log(s)`);
    } catch { setStatus('Copy failed · allow clipboard permission and try again'); }
  };
  const visibleDiagnosticLogs = diagnosticFilter === 'ALL' ? diagnosticLogs : diagnosticLogs.filter(entry => entry.level === diagnosticFilter);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(false);
  const [coreOptimizerOpen, setCoreOptimizerOpen] = useState(false);
  const [coreOptimizerReport, setCoreOptimizerReport] = useState('Run an analysis to inspect current runtime load.');
  const [coreOptimizerAnalyzed, setCoreOptimizerAnalyzed] = useState(false);
  const [rdsScanBusy, setRdsScanBusy] = useState(false);
  const [rdsScanReport, setRdsScanReport] = useState('No full scan has been run yet.');
  const [rdsScanSummary, setRdsScanSummary] = useState({ checks: 0, passed: 0, warnings: 0, errors: 0 });
  const [rdsLastScanAt, setRdsLastScanAt] = useState('');
  const [rdsSourceAuditReport, setRdsSourceAuditReport] = useState('Build-time source audit has not been loaded yet.');
  const [dfiPanelOpen, setDfiPanelOpen] = useState(false);
  const [dfiBusy, setDfiBusy] = useState(false);
  const [dfiReport, setDfiReport] = useState('No DFI investigation has been run yet.');
  const [dfiSummary, setDfiSummary] = useState({ findings: 0, errors: 0, warnings: 0, repeatedErrors: 0, invalidMeshes: 0 });
  const rdsResourceBaselineRef = useRef<{ geometries: number; textures: number; time: number } | null>(null);
  const [menuAccordion, setMenuAccordion] = useState('Project & File');
  const [projectName, setProjectName] = useState('Project.nexus');
  const [saveAccordionOpen, setSaveAccordionOpen] = useState(false);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const projectZipFileRef = useRef<HTMLInputElement>(null);
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
  const touchDragOrigin = useRef<{ x: number; y: number } | null>(null);
  const touchDragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDragActive = useRef(false);
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
  const [treeActionId, setTreeActionId] = useState('');
  const [renamingTreeId, setRenamingTreeId] = useState('');
  const [renameTreeDraft, setRenameTreeDraft] = useState('');
  const [dragTargetId, setDragTargetId] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [cameraView, setCameraView] = useState(false);
  const [rigPanelOpen, setRigPanelOpen] = useState(false);
  const [riggingView, setRiggingView] = useState(false);
  const [manualRigOpen, setManualRigOpen] = useState(true);
  const [autoIKOpen, setAutoIKOpen] = useState(true);
  const [manualRigStage, setManualRigStage] = useState('setup');
  const [manualRigSections, setManualRigSections] = useState<Record<string, boolean>>({ setup: true, skeleton: false, position: false, attach: false, controls: false, test: false });
  const [ikEnabled, setIkEnabled] = useState(false);
  const [ikChainLength, setIkChainLength] = useState(3);
  const [jointLimitDegrees, setJointLimitDegrees] = useState(120);
  const [ikSolver, setIkSolver] = useState<'CCD' | 'FABRIK'>('CCD');
  const ikSolverRef = useRef<'CCD' | 'FABRIK'>('CCD');
  const jointLimitDegreesRef = useRef(120);
  useEffect(() => { ikSolverRef.current = ikSolver; }, [ikSolver]);
  useEffect(() => { jointLimitDegreesRef.current = jointLimitDegrees; }, [jointLimitDegrees]);
  const [rigTab, setRigTab] = useState<'auto' | 'manual' | 'pose'>('manual');
  const [shapeRigPlacementStep, setShapeRigPlacementStep] = useState<'idle' | 'root' | 'child' | 'placing-child' | 'done'>('idle');
  const [mirrorEnabled, setMirrorEnabled] = useState(true);
  const mirrorEnabledRef = useRef(true);
  useEffect(() => { mirrorEnabledRef.current = mirrorEnabled; }, [mirrorEnabled]);
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
  const activeEditToolRef = useRef<'Extrude' | 'Subdivide' | 'Smooth' | 'Cutting' | ''>('');
  const setEditTool = (tool: 'Extrude' | 'Subdivide' | 'Smooth' | 'Cutting' | '') => { activeEditToolRef.current = tool; setActiveEditTool(tool); };
  const [editAmount, setEditAmount] = useState(35);
  const editBaseGeometry = useRef<THREE.BufferGeometry | null>(null);
  const extrudeBaseGeometry = useRef<THREE.BufferGeometry | null>(null);
  const extrudeBaseCutLoops = useRef<number[][][]>([]);
  const extrudeHistoryUpdate = useRef<((geometry: THREE.BufferGeometry, cutLoops: number[][][]) => void) | null>(null);
  const loopCutContext = useRef<{ meshId: string; indices: number[] } | null>(null);
  const subdivideCutCount = useRef<Record<string, number>>({});
  const extrudeContext = useRef<{ meshId: string; indices: number[]; faceParts?: number[][] } | null>(null);
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
  useEffect(() => {
    const formatDetails = (value: unknown) => {
      if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? '\\n' + value.stack : ''}`;
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item, 2) ?? String(value); }
      catch { return String(value); }
    };
    const onError = (event: ErrorEvent) => {
      const target = event.target as (HTMLElement & { src?: string; href?: string }) | null;
      const isResourceFailure = Boolean(target && target.nodeType === 1 && (target.tagName === 'SCRIPT' || target.tagName === 'LINK' || target.tagName === 'IMG'));
      diagnosticSinkRef.current(isResourceFailure ? 'ERROR' : 'ERROR', isResourceFailure ? 'Resource Load' : 'JavaScript',
        isResourceFailure ? 'Failed to load page resource' : (event.message || 'Uncaught runtime error'),
        `${event.filename || target?.getAttribute?.('src') || target?.getAttribute?.('href') || 'unknown source'}:${event.lineno || 0}:${event.colno || 0}${event.error ? '\\n' + formatDetails(event.error) : ''}`);
    };
    const onRejection = (event: PromiseRejectionEvent) => diagnosticSinkRef.current('ERROR', 'Promise', 'Unhandled promise rejection', formatDetails(event.reason));
    const onWebGL = (event: Event) => diagnosticSinkRef.current(event.type === 'webglcontextlost' ? 'ERROR' : 'INFO', 'WebGL', event.type === 'webglcontextlost' ? 'WebGL context lost' : 'WebGL context restored', 'Renderer canvas context event');
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    console.error = (...args: unknown[]) => {
      try { diagnosticSinkRef.current('ERROR', 'console.error', args.map(formatDetails).join(' | ')); } catch { /* preserve native console behavior */ }
      originalConsoleError.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      try {
        const message = args.map(formatDetails).join(' | ');
        const relevant = /webgl|context|memory|performance|failed|deprecated|overflow|texture|shader|three\.js|orbit|transform|pointer|gesture|bone|rig/i.test(message);
        if (relevant) diagnosticSinkRef.current('WARN', 'console.warn', message);
      } catch { /* preserve native console behavior */ }
      originalConsoleWarn.apply(console, args);
    };
    const onResourceError = (event: Event) => {
      const target = event.target as (HTMLElement & { src?: string; href?: string }) | null;
      if (!target || target.nodeType !== 1 || !['SCRIPT','LINK','IMG','VIDEO','AUDIO'].includes(target.tagName)) return;
      diagnosticSinkRef.current('ERROR', 'Resource Load', 'Asset or script failed to load',
        target.getAttribute('src') || target.getAttribute('href') || target.tagName);
    };
    let longTaskObserver: PerformanceObserver | null = null;
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        longTaskObserver = new PerformanceObserver(list => {
          list.getEntries().forEach(entry => diagnosticSinkRef.current(entry.duration >= 250 ? 'ERROR' : 'WARN',
            'Main Thread', 'Long task blocked UI thread', `${Math.round(entry.duration)} ms`));
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      }
    } catch { diagnosticSinkRef.current('INFO', 'Performance', 'Long-task observer unavailable on this WebView'); }
    window.addEventListener('error', onError);
    window.addEventListener('error', onResourceError, true);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('webglcontextlost', onWebGL, true);
    document.addEventListener('webglcontextrestored', onWebGL, true);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('error', onResourceError, true);
      window.removeEventListener('unhandledrejection', onRejection);
      longTaskObserver?.disconnect();
      document.removeEventListener('webglcontextlost', onWebGL, true);
      document.removeEventListener('webglcontextrestored', onWebGL, true);
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    };
  }, []);

  // Event-driven fault capture plus low-overhead periodic health sampling.
  useEffect(() => {
    let lastMemoryWarning = 0;
    let lastResourceWarning = 0;
    const sample = () => {
      if (document.visibilityState === 'hidden') return;
      const now = performance.now();
      const heap = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
      const usedMB = heap?.usedJSHeapSize ? Math.round(heap.usedJSHeapSize / 1048576) : null;
      const limitMB = heap?.jsHeapSizeLimit ? Math.round(heap.jsHeapSizeLimit / 1048576) : null;
      if (usedMB !== null && usedMB >= 400 && now - lastMemoryWarning > 20000) {
        lastMemoryWarning = now;
        diagnosticSinkRef.current('WARN', 'Memory Monitor', 'JavaScript heap usage is high', `Used heap: ${usedMB}MB${limitMB ? ` / ${limitMB}MB` : ''}`);
      }
      const info = (runtime.current as any)?.renderer?.info;
      if (info) {
        const memory = info.memory || {}; const render = info.render || {};
        if (((memory.geometries || 0) > 1200 || (memory.textures || 0) > 350 || (render.calls || 0) > 2200) && now - lastResourceWarning > 20000) {
          lastResourceWarning = now;
          diagnosticSinkRef.current('WARN', 'WebGL Resource Monitor', 'High scene rendering/resource load', `Geometries: ${memory.geometries || 0} | Textures: ${memory.textures || 0} | Draw calls: ${render.calls || 0} | Triangles: ${render.triangles || 0}`);
        }
      }
    };
    diagnosticSinkRef.current('INFO', 'Diagnostic Monitor', 'Low-overhead realtime monitoring started', 'Runtime faults are event-driven; memory and WebGL load are sampled every 5 seconds. No extra animation-frame loop is used.');
    const timer = window.setInterval(sample, 5000);
    return () => window.clearInterval(timer);
  }, []);
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

    // Single-renderer IK workspace: reuse the Main Viewport WebGL context.
    // Moving its canvas between hosts avoids a second Android WebGL context.
    const ikHost = ikHostRef.current;
    const ikCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    ikCamera.position.set(0, 1.5, 6);
    const ikRenderer = renderer;
    const ikOrbit = new OrbitControls(ikCamera, renderer.domElement);
    if (ikOrbit) {
      ikOrbit.enableDamping = true;
      ikOrbit.dampingFactor = 0.08;
      ikOrbit.minDistance = 0.05;
      ikOrbit.maxDistance = 10000;
      ikOrbit.enabled = false;
    }

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
      // Refresh bounds before deriving a scale-aware overlay offset. This is
      // shared by quad-grid and EdgesGeometry paths so freshly extruded edges
      // never sit exactly on the surface and disappear from depth-buffer z-fighting.
      mesh.geometry.computeBoundingSphere();
      const bounds = mesh.geometry.boundingSphere;
      const lineOffset = Math.max(0.0012, (bounds?.radius || 1) * 0.002);
      let edges: THREE.BufferGeometry;
      if (isQuadGrid && position) {
        // The mesh stores each quad as two triangles [0,1,2, 0,2,3].
        // Draw only the four quad boundaries, nudged slightly outward to prevent z-fighting.
        const edgePositions: number[] = [];
        const seen = new Set<string>();
        const pointAt = (index: number) => new THREE.Vector3().fromBufferAttribute(position, index);
        const pointKey = (point: THREE.Vector3) => [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
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
        // EdgesGeometry emits only boundaries and hard edges, but its vertices
        // are otherwise exactly coincident with the surface. Offset each edge
        // endpoint along the averaged source vertex normal to keep black lines
        // visible after Face Extrude / Scale without exposing hidden back edges.
        const edgePosition = edges.getAttribute('position') as THREE.BufferAttribute;
        let sourceNormals = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
        if (!sourceNormals && position) {
          mesh.geometry.computeVertexNormals();
          sourceNormals = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
        }
        if (edgePosition && sourceNormals && position) {
          const normalSums = new Map<string, { normal: THREE.Vector3; count: number }>();
          const keyAt = (x: number, y: number, z: number) =>
            [x, y, z].map(value => Math.round(value * 1e5)).join(',');
          for (let vertex = 0; vertex < position.count && vertex < sourceNormals.count; vertex++) {
            const key = keyAt(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
            const entry = normalSums.get(key) || { normal: new THREE.Vector3(), count: 0 };
            entry.normal.add(new THREE.Vector3().fromBufferAttribute(sourceNormals, vertex));
            entry.count++;
            normalSums.set(key, entry);
          }
          for (let vertex = 0; vertex < edgePosition.count; vertex++) {
            const x = edgePosition.getX(vertex), y = edgePosition.getY(vertex), z = edgePosition.getZ(vertex);
            const entry = normalSums.get(keyAt(x, y, z));
            if (!entry) continue;
            const normal = entry.normal.normalize();
            edgePosition.setXYZ(vertex, x + normal.x * lineOffset, y + normal.y * lineOffset, z + normal.z * lineOffset);
          }
          edgePosition.needsUpdate = true;
          edges.computeBoundingSphere();
        }
      }
      const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: false, opacity: 1, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      lines.name = 'Editable Topology Overlay'; lines.renderOrder = 1004;
      topologyOverlay.add(lines);
      // Cut loops still define Face Mode region boundaries. Quad-grid edges are
      // already drawn from explicit quad perimeters above, so don't draw duplicates.
      const cutLoops = Array.isArray(mesh.userData.cutLoops) ? mesh.userData.cutLoops as number[][][] : [];
      if (!isQuadGrid) cutLoops.forEach((loop, loopIndex) => {
        if (!Array.isArray(loop) || loop.length < 2) return;
        const points = loop.map(point => new THREE.Vector3(point[0], point[1], point[2]));
        const cut = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
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
    // Allow a near-full vertical orbit so users can inspect the underside and top of a shape.
    // Keep a small margin away from the poles to avoid unstable camera orientation.
    orbit.minPolarAngle = 0.01;
    orbit.maxPolarAngle = Math.PI - 0.01;
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
    const controlDiag = (eventName: string, extra: Record<string, unknown> = {}) => {
      const state = {
        dragging: Boolean(transform.dragging),
        axis: transform.axis ?? null,
        transformEnabled: Boolean(transform.enabled),
        attachedObject: transform.object?.name ?? null,
        mainOrbitEnabled: Boolean(orbit.enabled),
        cameraOrbitEnabled: Boolean(activeOrbit.enabled),
        ikOrbitEnabled: Boolean(ikOrbit.enabled),
        riggingView: Boolean(runtime.current?.riggingView),
        cameraView: Boolean(runtime.current?.cameraView),
        selectedId: selectedRef.current ?? null,
        ...extra,
      };
      console.info('[Nexus3D ControlDiag]', eventName, state);
      diagnosticSinkRef.current('INFO', 'Viewport Controls', eventName, JSON.stringify(state));
    };
    const syncViewportControls = (dragging = Boolean(transform.dragging)) => {
      const inRigView = Boolean(runtime.current?.riggingView);
      const inCameraView = Boolean(runtime.current?.cameraView);
      orbit.enabled = !dragging && !inRigView && !inCameraView;
      activeOrbit.enabled = !dragging && inCameraView && !inRigView;
      ikOrbit.enabled = !dragging && inRigView;
      controlDiag('syncViewportControls', { requestedDragging: dragging });
    };
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
    let activeSubSelection: { mesh: THREE.Mesh; indices: number[]; faceParts?: number[][]; linkedIndices?: number[]; lastWorld: THREE.Vector3; lastQuaternion: THREE.Quaternion; lastScale: THREE.Vector3 } | null = null;
    let subGeometryBefore: THREE.BufferGeometry | null = null;
    const selectable: THREE.Object3D[] = [camBody];
    const rigChains: Array<{ bones: THREE.Bone[]; helper: THREE.SkeletonHelper; target: THREE.Object3D | null; pole?: THREE.Object3D | null; displayVisible?: boolean; shapeRig?: boolean; owner?: THREE.Object3D | null }> = [];
    let rigAttachTarget: THREE.Object3D | null = null;
    const nextManualBoneName = () => {
      const used = new Set(selectable.filter(object => object instanceof THREE.Bone).map(object => object.name));
      let index = 1; let candidate = '';
      do { candidate = 'Bone_' + String(index++).padStart(2, '0'); } while (used.has(candidate));
      return candidate;
    };
    const ensureBoneJoint = (bone: THREE.Bone) => {
      const existing = bone.children.find(child => child.userData.nexusJointVisual) as THREE.Mesh | undefined;
      if (existing) {
        existing.geometry = existing.geometry instanceof THREE.SphereGeometry && existing.geometry.parameters.radius >= 0.06 ? existing.geometry : new THREE.SphereGeometry(0.06, 14, 10);
        existing.name = bone.name + ' Joint';
        existing.userData.nexusBoneVisual = true;
        existing.userData.nexusBoneOwnerId = String(bone.userData.editorId || '');
        return;
      }
      const color = bone.userData.locked ? '#778391' : bone.userData.detached ? '#b56bdb' : '#39c98a';
      const joint = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.96 }));
      joint.name = bone.name + ' Joint';
      joint.userData.nexusJointVisual = true;
      joint.userData.nexusBoneVisual = true;
      joint.userData.nexusBoneOwnerId = String(bone.userData.editorId || '');
      joint.renderOrder = 18;
      // Keep joints raycastable so bones inside parent meshes can be selected.
      bone.add(joint);
    };
    const refreshJointColors = (active?: THREE.Object3D) => {
      selectable.forEach(object => {
        if (!(object instanceof THREE.Bone)) return;
        const joint = object.children.find(child => child.userData.nexusJointVisual) as THREE.Mesh | undefined;
        if (!joint) return;
        const color = object.userData.locked ? '#ffb52e' : object === active ? '#00d9ff' : object.userData.detached ? '#b56bdb' : '#aeb9c4';
        ((joint as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
      });
    };
    const styleSkeletonHelper = (helper: THREE.SkeletonHelper, _bones: THREE.Bone[]) => {
      // SkeletonHelper keeps a fixed bone list from construction time. Color exactly
      // the segments in that list so the color attribute always matches its geometry.
      const helperBones = ((helper as any).bones || []) as THREE.Bone[];
      const colors: number[] = [];
      helperBones.forEach(bone => {
        const lineColor = bone.userData.locked ? new THREE.Color('#778391') : new THREE.Color('#00d9ff');
        colors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.r, lineColor.g, lineColor.b);
      });
      helper.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = helper.material as THREE.LineBasicMaterial;
      material.vertexColors = true;
      material.color.set('#ffffff');
      material.transparent = true;
      material.opacity = 0.96;
      material.linewidth = 2;
      helper.frustumCulled = false;
      helper.visible = false;
    };
    const rebuildRigHelper = (chain: { bones: THREE.Bone[]; helper: THREE.SkeletonHelper; target: THREE.Object3D | null; pole?: THREE.Object3D | null; displayVisible?: boolean }) => {
      // Recreate SkeletonHelper after hierarchy edits; update() alone cannot discover
      // bones added after the helper was constructed.
      const root = chain.bones.find(bone => !chain.bones.some(other => other !== bone && other.getObjectById(bone.id))) || chain.bones[0];
      if (!root) return;
      const oldHelper = chain.helper;
      if (oldHelper) {
        scene.remove(oldHelper);
        oldHelper.geometry?.dispose();
        const oldMaterial = oldHelper.material;
        if (Array.isArray(oldMaterial)) oldMaterial.forEach(material => material.dispose());
        else oldMaterial?.dispose();
      }
      const helper = new THREE.SkeletonHelper(root);
      helper.name = root.name + ' Skeleton';
      styleSkeletonHelper(helper, chain.bones);
      // Manual Shape Rig connections stay visible after hierarchy changes.
      // Imported character skeleton helpers retain their existing hidden-helper behavior.
      helper.visible = chain.shapeRig ? chain.displayVisible !== false : false;
      scene.add(helper);
      chain.helper = helper;
    };
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
      const attachTo = (target: THREE.Object3D) => {
        scene.updateMatrixWorld(true); target.attach(child); scene.updateMatrixWorld(true);
        if (child instanceof THREE.Bone || target instanceof THREE.Bone) {
          // Refresh the affected rig from its live hierarchy. This is important
          // when a Bone is moved out of a chain or a Shape becomes a Bone child.
          rigChains.forEach(chain => {
            const affected = chain.bones.some(bone =>
              bone === child || bone === target ||
              child.getObjectById(bone.id) || target.getObjectById(bone.id)
            );
            if (!affected) return;

            if (chain.shapeRig) {
              const root = chain.bones.find(bone => bone.userData.rigRole === 'root') ||
                chain.bones.find(bone => !chain.bones.some(other => other !== bone && other.getObjectById(bone.id)));
              if (root) {
                const liveBones: THREE.Bone[] = [];
                root.traverse(node => {
                  if ((node as THREE.Bone).isBone) {
                    const bone = node as THREE.Bone;
                    liveBones.push(bone);
                    ensureBoneJoint(bone);
                  }
                });
                chain.bones = liveBones;
              }
            }

            rebuildRigHelper(chain);
            chain.helper.updateMatrixWorld(true);
            chain.helper.visible = chain.shapeRig ? chain.displayVisible !== false : false;
            chain.bones.forEach(bone => {
              const joint = bone.children.find(node => node.userData.nexusJointVisual);
              if (joint) joint.visible = chain.displayVisible !== false;
            });
          });
          refreshRigVisuals();
        }
        syncItems();
      };
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
    const toggleBoneDisplay = (obj: THREE.Object3D) => {
      if (!(obj instanceof THREE.Bone)) return toggleVisibility(obj);
      const chain = rigChains.find(entry => entry.bones.includes(obj));
      if (!chain) { setStatus('No skeleton display group found for this bone'); return; }
      chain.displayVisible = chain.displayVisible === false ? true : false;
      chain.helper.visible = false;
      chain.bones.forEach(bone => { const visual = bone.children.find(child => child.userData.nexusJointVisual); if (visual) visual.visible = chain.displayVisible!; });
      syncItems();
      setStatus((chain.displayVisible ? 'IK bones shown: ' : 'IK bones hidden: ') + (chain.bones[0]?.name || obj.name));
    };
    const isBoneDisplayVisible = (obj: THREE.Object3D) => {
      if (!(obj instanceof THREE.Bone)) return obj.visible;
      const chain = rigChains.find(entry => entry.bones.includes(obj));
      return chain ? chain.displayVisible !== false : true;
    };
    const selectObject = (obj?: THREE.Object3D) => {
      if (String(obj?.userData?.editorId || '') !== selectedRef.current) clearTopologyOverlay();
      if (!obj) {
        transform.detach();
        transform.enabled = false;
        transform.getHelper().visible = false;
        setSelected('');
        selectedRef.current = '';
        return;
      }
      // Undo can restore a deleted Shape Root. Rebuild its helper/chain lazily
      // from the restored hierarchy instead of retaining stale helper references.
      if (obj instanceof THREE.Bone && obj.userData.shapeRig && obj.userData.rigRole === 'root' &&
          !rigChains.some(chain => chain.bones.includes(obj))) {
        const restoredBones: THREE.Bone[] = [];
        obj.traverse(node => { if ((node as THREE.Bone).isBone) restoredBones.push(node as THREE.Bone); });
        const restoredHelper = new THREE.SkeletonHelper(obj);
        restoredHelper.name = obj.name + ' Skeleton';
        styleSkeletonHelper(restoredHelper, restoredBones);
        scene.add(restoredHelper);
        rigChains.push({
          bones: restoredBones,
          helper: restoredHelper,
          target: null,
          displayVisible: true,
          shapeRig: true,
          owner: (() => {
            let anchor: THREE.Object3D | null = obj.parent;
            while (anchor && !anchor.userData.nexusRigAnchor) anchor = anchor.parent;
            if (anchor?.userData.nexusRigAnchor) {
              return anchor.userData.pendingShapeAttachment || anchor.parent === scene ? null : anchor.parent || null;
            }
            return obj.parent && !(obj.parent instanceof THREE.Bone) && obj.parent !== scene ? obj.parent : null;
          })()
        });
      }
      const movableLockedRoot = obj instanceof THREE.Bone && obj.userData.shapeRig && obj.userData.rigRole === 'root' && obj.userData.locked;
      const objectMode = editModeRef.current === 'Object';
      const selectionLocked = Boolean(obj.userData.objectManagerLocked) || (obj instanceof THREE.Bone && obj.userData.locked && !movableLockedRoot) || (obj.userData.rigControlMarker && obj.userData.controlLocked);

      // One controller owns selection in both workspaces. The active camera is
      // switched by the workspace toggle; attachment never changes controllers.
      transform.detach();
      if (selectionLocked) {
        transform.enabled = false;
        transform.getHelper().visible = false;
      } else {
        transform.attach(obj);
        transform.enabled = objectMode;
        transform.getHelper().visible = objectMode;
      }
      transform.setMode(movableLockedRoot ? 'translate' : mode);
      transform.setSpace(space);
      if (obj instanceof THREE.Light) {
        setSettings(prev => ({ ...prev, lightIntensity: obj.intensity, lightColor: '#' + obj.color.getHexString(), ...(obj instanceof THREE.DirectionalLight ? { directionalIntensity: obj.intensity } : {}), ...(obj instanceof THREE.SpotLight ? { spotIntensity: obj.intensity, spotDistance: obj.distance, spotDecay: obj.decay, spotAngle: THREE.MathUtils.radToDeg(obj.angle) } : {}), ...(obj instanceof THREE.HemisphereLight ? { sunIntensity: obj.intensity, ambientIntensity: obj.intensity } : {}) }));
      }
      setSelected(String(obj.userData.editorId || ''));
      selectedRef.current = String(obj.userData.editorId || '');
      refreshJointColors(obj instanceof THREE.Bone ? obj : undefined);
      if (obj instanceof THREE.Mesh && editModeRef.current !== 'Object') refreshTopologyOverlay(obj);
      // Selection is reflected by the viewport, Scene Tree, and Inspector; do not spawn a toast per tap.
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
        // Convert built-in primitive triangle pairs into an explicit quad-cell stream.
        // The conversion is intentionally restricted to editor-generated primitives;
        // arbitrary imported meshes and deforming character meshes never enter this path.
        const buildPrimitiveQuadGrid = (sourceGeometry: THREE.BufferGeometry) => {
          const source = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
          const position = source.getAttribute('position') as THREE.BufferAttribute | undefined;
          const uv = source.getAttribute('uv') as THREE.BufferAttribute | undefined;
          const normal = source.getAttribute('normal') as THREE.BufferAttribute | undefined;
          if (!position || position.count < 6 || position.count % 3 !== 0) { source.dispose(); return null; }
          const pointKey = (index: number) => {
            const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
            return [x, y, z].map(value => Math.round(value * 1e6)).join(',');
          };
          const triangles = Array.from({ length: position.count / 3 }, (_value, triangleIndex) => ({
            indices: [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2],
            paired: false
          }));
          const edgeLength = (a: number, b: number) => {
            const dx = position.getX(a) - position.getX(b);
            const dy = position.getY(a) - position.getY(b);
            const dz = position.getZ(a) - position.getZ(b);
            return dx * dx + dy * dy + dz * dz;
          };
          const edgeMap = new Map<string, number[]>();
          triangles.forEach((triangle, triangleIndex) => {
            for (let edge = 0; edge < 3; edge++) {
              const a = pointKey(triangle.indices[edge]), b = pointKey(triangle.indices[(edge + 1) % 3]);
              if (a === b) continue;
              const key = a < b ? a + '|' + b : b + '|' + a;
              const owners = edgeMap.get(key) || [];
              owners.push(triangleIndex);
              edgeMap.set(key, owners);
            }
          });
          const outputPositions: number[] = [];
          const outputUvs: number[] = [];
          const outputNormals: number[] = [];
          const readVertex = (index: number) => ({
            position: [position.getX(index), position.getY(index), position.getZ(index)],
            uv: uv ? [uv.getX(index), uv.getY(index)] : [0, 0],
            normal: normal ? [normal.getX(index), normal.getY(index), normal.getZ(index)] : [0, 0, 0],
            key: pointKey(index)
          });
          const pushQuad = (corners: ReturnType<typeof readVertex>[]) => {
            const baseUvU = corners[0].uv[0], baseUvV = corners[0].uv[1];
            const adjustedUvs = corners.map(corner => {
              let u = corner.uv[0], v = corner.uv[1];
              while (u - baseUvU > 0.5) u -= 1;
              while (u - baseUvU < -0.5) u += 1;
              while (v - baseUvV > 0.5) v -= 1;
              while (v - baseUvV < -0.5) v += 1;
              return [u, v];
            });
            [0, 1, 2, 0, 2, 3].forEach(cornerIndex => {
              outputPositions.push(...corners[cornerIndex].position);
              outputUvs.push(...adjustedUvs[cornerIndex]);
              outputNormals.push(...corners[cornerIndex].normal);
            });
          };
          let pairedCount = 0;
          for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) {
            const triangle = triangles[triangleIndex];
            if (triangle.paired) continue;
            const candidates: Array<{ other: number; edge: number; sharedLength: number }> = [];
            for (let edge = 0; edge < 3; edge++) {
              const ka = pointKey(triangle.indices[edge]), kb = pointKey(triangle.indices[(edge + 1) % 3]);
              const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
              (edgeMap.get(key) || []).forEach(other => {
                if (other !== triangleIndex && !triangles[other].paired) candidates.push({ other, edge, sharedLength: edgeLength(triangle.indices[edge], triangle.indices[(edge + 1) % 3]) });
              });
            }
            // Pair across the triangle's longest shared edge first. For standard
            // triangulated primitive cells this is the internal diagonal, not a
            // shorter boundary edge that would merge neighboring cells together.
            candidates.sort((a, b) => b.sharedLength - a.sharedLength);
            let chosen: { other: number; corners: number[] } | null = null;
            for (const candidate of candidates) {
              const otherIndices = triangles[candidate.other].indices;
              const edgeA = triangle.indices[candidate.edge], edgeB = triangle.indices[(candidate.edge + 1) % 3];
              const keyA = pointKey(edgeA), keyB = pointKey(edgeB);
              // A valid manifold triangle pair traverses the shared edge in opposite directions.
              const reverseEdge = otherIndices.some((index, edgeIndex) =>
                pointKey(index) === keyB && pointKey(otherIndices[(edgeIndex + 1) % 3]) === keyA
              );
              if (!reverseEdge) continue;
              const opposite = otherIndices.find(index => pointKey(index) !== keyA && pointKey(index) !== keyB);
              const remaining = triangle.indices[(candidate.edge + 2) % 3];
              if (opposite === undefined) continue;
              if (normal) {
                const normalA = new THREE.Vector3().fromBufferAttribute(normal, edgeA).normalize();
                const normalB = new THREE.Vector3().fromBufferAttribute(normal, edgeB).normalize();
                const otherA = new THREE.Vector3().fromBufferAttribute(normal, otherIndices.find(index => pointKey(index) === keyA)!).normalize();
                const otherB = new THREE.Vector3().fromBufferAttribute(normal, otherIndices.find(index => pointKey(index) === keyB)!).normalize();
                if (normalA.dot(otherA) < 0.65 || normalB.dot(otherB) < 0.65) continue;
              }
              // Shared diagonal is A-B. The outer perimeter is A-D-B-C:
              // A -> opposite (D) -> shared endpoint B -> remaining (C).
              // Keeping this order avoids putting the internal diagonal on the quad boundary.
              const corners = [edgeA, opposite, edgeB, remaining];
              if (new Set(corners.map(pointKey)).size !== 4) continue;
              const points = corners.map(index => new THREE.Vector3().fromBufferAttribute(position, index));
              const [p0, p1, p2, p3] = points;
              const perimeterNormal = p1.clone().sub(p0).cross(p2.clone().sub(p1))
                .add(p2.clone().sub(p1).cross(p3.clone().sub(p2)))
                .add(p3.clone().sub(p2).cross(p0.clone().sub(p3)))
                .add(p0.clone().sub(p3).cross(p1.clone().sub(p0)));
              const triangleNormal = (indices: number[]) => {
                const a = new THREE.Vector3().fromBufferAttribute(position, indices[0]);
                const b = new THREE.Vector3().fromBufferAttribute(position, indices[1]);
                const c = new THREE.Vector3().fromBufferAttribute(position, indices[2]);
                return b.sub(a).cross(c.sub(a)).normalize();
              };
              const currentNormal = triangleNormal(triangle.indices);
              const pairedNormal = triangleNormal(otherIndices);
              const convexTurns = [
                p1.clone().sub(p0).cross(p2.clone().sub(p1)),
                p2.clone().sub(p1).cross(p3.clone().sub(p2)),
                p3.clone().sub(p2).cross(p0.clone().sub(p3)),
                p0.clone().sub(p3).cross(p1.clone().sub(p0))
              ];
              const isConvex = perimeterNormal.lengthSq() > 1e-10 &&
                convexTurns.every(turn => turn.dot(perimeterNormal) > 1e-10);
              if (isConvex && currentNormal.dot(pairedNormal) > 0.65) {
                chosen = { other: candidate.other, corners };
                break;
              }
            }
            if (!chosen) { source.dispose(); return null; }
            triangle.paired = true;
            triangles[chosen.other].paired = true;
            pushQuad(chosen.corners.map(readVertex));
            pairedCount += 2;
          }
          source.dispose();
          if (pairedCount !== triangles.length || !outputPositions.length) return null;
          const result = new THREE.BufferGeometry();
          result.setAttribute('position', new THREE.Float32BufferAttribute(outputPositions, 3));
          result.setAttribute('uv', new THREE.Float32BufferAttribute(outputUvs, 2));
          if (normal) result.setAttribute('normal', new THREE.Float32BufferAttribute(outputNormals, 3));
          else result.computeVertexNormals();
          return result;
        };
        // A UV sphere has triangle fans at its poles, so triangle pairing cannot
        // produce a complete quad grid there. Build it as six projected cube faces
        // instead; every cell is a real quad and the poles have no degenerate faces.
        const buildSphereQuadGrid = (radius: number, divisions = 16) => {
          const faces = [
            { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
            { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
            { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
            { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
            { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
            { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }
          ];
          const positions: number[] = [], uvs: number[] = [], normals: number[] = [];
          const point = (face: typeof faces[number], u: number, v: number) => {
            const cube = new THREE.Vector3(
              face.n[0] + face.u[0] * u + face.v[0] * v,
              face.n[1] + face.u[1] * u + face.v[1] * v,
              face.n[2] + face.u[2] * u + face.v[2] * v
            ).normalize().multiplyScalar(radius);
            return cube;
          };
          faces.forEach(face => {
            for (let y = 0; y < divisions; y++) for (let x = 0; x < divisions; x++) {
              const u0 = -1 + 2 * x / divisions, u1 = -1 + 2 * (x + 1) / divisions;
              const v0 = -1 + 2 * y / divisions, v1 = -1 + 2 * (y + 1) / divisions;
              let corners = [point(face, u0, v0), point(face, u1, v0), point(face, u1, v1), point(face, u0, v1)];
              const outward = corners[1].clone().sub(corners[0]).cross(corners[3].clone().sub(corners[0])).dot(corners[0]);
              if (outward < 0) corners = [corners[0], corners[3], corners[2], corners[1]];
              const tex = [[x / divisions, y / divisions], [(x + 1) / divisions, y / divisions], [(x + 1) / divisions, (y + 1) / divisions], [x / divisions, (y + 1) / divisions]];
              [0, 1, 2, 0, 2, 3].forEach(cornerIndex => {
                const p = corners[cornerIndex], uv = tex[cornerIndex];
                positions.push(p.x, p.y, p.z);
                uvs.push(uv[0], uv[1]);
                const smoothNormal = p.clone().normalize();
                normals.push(smoothNormal.x, smoothNormal.y, smoothNormal.z);
              });
            }
          });
          const result = new THREE.BufferGeometry();
          result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
          // Radial normals keep the cube-projected sphere visually smooth; computing
          // normals from duplicated non-indexed triangles would create faceted shading.
          result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
          result.userData.nexusPrimitiveQuadGrid = true;
          return result;
        };
        if (kind !== 'Cube') {
          const quadGeometry = kind === 'Sphere' ? buildSphereQuadGrid(0.68) : buildPrimitiveQuadGrid(geometry);
          if (quadGeometry) {
            geometry.dispose();
            geometry = quadGeometry;
          }
        }
        obj = new THREE.Mesh(geometry, material);
        if (kind !== 'Cube' && geometry.userData.nexusPrimitiveQuadGrid === true) {
          obj.userData.nexusQuadGrid = true;
          obj.userData.nexusQuadGridLayout = 'triangle-paired-primitive';
        }
        // Non-shape editor objects must not push new primitives outside the active camera view.
        const shapeKinds = new Set(['Cube', 'Sphere', 'Cylinder', 'Cone', 'Torus']);
        const n = selectable.filter(object => shapeKinds.has(String(object.userData.kind)) && object.parent === scene).length;
        const spawnTarget = runtime.current?.riggingView ? ikOrbit.target : orbit.target;
        const angle = n * 2.399963229728653;
        const radius = n === 0 ? 0 : Math.min(4, 0.85 + Math.sqrt(n) * 0.35);
        obj.position.set(spawnTarget.x + Math.cos(angle) * radius, Math.max(0.68, spawnTarget.y), spawnTarget.z + Math.sin(angle) * radius);
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
    const mirrorBoneName = (name: string) => {
      if (/\.L$/i.test(name)) return name.replace(/\.L$/i, '.R');
      if (/\.R$/i.test(name)) return name.replace(/\.R$/i, '.L');
      if (/Left/i.test(name)) return name.replace(/Left/i, 'Right');
      if (/Right/i.test(name)) return name.replace(/Right/i, 'Left');
      return name + '.R';
    };
    // Manual Shape Rig v2: a private anchor isolates the skeleton transform
    // hierarchy from the mesh object while keeping the rig centered inside it.
    const addUniversalBone = (mode: 'root' | 'child' | 'auto' = 'auto') => {
      const selectedObject = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      const resolveRoot = (bone: THREE.Bone) => {
        let root = bone;
        while (root.parent instanceof THREE.Bone) root = root.parent;
        return root;
      };
      const resolveOwner = (root: THREE.Bone) => {
        let anchor: THREE.Object3D | null = root.parent;
        while (anchor && !anchor.userData.nexusRigAnchor) anchor = anchor.parent;
        if (anchor?.userData.nexusRigAnchor) {
          if (anchor.userData.pendingShapeAttachment || anchor.parent === scene || !anchor.parent) return null;
          return anchor.parent;
        }
        const chain = rigChains.find(entry => entry.bones.includes(root));
        if (chain?.owner) return chain.owner;
        return root.parent && !(root.parent instanceof THREE.Bone) && root.parent !== scene ? root.parent : null;
      };
      const makeHelper = (root: THREE.Bone, owner: THREE.Object3D | null = null) => {
        const bones: THREE.Bone[] = [];
        root.traverse(node => { if ((node as THREE.Bone).isBone) bones.push(node as THREE.Bone); });
        const helper = new THREE.SkeletonHelper(root);
        helper.name = root.name + ' Skeleton';
        styleSkeletonHelper(helper, bones);
        helper.visible = true;
        scene.add(helper);
        const existing = rigChains.find(entry => entry.bones.includes(root));
        if (existing) {
          if (existing.helper && existing.helper !== helper) {
            scene.remove(existing.helper);
            existing.helper.geometry?.dispose();
            const oldMaterial = existing.helper.material;
            if (Array.isArray(oldMaterial)) oldMaterial.forEach(material => material.dispose());
            else oldMaterial?.dispose();
          }
          existing.bones = bones;
          existing.helper = helper;
          existing.owner = owner || null;
          existing.shapeRig = true;
          existing.displayVisible = true;
        } else {
          rigChains.push({ bones, helper, target: null, displayVisible: true, shapeRig: true, owner: owner || null });
        }
        return rigChains.find(entry => entry.bones.includes(root))!;
      };
      const migrateRootToAnchor = (root: THREE.Bone, owner: THREE.Object3D) => {
        let anchor = root.parent;
        while (anchor && !anchor.userData.nexusRigAnchor) anchor = anchor.parent;
        if (anchor?.userData.nexusRigAnchor) {
          anchor.userData.rigOwnerId = String(owner.userData.editorId || '');
          anchor.userData.pendingShapeAttachment = true;
      controlDiag('manual-root:create', { anchorName: anchor.name, rootPending: true });
          scene.attach(anchor);
          root.userData.nexusRigSchema = 3;
          root.userData.rigOwnerId = String(owner.userData.editorId || '');
          root.userData.rigPendingAttachment = true;
          return anchor;
        }
        scene.updateMatrixWorld(true);
        const worldPosition = root.getWorldPosition(new THREE.Vector3());
        const worldQuaternion = root.getWorldQuaternion(new THREE.Quaternion());
        const nextAnchor = new THREE.Group();
        nextAnchor.name = 'Rig Anchor';
        nextAnchor.userData.nexusRigAnchor = true;
        nextAnchor.userData.rigOwnerId = String(owner.userData.editorId || '');
        owner.add(nextAnchor);
        owner.updateWorldMatrix(true, false);
        nextAnchor.position.copy(owner.worldToLocal(worldPosition.clone()));
        nextAnchor.quaternion.copy(owner.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQuaternion));
        nextAnchor.scale.set(1, 1, 1);
        root.parent?.remove(root);
        nextAnchor.add(root);
        root.position.set(0, 0, 0);
        root.quaternion.identity();
        root.scale.set(1, 1, 1);
        root.userData.nexusRigSchema = 3;
        root.userData.rigOwnerId = String(owner.userData.editorId || '');
        root.userData.rigPendingAttachment = true;
        nextAnchor.userData.pendingShapeAttachment = true;
        scene.attach(nextAnchor);
        scene.updateMatrixWorld(true);
        return nextAnchor;
      };

      if (mode === 'child') {
        if (!(selectedObject instanceof THREE.Bone)) {
          setStatus('Select the Root Bone or an existing Child Bone first');
          return false;
        }
        const root = resolveRoot(selectedObject);
        if (!root.userData.shapeRig || root.userData.rigRole !== 'root') {
          setStatus('Select a Root Bone from a Manual Shape Rig');
          return false;
        }
        const owner = resolveOwner(root);
        if (!owner) {
          setStatus('This Root Bone has no Shape owner · create a new Root Bone on the Shape');
          return false;
        }
        const chain = rigChains.find(entry => entry.bones.includes(root)) || makeHelper(root, owner);
        const child = new THREE.Bone();
        child.name = nextManualBoneName();
        let segmentLength = Number(selectedObject.userData.segmentLength) || Number(root.userData.segmentLength) || 0;
        if (!segmentLength) {
          owner.updateWorldMatrix(true, false);
          const bounds = new THREE.Box3().setFromObject(owner);
          const size = bounds.getSize(new THREE.Vector3());
          const scale = owner.getWorldScale(new THREE.Vector3());
          const worldLength = Math.max(size.y, size.x * 0.65, size.z * 0.65, 0.25) * 0.22;
          segmentLength = worldLength / Math.max(Math.abs(scale.y), 1e-6);
        }
        segmentLength = Math.max(segmentLength || 0.28, 0.12);
        child.position.set(0, segmentLength, 0);
        child.userData.segmentLength = segmentLength;
        child.userData.editorId = uid();
        child.userData.kind = 'Bone';
        child.userData.rigRole = 'deform';
        child.userData.locked = false;
        child.userData.shapeRig = true;
        child.userData.nexusRigSchema = 3;
        child.userData.rigOwnerId = String(owner.userData.editorId || '');
        selectedObject.add(child);
        ensureBoneJoint(selectedObject);
        ensureBoneJoint(child);
        if (!chain.bones.includes(child)) chain.bones.push(child);
        rebuildRigHelper(chain);
        chain.helper.visible = true;
        chain.displayVisible = true;
        selectable.push(child);
        syncItems();
        selectObject(child);
        setStatus(child.name + ' added · connected to ' + selectedObject.name);
        return child;
      }

      if (mode !== 'root') {
        setStatus('Select a Shape, then create its Root Bone first');
        return false;
      }
      let owner: THREE.Object3D | null = selectedObject || null;
      if (selectedObject instanceof THREE.Bone) {
        const oldRoot = resolveRoot(selectedObject);
        owner = resolveOwner(oldRoot);
      }
      if (!owner || owner instanceof THREE.Bone || owner instanceof THREE.Light || owner === scene) {
        setStatus('Select the Shape first, then create its Root Bone');
        return false;
      }

      if (!owner.userData.editorId) owner.userData.editorId = uid();
      const ownerId = String(owner.userData.editorId);
      let existingRoot: THREE.Bone | null = null;
      // Pending roots are detached by design, so owner.traverse() cannot find them.
      for (const candidate of selectable) {
        if (candidate instanceof THREE.Bone && candidate.userData.rigRole === 'root' &&
            candidate.userData.shapeRig && String(candidate.userData.rigOwnerId || '') === ownerId) {
          existingRoot = candidate;
          break;
        }
      }
      if (!existingRoot) owner.traverse(node => {
        if (!existingRoot && (node as THREE.Bone).isBone && node.userData.rigRole === 'root' && node.userData.shapeRig) existingRoot = node as THREE.Bone;
      });
      if (existingRoot) {
        const root = existingRoot as THREE.Bone;
        root.userData.nexusRigSchema = 3;
        root.userData.rigOwnerId = ownerId;
        let anchor: THREE.Object3D | null = root.parent;
        while (anchor && !anchor.userData.nexusRigAnchor) anchor = anchor.parent;
        if (!anchor) anchor = migrateRootToAnchor(root, owner);
        const attached = anchor.parent === owner && !anchor.userData.pendingShapeAttachment;
        if (attached) root.userData.rigPendingAttachment = false;
        else { anchor.userData.pendingShapeAttachment = true; root.userData.rigPendingAttachment = true; }
        const chain = makeHelper(root, attached ? owner : null);
        chain.owner = attached ? owner : null;
        chain.helper.updateMatrixWorld(true);
        syncItems();
        selectObject(owner);
        setStatus(attached ? 'Existing Root Bone found · Already attached' : 'Existing pending Root Bone found · Attach it to continue');
        return root;
      }

      scene.updateMatrixWorld(true);
      owner.updateWorldMatrix(true, false);
      const bounds = new THREE.Box3().setFromObject(owner);
      const center = new THREE.Vector3();
      if (!bounds.isEmpty()) bounds.getCenter(center);
      else owner.getWorldPosition(center);
      const size = bounds.isEmpty() ? new THREE.Vector3(1, 1, 1) : bounds.getSize(new THREE.Vector3());
      const ownerScale = owner.getWorldScale(new THREE.Vector3());
      const worldLength = Math.max(size.y, size.x * 0.65, size.z * 0.65, 0.25) * 0.22;
      const segmentLength = Math.max(worldLength / Math.max(Math.abs(ownerScale.y), 1e-6), 0.12);

      const anchor = new THREE.Group();
      anchor.name = 'Rig Anchor · Pending Attachment';
      anchor.userData.nexusRigAnchor = true;
      anchor.userData.rigOwnerId = ownerId;
      anchor.userData.pendingShapeAttachment = true;
      scene.add(anchor);
      anchor.position.copy(center);
      anchor.quaternion.identity();
      anchor.scale.set(1, 1, 1);

      const root = new THREE.Bone();
      root.name = 'Root Bone';
      root.userData.editorId = uid();
      root.userData.kind = 'Bone';
      root.userData.rigRole = 'root';
      root.userData.locked = true;
      root.userData.shapeRig = true;
      root.userData.nexusRigSchema = 3;
      root.userData.rigOwnerId = ownerId;
      root.userData.rigPendingAttachment = true;
      root.userData.segmentLength = segmentLength;
      root.position.set(0, 0, 0);
      anchor.add(root);
      ensureBoneJoint(root);
      const chain = makeHelper(root, null);
      chain.owner = null;
      chain.helper.updateMatrixWorld(true);
      selectable.push(root);
      syncItems();
      // Root creation must not steal TransformControls ownership from the Shape.
      // The Root remains selectable from the Scene Tree when the user needs it.
      selectObject(owner);
      setStatus('Root Bone created at Shape center · Not attached · Use Attach to Shape');
      return root;
    };
    const attachRootToShape = () => {
      const selectedObject = selectable.find(object => String(object.userData.editorId) === selectedRef.current);
      let root: THREE.Bone | undefined, owner: THREE.Object3D | undefined;
      if (selectedObject instanceof THREE.Bone && selectedObject.userData.rigRole === 'root') {
        root = selectedObject;
        owner = selectable.find(object => String(object.userData.editorId || '') === String(root!.userData.rigOwnerId || ''));
      } else if (selectedObject && !(selectedObject instanceof THREE.Bone) && !(selectedObject instanceof THREE.Light)) {
        owner = selectedObject;
        root = selectable.find(object => object instanceof THREE.Bone && object.userData.rigRole === 'root' &&
          String(object.userData.rigOwnerId || '') === String(owner!.userData.editorId || '')) as THREE.Bone | undefined;
      }
      if (!root || !owner) { setStatus('Select the Shape or its pending Root Bone first'); return false; }
      let anchor = root.parent; while (anchor && !anchor.userData.nexusRigAnchor) anchor = anchor.parent;
      if (!anchor || !anchor.userData.nexusRigAnchor) { setStatus('Root Bone anchor missing'); return false; }
      if (anchor.parent === owner && !anchor.userData.pendingShapeAttachment) { setStatus('Root Bone already attached'); return true; }
      scene.updateMatrixWorld(true); owner.attach(anchor); anchor.name = 'Rig Anchor';
      anchor.userData.pendingShapeAttachment = false;
      root.userData.rigPendingAttachment = false; root.userData.nexusRigSchema = 3;
      const chain = rigChains.find(entry => entry.bones.includes(root!));
      if (chain) { chain.owner = owner; rebuildRigHelper(chain); chain.helper.updateMatrixWorld(true); chain.helper.visible = chain.displayVisible !== false; }
      scene.updateMatrixWorld(true); syncItems(); selectObject(owner);
      setStatus('Root Bone attached · Bind Mesh remains a separate step'); return true;
    };
    const copySelectedBone = () => {
      const source = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!(source instanceof THREE.Bone)) { setStatus('Select a bone before copying'); return false; }
      const chain = rigChains.find(entry => entry.bones.includes(source));
      const cloneBranch = (original: THREE.Bone, parent: THREE.Object3D, rootCopy = false): THREE.Bone => {
        const clone = new THREE.Bone();
        clone.name = nextManualBoneName();
        clone.position.copy(original.position); clone.quaternion.copy(original.quaternion); clone.scale.copy(original.scale);
        if (rootCopy) {
          // A copied bone continues the selected chain instead of becoming a
          // disconnected sibling. Its local offset creates a visible bone segment.
          clone.position.set(0, 0.35, 0);
        }
        clone.userData = { ...original.userData, editorId: uid(), kind: 'Bone', locked: false, detached: false, controlHandle: false, copiedFrom: original.userData.editorId };
        parent.add(clone); ensureBoneJoint(clone); if (parent instanceof THREE.Bone) ensureBoneJoint(parent); selectable.push(clone);
        original.children.filter(child => child instanceof THREE.Bone).forEach(child => cloneBranch(child as THREE.Bone, clone));
        return clone;
      };
      const clone = cloneBranch(source, source, true);
      ensureBoneJoint(source);
      if (chain) { clone.traverse(node => { if ((node as THREE.Bone).isBone && !chain.bones.includes(node as THREE.Bone)) chain.bones.push(node as THREE.Bone); }); rebuildRigHelper(chain); }
      refreshRigVisuals(); syncItems(); selectObject(clone);
      setStatus(source.name + ' copied as ' + clone.name + ' with connected child hierarchy'); return true;
    };
    const setRigParentTarget = () => {
      const target = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!target) { setStatus('Select a parent bone or shape first'); return false; }
      rigAttachTarget = target; setStatus('Parent target set: ' + target.name + ' · select a child and Attach'); return true;
    };
    const attachSelectedToRigParent = () => {
      const child = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      const parent = rigAttachTarget;
      if (!child || !parent || child === parent || child.getObjectById(parent.id)) { setStatus('Set a valid parent target first; select the child and Attach'); return false; }
      const previous = child.parent || scene;
      scene.updateMatrixWorld(true); parent.attach(child); scene.updateMatrixWorld(true);
      if (child instanceof THREE.Bone) child.userData.detached = false;
      syncItems(); selectObject(child); refreshRigVisuals();
      const affectedChain = child instanceof THREE.Bone ? rigChains.find(entry => entry.bones.includes(child)) : null;
      if (affectedChain) rebuildRigHelper(affectedChain);
      recordSceneAction({ label: 'Attach ' + child.name, undo: () => { scene.updateMatrixWorld(true); previous.attach(child); syncItems(); selectObject(child); refreshRigVisuals(); if (affectedChain) rebuildRigHelper(affectedChain); }, redo: () => { scene.updateMatrixWorld(true); parent.attach(child); syncItems(); selectObject(child); refreshRigVisuals(); if (affectedChain) rebuildRigHelper(affectedChain); } });
      setStatus(child.name + ' attached under ' + parent.name + ' · world transform preserved'); return true;
    };
    const detachSelectedRigObject = () => {
      const child = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!child || !child.parent || child.parent === scene) { setStatus('Select an attached bone or object first'); return false; }
      const previous = child.parent;
      const nextParent = previous instanceof THREE.Bone ? (previous.parent || scene) : scene;
      scene.updateMatrixWorld(true); nextParent.attach(child); scene.updateMatrixWorld(true);
      if (child instanceof THREE.Bone) child.userData.detached = true;
      syncItems(); selectObject(child); refreshRigVisuals();
      const affectedChain = child instanceof THREE.Bone ? rigChains.find(entry => entry.bones.includes(child)) : null;
      if (affectedChain) rebuildRigHelper(affectedChain);
      recordSceneAction({ label: 'Detach ' + child.name, undo: () => { scene.updateMatrixWorld(true); previous.attach(child); syncItems(); selectObject(child); refreshRigVisuals(); if (affectedChain) rebuildRigHelper(affectedChain); }, redo: () => { scene.updateMatrixWorld(true); nextParent.attach(child); syncItems(); selectObject(child); refreshRigVisuals(); if (affectedChain) rebuildRigHelper(affectedChain); } });
      setStatus(child.name + ' detached · world transform preserved'); return true;
    };
    const toggleSelectedControlLock = () => {
      const control = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!control?.userData.rigControlMarker) { setStatus('Select a Control Handle first'); return false; }
      control.userData.controlLocked = !control.userData.controlLocked;
      ((control as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(control.userData.controlLocked ? '#ffb52e' : '#00d9ff');
      selectObject(control); setStatus(control.name + (control.userData.controlLocked ? ' locked' : ' unlocked')); return true;
    };
    const refreshRigVisuals = () => {
      rigChains.forEach(chain => {
        chain.bones.forEach(bone => {
          ensureBoneJoint(bone);
          const visual = bone.children.find(child => child.userData.nexusJointVisual);
          if (visual) visual.visible = chain.displayVisible !== false;
        });
        chain.helper.visible = chain.shapeRig ? chain.displayVisible !== false : false;
        styleSkeletonHelper(chain.helper, chain.bones);
        const colors = chain.helper.geometry.getAttribute('color');
        if (colors) colors.needsUpdate = true;
        chain.helper.updateMatrixWorld(true);
      });
    };
    const toggleSelectedBoneControlHandle = () => {
      const bone = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!(bone instanceof THREE.Bone)) { setStatus('Select a bone first to set a Control Handle'); return false; }
      const existing = bone.children.find(child => child.userData.rigControlMarker);
      if (existing) {
        bone.remove(existing);
        const markerIndex = selectable.indexOf(existing); if (markerIndex >= 0) selectable.splice(markerIndex, 1);
        (existing as THREE.Mesh).geometry?.dispose();
        const material = (existing as THREE.Mesh).material;
        if (Array.isArray(material)) material.forEach(m => m.dispose()); else (material as THREE.Material)?.dispose();
        bone.userData.controlHandle = false;
        setStatus('Control Handle removed from ' + bone.name);
      } else {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), new THREE.MeshBasicMaterial({ color: '#00d9ff', depthTest: false, transparent: true, opacity: 0.98 }));
        const childBone = bone.children.find(child => child instanceof THREE.Bone) as THREE.Bone | undefined;
        if (childBone) marker.position.copy(childBone.position);
        marker.name = bone.name + ' Control Handle'; marker.userData.rigControlMarker = true; marker.userData.editorId = uid(); marker.userData.kind = 'Control Handle'; marker.userData.controlLocked = false; marker.renderOrder = 20;
        bone.add(marker); selectable.push(marker); bone.userData.controlHandle = true;
        setStatus('Control Handle enabled · orange controller gizmo on ' + bone.name);
      }
      refreshRigVisuals(); syncItems(); selectObject(bone); return true;
    };
    const toggleSelectedBoneLock = () => {
      const bone = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!(bone instanceof THREE.Bone)) { setStatus('Select a bone first to Lock / Unlock'); return false; }
      bone.userData.locked = !bone.userData.locked; refreshRigVisuals(); selectObject(bone);
      setStatus(bone.name + (bone.userData.locked ? ' locked · gizmo disabled' : ' unlocked · gizmo enabled')); return true;
    };
    const createManualRig = () => {
      const rig = new THREE.Group();
      rig.name = 'Humanoid Rig ' + (rigChains.length + 1);
      rig.userData.editorId = uid();
      rig.userData.kind = 'Rig';
      const selectedObject = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (selectedObject) rig.position.copy(selectedObject.getWorldPosition(new THREE.Vector3()));
      const makeBone = (name: string, parent: THREE.Bone | null, position: [number, number, number]) => {
        const bone = new THREE.Bone(); bone.name = name; bone.position.set(...position);
        bone.userData.editorId = uid(); bone.userData.kind = 'Bone';
        if (parent) parent.add(bone); else rig.add(bone); ensureBoneJoint(bone); if (parent) ensureBoneJoint(parent); return bone;
      };
      const root = makeBone('Root', null, [0,0,0]);
      const hips = makeBone('Hips', root, [0,0.9,0]);
      const spine = makeBone('Spine', hips, [0,0.28,0]);
      const chest = makeBone('Chest', spine, [0,0.38,0]);
      const neck = makeBone('Neck', chest, [0,0.34,0]);
      makeBone('Head', neck, [0,0.22,0]);
      for (const side of ['.L','.R']) {
        const sign = side === '.L' ? -1 : 1;
        const shoulder = makeBone('Shoulder'+side, chest, [sign*0.2,0.22,0]);
        const upper = makeBone('UpperArm'+side, shoulder, [sign*0.38,-0.04,0]);
        const forearm = makeBone('Forearm'+side, upper, [sign*0.42,-0.02,0]);
        makeBone('Hand'+side, forearm, [sign*0.34,0,0]);
        const thigh = makeBone('Thigh'+side, hips, [sign*0.14,-0.02,0]);
        const shin = makeBone('Shin'+side, thigh, [0,-0.48,0]);
        makeBone('Foot'+side, shin, [0,-0.46,0.12]);
      }
      const bones: THREE.Bone[] = []; rig.traverse(node => { if ((node as THREE.Bone).isBone) bones.push(node as THREE.Bone); });
      scene.add(rig);
      const helper = new THREE.SkeletonHelper(root); helper.name = rig.name + ' Skeleton';
      styleSkeletonHelper(helper, bones); scene.add(helper);
      selectable.push(rig, ...bones); rigChains.push({ bones, helper, target: null });
      syncItems(); selectObject(root); setStatus('Humanoid bone hierarchy created · Mirror X ready'); return rig;
    };
    const mirrorSelectedBone = () => {
      if (!mirrorEnabledRef.current) { setStatus('Enable Mirror X before mirroring bones'); return; }
      const source = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!(source instanceof THREE.Bone) || !source.parent) { setStatus('Select a bone in Scene Tree first'); return; }
      const targetName = mirrorBoneName(source.name);
      const mirrorTransform = (from: THREE.Bone, to: THREE.Bone) => {
        to.position.set(-from.position.x,from.position.y,from.position.z);
        const e = new THREE.Euler().setFromQuaternion(from.quaternion,'XYZ'); to.rotation.set(e.x,-e.y,-e.z,'XYZ');
        to.scale.copy(from.scale);
      };
      const cloneTree = (original: THREE.Bone, parent: THREE.Object3D): THREE.Bone => {
        const clone = new THREE.Bone(); clone.name = mirrorBoneName(original.name); mirrorTransform(original,clone);
        clone.userData = { ...original.userData, editorId: uid(), kind: 'Bone', mirroredFrom: original.userData.editorId };
        parent.add(clone); ensureBoneJoint(clone); if (parent instanceof THREE.Bone) ensureBoneJoint(parent); selectable.push(clone);
        original.children.filter(child => child instanceof THREE.Bone).forEach(child => cloneTree(child as THREE.Bone,clone));
        return clone;
      };
      const syncTree = (original: THREE.Bone, mirrored: THREE.Bone) => {
        mirrorTransform(original,mirrored);
        original.children.filter(child => child instanceof THREE.Bone).forEach(child => {
          const childBone=child as THREE.Bone; const paired=mirrored.children.find(candidate => candidate instanceof THREE.Bone && candidate.name === mirrorBoneName(childBone.name)) as THREE.Bone | undefined;
          if (paired) syncTree(childBone,paired); else cloneTree(childBone,mirrored);
        });
      };
      const chain = [...rigChains].reverse().find(entry => entry.bones.includes(source));
      const mirroredParent = chain?.bones.find(bone => bone.name === mirrorBoneName(source.parent!.name));
      const targetParent = mirroredParent || source.parent;
      let mirrored = targetParent.children.find(child => child instanceof THREE.Bone && child.name === targetName) as THREE.Bone | undefined;
      if (mirrored) syncTree(source,mirrored); else mirrored = cloneTree(source,targetParent);
      if (chain) { mirrored.traverse(node => { if ((node as THREE.Bone).isBone && !chain.bones.includes(node as THREE.Bone)) chain.bones.push(node as THREE.Bone); }); rebuildRigHelper(chain); }
      syncItems(); selectObject(mirrored); setStatus('Mirror X synchronized · ' + source.name + ' ↔ ' + mirrored.name);
    };
    const createPoleTarget = () => {
      const selectedBone = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      const chain = [...rigChains].reverse().find(entry => selectedBone instanceof THREE.Bone && entry.bones.includes(selectedBone)) || [...rigChains].reverse().find(entry => entry.target);
      if (!chain || chain.bones.length < 3) { setStatus('Select a rig with at least three connected bones first'); return null; }
      const endId = selectedBone instanceof THREE.Bone ? selectedBone.userData.editorId : chain.target?.userData.ikEndBoneId;
      const endBone = chain.bones.find(bone => String(bone.userData.editorId) === String(endId)) || chain.bones[chain.bones.length-1];
      const path: THREE.Bone[] = []; let cursor: THREE.Object3D | null = endBone;
      while (cursor && path.length < 32) { if (cursor instanceof THREE.Bone && chain.bones.includes(cursor)) path.push(cursor); cursor = cursor.parent; }
      const middle = path[Math.floor(path.length/2)] || endBone;
      const target = new THREE.Mesh(new THREE.SphereGeometry(0.11,14,10),new THREE.MeshBasicMaterial({color:0xc58cff,wireframe:true}));
      target.name = 'IK Pole Target'; target.userData.editorId = uid(); target.userData.kind = 'IK Pole';
      target.userData.rigRootBoneId = chain.bones[0]?.userData.editorId || null;
      target.position.copy(middle.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0.8,0,0.8));
      scene.add(target); selectable.push(target); chain.pole = target; syncItems(); selectObject(target);
      setStatus('Pole target created · drag it to guide the limb bend plane'); return target;
    };
    const deleteSelectedBone = () => {
      const bone = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!(bone instanceof THREE.Bone) || !bone.parent) { setStatus('Select a bone to delete'); return false; }
      if (!(bone.parent instanceof THREE.Bone)) { setStatus('Root bones are protected to preserve the rig hierarchy'); return false; }
      const parent = bone.parent;
      const childBones = [...bone.children].filter(child => child instanceof THREE.Bone) as THREE.Bone[];
      const originalSelectableIndex = selectable.indexOf(bone);
      const chainSnapshots = rigChains.filter(chain => chain.bones.includes(bone)).map(chain => ({
        chain,
        bones: [...chain.bones],
      }));
      const applyDelete = () => {
        scene.updateMatrixWorld(true);
        childBones.forEach(child => parent.attach(child));
        parent.remove(bone);
        const index = selectable.indexOf(bone);
        if (index >= 0) selectable.splice(index, 1);
        chainSnapshots.forEach(({ chain, bones }) => {
          chain.bones = bones.filter(entry => entry !== bone);
          rebuildRigHelper(chain);
        });
        syncItems();
        selectObject(parent);
        setStatus('Bone deleted · child bones preserved · Undo available');
      };
      const restoreDelete = () => {
        scene.updateMatrixWorld(true);
        parent.add(bone);
        childBones.forEach(child => bone.attach(child));
        if (!selectable.includes(bone)) {
          selectable.splice(Math.max(0, Math.min(originalSelectableIndex, selectable.length)), 0, bone);
        }
        chainSnapshots.forEach(({ chain, bones }) => {
          chain.bones = [...bones];
          rebuildRigHelper(chain);
        });
        scene.updateMatrixWorld(true);
        syncItems();
        selectObject(bone);
        setStatus('Bone restored · skeleton hierarchy and helper rebuilt');
      };
      applyDelete();
      recordSceneAction({
        label: 'Delete Bone ' + bone.name,
        undo: restoreDelete,
        redo: applyDelete,
      });
      return true;
    };
    transform.addEventListener('objectChange', () => {
      if (!mirrorEnabledRef.current) return;
      const source = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!(source instanceof THREE.Bone) || !source.parent || !/\.(L|R)$/i.test(source.name)) return;
      const chain = [...rigChains].reverse().find(entry => entry.bones.includes(source));
      const pairedParent = chain?.bones.find(bone => bone.name === mirrorBoneName(source.parent!.name));
      const targetParent = pairedParent || source.parent;
      const paired = targetParent.children.find(child => child instanceof THREE.Bone && child.name === mirrorBoneName(source.name)) as THREE.Bone | undefined;
      if (!paired) return;
      paired.position.set(-source.position.x,source.position.y,source.position.z);
      const e = new THREE.Euler().setFromQuaternion(source.quaternion,'XYZ'); paired.rotation.set(e.x,-e.y,-e.z,'XYZ');
      paired.scale.copy(source.scale); chain?.helper.updateMatrixWorld(true);
    });
    const autoRigSelectedMesh = () => {
      const selectedObject = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      let mesh: THREE.Mesh | null = null;
      if (selectedObject instanceof THREE.Mesh && !(selectedObject as any).isSkinnedMesh) mesh = selectedObject;
      else if (selectedObject) selectedObject.traverse((node: any) => { if (!mesh && node.isMesh && !node.isSkinnedMesh) mesh = node as THREE.Mesh; });
      if (!mesh || !mesh.geometry?.getAttribute('position')) { setStatus('Select an unrigged character mesh first'); return false; }
      const source = mesh as THREE.Mesh;
      const geometry = source.geometry.clone();
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (!bounds) { setStatus('Mesh bounds are unavailable'); return false; }
      const size = new THREE.Vector3(); bounds.getSize(size);
      if (size.y < Math.max(size.x, size.z) * 1.15 || size.y < 0.05) { setStatus('Auto Rig expects an upright humanoid mesh with height greater than its width'); geometry.dispose(); return false; }
      const center = new THREE.Vector3(); bounds.getCenter(center);
      const width = Math.max(size.x, size.z, 0.1);
      const y = (factor: number) => bounds.min.y + size.y * factor;
      const point = (x: number, yf: number, z = center.z) => new THREE.Vector3(center.x + x * width, y(yf), z);
      const parent = source.parent || scene;
      const rigGroup = new THREE.Group(); rigGroup.name = 'Auto Rig · ' + source.name;
      rigGroup.userData.editorId = uid(); rigGroup.userData.kind = 'Rig';
      rigGroup.position.copy(source.position); rigGroup.quaternion.copy(source.quaternion); rigGroup.scale.copy(source.scale);
      const bones: THREE.Bone[] = [];
      const points: THREE.Vector3[] = [];
      const addBone = (name: string, parentBone: THREE.Bone | null, absolutePoint: THREE.Vector3) => {
        const bone = new THREE.Bone(); bone.name = name; bone.position.copy(parentBone ? absolutePoint.clone().sub(points[bones.indexOf(parentBone)]) : absolutePoint);
        bone.userData.editorId = uid(); bone.userData.kind = 'Bone';
        if (parentBone) parentBone.add(bone); else rigGroup.add(bone);
        ensureBoneJoint(bone); bones.push(bone); points.push(absolutePoint.clone()); return bone;
      };
      const root = addBone('Root', null, new THREE.Vector3(center.x,bounds.min.y,center.z));
      const hips = addBone('Hips', root, point(0,0.52));
      const spine = addBone('Spine', hips, point(0,0.65));
      const chest = addBone('Chest', spine, point(0,0.78));
      const neck = addBone('Neck', chest, point(0,0.89));
      addBone('Head', neck, point(0,0.96));
      for (const side of ['.L','.R']) {
        const sign = side === '.L' ? -1 : 1;
        const shoulder = addBone('Shoulder'+side, chest, point(sign*0.18,0.79));
        const upper = addBone('UpperArm'+side, shoulder, point(sign*0.34,0.68));
        const forearm = addBone('Forearm'+side, upper, point(sign*0.46,0.58));
        addBone('Hand'+side, forearm, point(sign*0.52,0.55));
        const thigh = addBone('Thigh'+side, hips, point(sign*0.11,0.48));
        const shin = addBone('Shin'+side, thigh, point(sign*0.11,0.23));
        addBone('Foot'+side, shin, point(sign*0.11,0.06,center.z + size.z*0.12));
      }
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const skinIndices = new Uint16Array(position.count*4);
      const skinWeights = new Float32Array(position.count*4);
      const candidates = points.map((p,index) => ({p,index}));
      const vertex = new THREE.Vector3();
      for (let i=0;i<position.count;i++) {
        vertex.fromBufferAttribute(position,i);
        const nearest = candidates.map(item => ({index:item.index,d:item.p.distanceToSquared(vertex)})).sort((a,b)=>a.d-b.d).slice(0,4);
        let total = 0; const weights = nearest.map(item => 1/Math.max(item.d,1e-5));
        total = weights.reduce((sum,value)=>sum+value,0);
        nearest.forEach((item,j)=>{ skinIndices[i*4+j]=item.index; skinWeights[i*4+j]=weights[j]/total; });
      }
      geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));
      geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeights,4));
      const skinned = new THREE.SkinnedMesh(geometry, source.material);
      skinned.name = source.name; skinned.userData = { ...source.userData, kind:'SkinnedMesh', autoRigged:true };
      skinned.castShadow = source.castShadow; skinned.receiveShadow = source.receiveShadow;
      skinned.position.set(0,0,0); skinned.quaternion.identity(); skinned.scale.set(1,1,1);
      parent.add(rigGroup); rigGroup.add(skinned);
      rigGroup.updateMatrixWorld(true);
      const skeleton = new THREE.Skeleton(bones); skeleton.calculateInverses(); skinned.bind(skeleton);
      parent.remove(source);
      const oldIndex = selectable.indexOf(source); if (oldIndex>=0) selectable.splice(oldIndex,1);
      if (!selectable.includes(rigGroup)) selectable.push(rigGroup);
      if (!selectable.includes(skinned)) selectable.push(skinned);
      bones.forEach(bone=>selectable.push(bone));
      const helper = new THREE.SkeletonHelper(root); helper.name = rigGroup.name + ' Skeleton'; styleSkeletonHelper(helper, bones);
      (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff); scene.add(helper);
      rigChains.push({bones,helper,target:null});
      syncItems(); selectObject(skinned);
      setStatus('Auto Rig created · 18 bones with heuristic skin weights. Inspect deformation before production use.');
      return true;
    };
    const bindSelectedMeshToRig = () => {
      const selectedObject = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      let source: THREE.Mesh | null = null;
      if (selectedObject instanceof THREE.Mesh && !(selectedObject as any).isSkinnedMesh) source = selectedObject;
      else if (selectedObject) selectedObject.traverse((node: any) => { if (!source && node.isMesh && !node.isSkinnedMesh) source = node as THREE.Mesh; });
      if (!source || !source.geometry?.getAttribute('position')) { setStatus('Select an unrigged mesh in Scene Tree before attaching it to the skeleton'); return false; }
      const mesh = source as THREE.Mesh;
      // Only bind to the selected Shape's own attached Manual Shape Rig.
      // Do not silently select the last unrelated skeleton in the scene.
      const selectedOwnerId = String(selectedObject?.userData.editorId || '');
      const chain = [...rigChains].reverse().find(entry =>
        entry.shapeRig === true && entry.bones.length > 1 &&
        String(entry.bones[0]?.userData.rigOwnerId || '') === selectedOwnerId &&
        entry.owner === selectedObject
      );
      if (!chain) { setStatus('No attached Manual Root Bone with Child Bones found for this selected Shape'); return false; }
      if (mesh.geometry.getAttribute('skinIndex')) { setStatus('This mesh already has skinning data. Use its existing skeleton instead of binding twice'); return false; }
      mesh.updateWorldMatrix(true, false); scene.updateMatrixWorld(true);
      const geometry = mesh.geometry.clone();
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const skinIndices = new Uint16Array(position.count * 4);
      const skinWeights = new Float32Array(position.count * 4);
      const boneWorld = chain.bones.map(bone => bone.getWorldPosition(new THREE.Vector3()));
      const vertexWorld = new THREE.Vector3();
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
        vertexWorld.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
        const nearest = boneWorld.map((point, index) => ({ index, distance: point.distanceToSquared(vertexWorld) }))
          .sort((a, b) => a.distance - b.distance).slice(0, Math.min(4, chain.bones.length));
        const raw = nearest.map(entry => 1 / Math.max(entry.distance, 1e-6));
        const total = raw.reduce((sum, value) => sum + value, 0) || 1;
        nearest.forEach((entry, slot) => { skinIndices[vertexIndex * 4 + slot] = entry.index; skinWeights[vertexIndex * 4 + slot] = raw[slot] / total; });
      }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
      const skinned = new THREE.SkinnedMesh(geometry, mesh.material);
      skinned.name = mesh.name;
      skinned.userData = { ...mesh.userData, kind: 'SkinnedMesh', manuallyRigged: true, editorId: mesh.userData.editorId || uid() };
      skinned.castShadow = mesh.castShadow; skinned.receiveShadow = mesh.receiveShadow;
      skinned.position.copy(mesh.position); skinned.quaternion.copy(mesh.quaternion); skinned.scale.copy(mesh.scale);

      // Put the deforming mesh and its complete bone hierarchy under one neutral
      // rig container. This also rescues bones previously attached beneath the
      // original mesh, which would otherwise be deleted with that mesh below.
      const rigRoot = chain.bones.find(bone => !chain.bones.some(other => other !== bone && other.getObjectById(bone.id))) || chain.bones[0];
      if (!rigRoot) { geometry.dispose(); setStatus('Skeleton root could not be found'); return false; }
      const rigGroup = new THREE.Group();
      rigGroup.name = 'Rig · ' + mesh.name;
      rigGroup.userData.editorId = uid();
      rigGroup.userData.kind = 'Rig';
      scene.add(rigGroup);
      scene.updateMatrixWorld(true);
      rigGroup.attach(rigRoot);

      const originalParent = mesh.parent || scene;
      originalParent.add(skinned);
      skinned.updateWorldMatrix(true, false);
      rigGroup.attach(skinned);
      scene.updateMatrixWorld(true);

      const skeleton = new THREE.Skeleton(chain.bones);
      skeleton.calculateInverses();
      skinned.bind(skeleton, skinned.matrixWorld.clone());

      originalParent.remove(mesh);
      const oldIndex = selectable.indexOf(mesh); if (oldIndex >= 0) selectable.splice(oldIndex, 1);
      if (!selectable.includes(rigGroup)) selectable.push(rigGroup);
      if (!selectable.includes(skinned)) selectable.push(skinned);
      chain.bones.forEach(bone => { if (!selectable.includes(bone)) selectable.push(bone); });
      rebuildRigHelper(chain);
      syncItems(); selectObject(skinned);
      setStatus('Bound successfully · mesh and skeleton now share a rig container. Move a bone to test deformation.');
      return true;
    };
    const getSelectedSkinnedMesh = (): THREE.SkinnedMesh | null => {
      const selectedObject = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (selectedObject instanceof THREE.SkinnedMesh) return selectedObject;
      let found: THREE.SkinnedMesh | null = null;
      selectedObject?.traverse((node: any) => { if (!found && node.isSkinnedMesh) found = node as THREE.SkinnedMesh; });
      return found;
    };
    const normalizeSelectedSkinWeights = () => {
      const mesh = getSelectedSkinnedMesh();
      const weights = mesh?.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (!mesh || !weights || weights.itemSize < 4) { setStatus('Select a skinned character mesh with skin weights'); return false; }
      for (let i = 0; i < weights.count; i++) {
        const values = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
        const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
        if (total <= 1e-8) weights.setXYZW(i, 1, 0, 0, 0);
        else weights.setXYZW(i, Math.max(0, values[0]) / total, Math.max(0, values[1]) / total, Math.max(0, values[2]) / total, Math.max(0, values[3]) / total);
      }
      weights.needsUpdate = true; mesh.geometry.computeBoundingSphere();
      setStatus('Skin weights normalized across all vertices'); return true;
    };
    const smoothSelectedSkinWeights = () => {
      const mesh = getSelectedSkinnedMesh();
      const geometry = mesh?.geometry;
      const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
      const weights = geometry?.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (!mesh || !geometry || !position || !weights || weights.itemSize < 4) { setStatus('Select a skinned character mesh with skin weights'); return false; }
      const neighbors: Set<number>[] = Array.from({ length: position.count }, () => new Set<number>());
      const index = geometry.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
        if (a >= position.count || b >= position.count || c >= position.count) continue;
        neighbors[a].add(b); neighbors[a].add(c); neighbors[b].add(a); neighbors[b].add(c); neighbors[c].add(a); neighbors[c].add(b);
      }
      const source = new Float32Array(position.count * 4);
      for (let i = 0; i < position.count; i++) { source[i*4] = weights.getX(i); source[i*4+1] = weights.getY(i); source[i*4+2] = weights.getZ(i); source[i*4+3] = weights.getW(i); }
      for (let i = 0; i < position.count; i++) {
        const adjacent = [...neighbors[i]];
        if (!adjacent.length) continue;
        const next = [0,0,0,0];
        for (const neighbor of adjacent) for (let slot = 0; slot < 4; slot++) next[slot] += source[neighbor*4+slot] / adjacent.length;
        let total = 0;
        for (let slot = 0; slot < 4; slot++) { next[slot] = Math.max(0, source[i*4+slot] * 0.5 + next[slot] * 0.5); total += next[slot]; }
        if (total > 1e-8) weights.setXYZW(i, next[0]/total, next[1]/total, next[2]/total, next[3]/total);
      }
      weights.needsUpdate = true; geometry.computeBoundingSphere();
      setStatus('Skin weights smoothed once across connected mesh vertices'); return true;
    };
    const detectRiggedMeshes = (rootObject?: THREE.Object3D) => {
      const root = rootObject || selectable.find(o => String(o.userData.editorId) === selectedRef.current) || scene;
      let found = 0;
      root.traverse((node: any) => {
        if (!node.isSkinnedMesh || !node.skeleton) return;
        const bones = node.skeleton.bones as THREE.Bone[];
        if (rigChains.some(entry => entry.bones[0] && bones.includes(entry.bones[0]))) return;
        const helper = new THREE.SkeletonHelper(bones[0]); helper.name = (node.name || 'Character') + ' Skeleton'; styleSkeletonHelper(helper, bones);
        (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff); scene.add(helper);
        bones.forEach(bone => { if (!bone.userData.editorId) bone.userData.editorId = uid(); bone.userData.kind = 'Bone'; ensureBoneJoint(bone); if (!selectable.includes(bone)) selectable.push(bone); });
        rigChains.push({ bones: [...bones], helper, target: null }); found += 1;
      });
      syncItems();
      setStatus(found ? 'Detected ' + found + ' existing skinned rig(s)' : 'No existing SkinnedMesh skeleton found. Import a rigged humanoid GLB/GLTF for automatic skeleton detection.');
      return found;
    };
    const createIKTarget = () => {
      const target = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb45e, wireframe: true }));
      target.name = 'IK Target Handle';
      target.position.set(1.4, 2.1, 0.5);
      target.userData.editorId = uid();
      target.userData.kind = 'IK Target';
      scene.add(target);
      selectable.push(target);
      const selectedBone = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (selectedBone instanceof THREE.Bone) target.position.copy(selectedBone.getWorldPosition(new THREE.Vector3()));
      const activeChain = [...rigChains].reverse().find(chain => selectedBone instanceof THREE.Bone && chain.bones.includes(selectedBone)) || rigChains[rigChains.length - 1];
      if (!activeChain) { scene.remove(target); selectable.splice(selectable.indexOf(target), 1); setStatus('Create or detect a rig before adding an IK target'); return null; }
      activeChain.target = target;
      if (selectedBone instanceof THREE.Bone) target.userData.ikEndBoneId = selectedBone.userData.editorId;
      target.userData.rigRootBoneId = activeChain.bones[0]?.userData.editorId || null;
      syncItems();
      selectObject(target);
      setStatus('IK target handle created. Move it with the viewport gizmo, then Solve IK.');
      return target;
    };
    const solveIK = (chainLength = 3) => {
      const selectedHandle = selectable.find(o => String(o.userData.editorId) === selectedRef.current && (o.userData.kind === 'IK Target' || o.userData.kind === 'IK Pole'));
      const chain = selectedHandle ? rigChains.find(entry => entry.target === selectedHandle || entry.pole === selectedHandle) : [...rigChains].reverse().find(entry => entry.target);
      if (!chain || !chain.target) { setStatus('Create a rig and an IK target first'); return; }
      const endBone = chain.bones.find(bone => String(bone.userData.editorId) === String(chain.target?.userData.ikEndBoneId)) || chain.bones[chain.bones.length-1];
      const path: THREE.Bone[] = [];
      let cursor: THREE.Object3D | null = endBone;
      while (cursor && path.length < 32) { if (cursor instanceof THREE.Bone && chain.bones.includes(cursor)) path.push(cursor); cursor = cursor.parent; }
      const bones = path.reverse().slice(-Math.max(1,Math.min(chainLength+1,path.length)));
      if (bones.length < 2) { setStatus('Select a limb bone before creating its IK target'); return; }
      const targetPosition = chain.target.getWorldPosition(new THREE.Vector3());
      const clampJoint = (bone: THREE.Bone) => {
        const limit = THREE.MathUtils.degToRad(Number(bone.userData.jointLimitDegrees ?? jointLimitDegreesRef.current));
        const euler = new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');
        euler.x = THREE.MathUtils.clamp(euler.x,-limit,limit);
        euler.y = THREE.MathUtils.clamp(euler.y,-limit,limit);
        euler.z = THREE.MathUtils.clamp(euler.z,-limit,limit);
        bone.quaternion.setFromEuler(euler); bone.updateMatrixWorld(true);
      };
      if (ikSolverRef.current === 'CCD') {
        for (let iteration=0;iteration<16;iteration++) {
          for (let i=bones.length-2;i>=0;i--) {
            scene.updateMatrixWorld(true); const bone=bones[i];
            const origin=bone.getWorldPosition(new THREE.Vector3());
            const end=endBone.getWorldPosition(new THREE.Vector3());
            const from=end.sub(origin); const to=targetPosition.clone().sub(origin);
            if (from.lengthSq()<1e-8 || to.lengthSq()<1e-8) continue;
            const delta=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
            const desiredWorld=bone.getWorldQuaternion(new THREE.Quaternion()); desiredWorld.premultiply(delta);
            if (bone.parent) bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredWorld)); else bone.quaternion.copy(desiredWorld);
            clampJoint(bone);
          }
        }
      } else {
        scene.updateMatrixWorld(true);
        const positions=bones.map(bone=>bone.getWorldPosition(new THREE.Vector3()));
        const lengths=positions.slice(0,-1).map((point,index)=>point.distanceTo(positions[index+1]));
        const rootPosition=positions[0].clone();
        const totalLength=lengths.reduce((sum,value)=>sum+value,0);
        if (rootPosition.distanceTo(targetPosition)>=totalLength) {
          const direction=targetPosition.clone().sub(rootPosition).normalize();
          for (let i=1;i<positions.length;i++) positions[i]=positions[i-1].clone().addScaledVector(direction,lengths[i-1]);
        } else {
          for (let iteration=0;iteration<20;iteration++) {
            positions[positions.length-1]=targetPosition.clone();
            for (let i=positions.length-2;i>=0;i--) { const direction=positions[i].clone().sub(positions[i+1]).normalize(); positions[i]=positions[i+1].clone().addScaledVector(direction,lengths[i]); }
            positions[0]=rootPosition.clone();
            for (let i=0;i<positions.length-1;i++) { const direction=positions[i+1].clone().sub(positions[i]).normalize(); positions[i+1]=positions[i].clone().addScaledVector(direction,lengths[i]); }
          }
        }
        for (let i=0;i<bones.length-1;i++) {
          scene.updateMatrixWorld(true); const bone=bones[i];
          const origin=bone.getWorldPosition(new THREE.Vector3());
          const currentChild=bones[i+1].getWorldPosition(new THREE.Vector3());
          const currentDirection=currentChild.sub(origin); const desiredDirection=positions[i+1].clone().sub(positions[i]);
          if (currentDirection.lengthSq()<1e-8 || desiredDirection.lengthSq()<1e-8) continue;
          const delta=new THREE.Quaternion().setFromUnitVectors(currentDirection.normalize(),desiredDirection.normalize());
          const desiredWorld=bone.getWorldQuaternion(new THREE.Quaternion()); desiredWorld.premultiply(delta);
          if (bone.parent) bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredWorld)); else bone.quaternion.copy(desiredWorld);
          clampJoint(bone);
        }
      }
      if (chain.pole && bones.length >= 3) {
        scene.updateMatrixWorld(true);
        const start = bones[0].getWorldPosition(new THREE.Vector3());
        const end = endBone.getWorldPosition(new THREE.Vector3());
        const axis = end.clone().sub(start).normalize();
        const middle = bones[1].getWorldPosition(new THREE.Vector3()).sub(start);
        const pole = chain.pole.getWorldPosition(new THREE.Vector3()).sub(start);
        middle.addScaledVector(axis,-middle.dot(axis)); pole.addScaledVector(axis,-pole.dot(axis));
        if (middle.lengthSq()>1e-8 && pole.lengthSq()>1e-8) {
          const angle = Math.atan2(axis.dot(middle.clone().cross(pole)),middle.dot(pole));
          const rootBone = bones[0]; const desired = rootBone.getWorldQuaternion(new THREE.Quaternion());
          desired.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,angle));
          if (rootBone.parent) rootBone.quaternion.copy(rootBone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
          else rootBone.quaternion.copy(desired);
        }
      }
      chain.helper.updateMatrixWorld(true); syncItems(); setStatus(ikSolverRef.current + ' IK + pole constraint solved · ' + bones.length + ' joints');
    };
    const captureRigStateFor = (obj: THREE.Object3D) => {
      const removedNodes = new Set<THREE.Object3D>();
      obj.traverse(node => removedNodes.add(node));
      return rigChains.filter(chain =>
        chain.bones.some(bone => removedNodes.has(bone)) || Boolean(chain.owner && removedNodes.has(chain.owner))
      ).map(chain => ({
        chain,
        bones: [...chain.bones],
        target: chain.target || null,
        pole: chain.pole || null,
        owner: chain.owner || null,
        shapeRig: Boolean(chain.shapeRig),
        displayVisible: chain.displayVisible,
      }));
    };
    const restoreRigState = (snapshots: ReturnType<typeof captureRigStateFor>) => {
      snapshots.forEach(state => {
        const chain = state.chain;
        if (!rigChains.includes(chain)) rigChains.push(chain);
        chain.bones = [...state.bones];
        chain.target = state.target;
        chain.pole = state.pole;
        chain.owner = state.owner;
        chain.shapeRig = state.shapeRig;
        chain.displayVisible = state.displayVisible;
        [chain.target, chain.pole].forEach(handle => {
          if (!handle) return;
          if (handle.parent !== scene) scene.add(handle);
          if (!selectable.includes(handle)) selectable.push(handle);
        });
        if (chain.bones.length) {
          rebuildRigHelper(chain);
          chain.helper.visible = chain.shapeRig ? chain.displayVisible !== false : false;
        }
      });
      syncItems();
    };
    const removeObject = (obj: THREE.Object3D, preserveForUndo = false) => {
      if (obj === camBody) {
        setStatus('MainCamera is required for CAM view');
        return;
      }

      // A rig root is a child of its Shape, while its TransformControls and
      // SkeletonHelper live outside that hierarchy. Always release both gizmos
      // before removing any part of a rig so no control can retain a dead target.
      const removedNodes = new Set<THREE.Object3D>();
      obj.traverse(node => removedNodes.add(node));
      const previousParent = obj.parent;
      const fallbackSelection = previousParent && selectable.includes(previousParent) && !removedNodes.has(previousParent)
        ? previousParent : undefined;
      transform.detach();
      transform.enabled = false;
      transform.getHelper().visible = false;

      // Remove external rig helpers and chain references when their Root Bone
      // (or owning Shape) is deleted. Keep the removed object tree intact for undo.
      for (let i = rigChains.length - 1; i >= 0; i--) {
        const chain = rigChains[i];
        const rootIsRemoved = chain.bones.some(bone =>
          bone.userData.rigRole === 'root' && removedNodes.has(bone)
        );
        const ownerIsRemoved = Boolean(chain.owner && removedNodes.has(chain.owner));
        const anyBoneIsRemoved = chain.bones.some(bone => removedNodes.has(bone));
        if (!rootIsRemoved && !ownerIsRemoved && !anyBoneIsRemoved) continue;
        if (chain.helper) {
          scene.remove(chain.helper);
          chain.helper.visible = false;
          if (!preserveForUndo) {
            chain.helper.geometry?.dispose();
            const helperMaterial = chain.helper.material;
            if (Array.isArray(helperMaterial)) helperMaterial.forEach(material => material.dispose());
            else helperMaterial?.dispose();
          }
        }
        if (rootIsRemoved || ownerIsRemoved) {
          [chain.target, chain.pole].forEach(handle => {
            if (!handle) return;
            scene.remove(handle);
            const handleIndex = selectable.indexOf(handle);
            if (handleIndex >= 0) selectable.splice(handleIndex, 1);
          });
          rigChains.splice(i, 1);
        } else {
          chain.bones = chain.bones.filter(bone => !removedNodes.has(bone));
          if (chain.bones.length > 0) {
            rebuildRigHelper(chain);
            chain.helper.visible = chain.shapeRig ? chain.displayVisible !== false : false;
          } else {
            rigChains.splice(i, 1);
          }
        }
      }

      const rootAnchor = obj instanceof THREE.Bone && obj.userData.rigRole === 'root' && obj.parent?.userData.nexusRigAnchor
        ? obj.parent : null;
      obj.parent?.remove(obj);
      if (rootAnchor && !preserveForUndo && rootAnchor.children.length === 0) rootAnchor.parent?.remove(rootAnchor);
      const lightEntry = lightSources.find(entry => entry.object === obj);
      if (lightEntry && obj instanceof THREE.SpotLight) scene.remove(obj.target);
      const lightIndex = lightSources.findIndex(entry => entry.object === obj);
      if (lightIndex >= 0) lightSources.splice(lightIndex, 1);
      for (const node of removedNodes) {
        const selectableIndex = selectable.indexOf(node);
        if (selectableIndex >= 0) selectable.splice(selectableIndex, 1);
      }
      if (!preserveForUndo) obj.traverse((child: any) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose());
          else child.material?.dispose();
        }
      });
      const next = { ...keysRef.current };
      removedNodes.forEach(node => { if (node.userData.editorId) delete next[String(node.userData.editorId)]; });
      keysRef.current = next;
      setKeyframes(next);
      syncItems();
      if (fallbackSelection) selectObject(fallbackSelection);
      else selectObject();
      setStatus(obj.name + ' deleted · rig controls released');
    };
    let pointerStart: { x: number; y: number; id: number; startedAt: number } | null = null;
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
      if (runtime.current?.riggingView) return;
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, startedAt: performance.now() };
      recordInteractionTrace('Viewport pointer down', { pointerId: event.pointerId, pointerType: event.pointerType, x: Math.round(event.clientX), y: Math.round(event.clientY), editMode: editModeRef.current, activeTool: activeEditToolRef.current });
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
    const onPointerMove = (event: PointerEvent) => { if (runtime.current?.riggingView) return; if (loopCutGesture?.pointerId === event.pointerId) { updateLoopCutPreview(event); event.preventDefault(); } };
    const onPointerUp = (event: PointerEvent) => {
      if (runtime.current?.riggingView) return;
      recordInteractionTrace('Viewport pointer up', { pointerId: event.pointerId, pointerType: event.pointerType, x: Math.round(event.clientX), y: Math.round(event.clientY), editMode: editModeRef.current, activeTool: activeEditToolRef.current, selectedId: selectedRef.current });
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
      const heldForMs = performance.now() - pointerStart.startedAt;
      pointerStart = null;
      if (moved > 7 || transform.dragging) return;
      // Face mode uses a normal single tap to lock a face. Camera rotation remains a drag gesture.
      if (editModeRef.current === 'Face') {
        recordInteractionTrace('Face tap accepted · selecting face', { heldForMs: Math.round(heldForMs), gesture: 'single-tap' });
      }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const viewCamera = runtime.current?.cameraView ? activeCamera : camera;
      raycaster.setFromCamera(pointer, viewCamera);
      raycaster.params.Line = { threshold: Math.max(0.025, viewCamera.position.length() * 0.0035) };
      const targetRoot = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      // Include visible manual skeleton helpers so their segments can be picked
      // even when the rig is parented inside a Shape/Character mesh.
      const visibleRigHelpers = editModeRef.current === 'Object'
        ? rigChains.filter(chain => chain.shapeRig && chain.displayVisible !== false && chain.helper.visible).map(chain => chain.helper)
        : [];
      const roots = editModeRef.current === 'Object' ? [...selectable.filter(o => o.visible), ...visibleRigHelpers] : (targetRoot ? [targetRoot] : []);
      const hits = raycaster.intersectObjects(roots, true);// Rig controls and joints take priority over enclosing Shape/Character hits.
      const boneHit = hits.find(hit => hit.object.userData.nexusBoneVisual || hit.object.userData.rigControlMarker || hit.object instanceof THREE.SkeletonHelper);
      if (boneHit) {
        const hitObject = boneHit.object;
        if (hitObject.userData.rigControlMarker) {
          selectObject(hitObject);
          setStatus('Selected Control Handle · ' + hitObject.name);
        } else {
          let owner: THREE.Bone | undefined;
          if (hitObject.userData.nexusBoneOwnerId) {
            owner = selectable.find(object => object instanceof THREE.Bone && String(object.userData.editorId || '') === String(hitObject.userData.nexusBoneOwnerId)) as THREE.Bone | undefined;
          } else if (hitObject instanceof THREE.SkeletonHelper) {
            const segmentIndex = Math.floor((boneHit.index ?? 0) / 2);
            const helperBones = (hitObject as THREE.SkeletonHelper & { bones?: THREE.Object3D[] }).bones;
            const helperBone = helperBones?.[segmentIndex];
            owner = helperBone instanceof THREE.Bone ? helperBone : helperBone?.parent instanceof THREE.Bone ? helperBone.parent : undefined;
          }
          if (owner) { selectObject(owner); setStatus('Selected Bone · ' + owner.name); }
        }
        return;
      }
      if (hits.length && editModeRef.current !== 'Object' && selectedRef.current) {
        const hit = hits[0];
        const target = targetRoot;
        if (target && (target === hit.object || target.getObjectById(hit.object.id)) && hit.object instanceof THREE.Mesh && hit.face) {
          const candidateWorldNormal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
          const previousFacePart = activeSubSelection?.mesh === hit.object && activeSubSelection.faceParts?.length === 1
            ? activeSubSelection.faceParts[0]
            : null;
          let previousWorldNormal: THREE.Vector3 | null = null;
          if (previousFacePart && previousFacePart.length >= 3) {
            const previousPosition = (hit.object as THREE.Mesh).geometry.getAttribute('position');
            const previousA = new THREE.Vector3().fromBufferAttribute(previousPosition, previousFacePart[0]);
            let previousLocalNormal: THREE.Vector3 | null = null;
            for (let faceIndex = 1; faceIndex + 1 < previousFacePart.length; faceIndex++) {
              const previousB = new THREE.Vector3().fromBufferAttribute(previousPosition, previousFacePart[faceIndex]);
              const previousC = new THREE.Vector3().fromBufferAttribute(previousPosition, previousFacePart[faceIndex + 1]);
              const normal = previousB.clone().sub(previousA).cross(previousC.clone().sub(previousA));
              if (normal.lengthSq() > 1e-12) { previousLocalNormal = normal.normalize(); break; }
            }
            if (previousLocalNormal) previousWorldNormal = previousLocalNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
          }
          const isOppositeLockedFace = Boolean(editModeRef.current === 'Face' && previousWorldNormal && previousWorldNormal.dot(candidateWorldNormal) < -0.8);
          const faceHighlightColor = 0x00e5ff; // Both locked faces use the same cyan highlight.
          if (!isOppositeLockedFace) clearSubObjectHighlight();
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
                const face = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({ color: faceHighlightColor, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthTest: false }));
                face.renderOrder = 1000;
                subObjectHighlight.add(face);
                const outlineGeometry = new THREE.BufferGeometry().setFromPoints([...worldCorners, worldCorners[0]]);
                const outline = new THREE.Line(outlineGeometry, new THREE.LineBasicMaterial({ color: 0x000000, depthTest: false }));
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
              const face = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({ color: faceHighlightColor, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthTest: false }));
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
              const outline = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x000000, depthTest: false }));
              outline.renderOrder = 1001; subObjectHighlight.add(outline);
              if (activeEditToolRef.current === 'Cutting') {
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
            let selectedFaceParts: number[][] | undefined;
            if (editModeRef.current === 'Face') {
              const previous = activeSubSelection?.mesh === mesh && activeSubSelection.faceParts ? activeSubSelection : null;
              const previousParts = previous?.faceParts || [];
              const currentKeys = new Set(indices.map(index => {
                const point = localVertex(index);
                return [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
              }));
              const sameFace = previousParts.some(part => {
                const previousKeys = new Set(part.map(index => {
                  const point = localVertex(index);
                  return [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
                }));
                return [...currentKeys].every(key => previousKeys.has(key));
              });
              const previousNormal = previous
                ? new THREE.Vector3(0, 0, 1).applyQuaternion(previous.lastQuaternion).normalize()
                : null;
              const currentNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(subObjectPivot.quaternion).normalize();
              const oppositeFaces = Boolean(previousNormal && previousNormal.dot(currentNormal) < -0.8);
              selectedFaceParts = sameFace || previousParts.length >= 2 || (previousParts.length === 1 && !oppositeFaces)
                ? [indices.slice()]
                : [...previousParts.map(part => part.slice()), indices.slice()];
              const merged = new Set<number>();
              selectedFaceParts.forEach(part => part.forEach(index => merged.add(index)));
              indices = Array.from(merged);
              if (selectedFaceParts.length === 2) {
                pivotLocal.set(0, 0, 0);
                indices.forEach(index => pivotLocal.add(localVertex(index)));
                pivotLocal.multiplyScalar(1 / Math.max(indices.length, 1));
                worldPivot.copy(mesh.localToWorld(pivotLocal.clone()));
                subObjectPivot.position.copy(worldPivot);
                setStatus('Dual Faces selected · both faces share one transform pivot');
              } else setStatus('Face selected · tap the opposite face to enable Dual Faces');
            }
            activeSubSelection = { mesh, indices: Array.from(new Set(indices)), faceParts: selectedFaceParts, lastWorld: worldPivot.clone(), lastQuaternion: subObjectPivot.quaternion.clone(), lastScale: subObjectPivot.scale.clone() };
            if (editModeRef.current === 'Face') {
              recordInteractionTrace('Face locked', { objectId: String(mesh.userData.editorId || ''), selectedFaceCount: selectedFaceParts?.length || 0, faceVertexCounts: selectedFaceParts?.map(part => part.length) || [], oppositePairLocked: selectedFaceParts?.length === 2, normalDot: previousWorldNormal ? Number(previousWorldNormal.dot(candidateWorldNormal).toFixed(4)) : null });
              setStatus(selectedFaceParts?.length === 2 ? 'DUAL FACES LOCKED · Extrude is ready' : 'FIRST FACE LOCKED · rotate the camera and tap the opposite face');
            }
            transform.attach(subObjectPivot);
            transform.setMode(modeRef.current);
            transform.setSpace(spaceRef.current);
            transform.enabled = true;
            transform.getHelper().visible = true;
            if (editModeRef.current !== 'Face') setStatus(editModeRef.current + ' selected · pivot aligned to touch point');
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
      controlDiag('pointercancel:before', { pointerId: event.pointerId, button: event.button, pointerType: event.pointerType });
      if (transform.dragging) (transform as any).pointerUp(event);
      ikTapStart = null;
      if (loopCutGesture?.pointerId === event.pointerId) {
        loopCutGesture = null;
        pointerStart = null;
        clearLoopCutPreview();
        orbit.enabled = orbitBeforeLoopCut;
        activeOrbit.enabled = activeOrbitBeforeLoopCut;
        try { if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId); } catch { /* capture may already be released by Android */ }
      } else pointerStart = null;
      syncViewportControls();
      controlDiag('pointercancel:after', { pointerId: event.pointerId, button: event.button, pointerType: event.pointerType });
    };
    const onWindowBlur = () => {
      controlDiag('window-blur:before');
      if (transform.dragging) (transform as any).pointerUp(new PointerEvent('pointerup'));
      if (loopCutGesture) { loopCutGesture = null; pointerStart = null; clearLoopCutPreview(); orbit.enabled = orbitBeforeLoopCut; activeOrbit.enabled = activeOrbitBeforeLoopCut; }
      syncViewportControls();
      controlDiag('window-blur:after');
    };
    let ikTapStart: { x: number; y: number; id: number } | null = null;
    const onIKPointerDown = (event: PointerEvent) => { if (!runtime.current?.riggingView || !ikOrbit.enabled) { ikTapStart = null; return; } ikTapStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
    const onIKPointerUp = (event: PointerEvent) => {
      if (!runtime.current?.riggingView || !ikOrbit.enabled) { ikTapStart = null; return; }
      if (!ikTapStart || ikTapStart.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - ikTapStart.x, event.clientY - ikTapStart.y);
      ikTapStart = null;
      if (moved > 8 || transform?.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, ikCamera);
      raycaster.params.Line = { threshold: Math.max(0.025, ikCamera.position.distanceTo(ikOrbit?.target || new THREE.Vector3()) * 0.0035) };
      const visibleHelpers = rigChains.filter(chain => chain.shapeRig && chain.displayVisible !== false && chain.helper.visible).map(chain => chain.helper);
      const roots = [...selectable.filter(object => object.visible), ...visibleHelpers];
      const hits = raycaster.intersectObjects(roots, true);
      const boneHit = hits.find(hit => hit.object.userData.nexusBoneVisual || hit.object.userData.rigControlMarker || hit.object instanceof THREE.SkeletonHelper);
      if (boneHit) {
        const hitObject = boneHit.object;
        if (hitObject.userData.rigControlMarker) { selectObject(hitObject); return; }
        let owner: THREE.Bone | undefined;
        if (hitObject.userData.nexusBoneOwnerId) {
          owner = selectable.find(object => object instanceof THREE.Bone && String(object.userData.editorId || '') === String(hitObject.userData.nexusBoneOwnerId)) as THREE.Bone | undefined;
        } else if (hitObject instanceof THREE.SkeletonHelper) {
          const segmentIndex = Math.floor((boneHit.index ?? 0) / 2);
          const helperBones = (hitObject as THREE.SkeletonHelper & { bones?: THREE.Object3D[] }).bones;
          const helperBone = helperBones?.[segmentIndex];
          owner = helperBone instanceof THREE.Bone ? helperBone : helperBone?.parent instanceof THREE.Bone ? helperBone.parent : undefined;
        }
        if (owner) selectObject(owner);
        return;
      }
      if (hits.length) {
        let candidate: THREE.Object3D | null = hits[0].object;
        while (candidate && !candidate.userData.editorId) candidate = candidate.parent;
        if (candidate) selectObject(candidate);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onIKPointerDown);
    renderer.domElement.addEventListener('pointerup', onIKPointerUp);
    const onIKPointerCancel = () => { ikTapStart = null; };
    renderer.domElement.addEventListener('pointercancel', onIKPointerCancel);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onWindowBlur);
    let transformBefore: { object: THREE.Object3D; state: TransformSnapshot } | null = null;
    transform.addEventListener('objectChange', () => {
      if (!activeSubSelection || transform.object !== subObjectPivot) {
        if (transform.object) {
          transform.object.updateMatrixWorld(true);
          if (transform.object instanceof THREE.Bone) refreshRigVisuals();
          setItems(prev => [...prev]);
        }
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
      const isolatedTransformIndices = selection.linkedIndices
        ? new Set([...selection.indices, ...selection.linkedIndices].filter(index => index >= 0 && index < pos.count))
        : null;
      if (!isolatedTransformIndices) selection.indices.forEach(index => { if (index >= 0 && index < pos.count) logicalKeys.add(positionKey(pos.getX(index), pos.getY(index), pos.getZ(index))); });
      for (let index = 0; index < pos.count; index++) {
        if (isolatedTransformIndices ? !isolatedTransformIndices.has(index) : !logicalKeys.has(positionKey(pos.getX(index), pos.getY(index), pos.getZ(index)))) continue;
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
      if (selection.faceParts?.length) {
        clearSubObjectHighlight();
        const position = selection.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        selection.faceParts.forEach(part => {
          const valid = part.filter(index => index >= 0 && index < position.count);
          if (valid.length < 3) return;
          const worldPoints: THREE.Vector3[] = [];
          const edgeMap = new Map<string, { count: number; a: THREE.Vector3; b: THREE.Vector3 }>();
          const key = (point: THREE.Vector3) => [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
          for (let start = 0; start + 2 < valid.length; start += 3) {
            const tri = valid.slice(start, start + 3).map(index => new THREE.Vector3().fromBufferAttribute(position, index));
            tri.forEach(point => worldPoints.push(selection.mesh.localToWorld(point.clone())));
            tri.forEach((point, corner) => {
              const next = tri[(corner + 1) % 3];
              const aKey = key(point), bKey = key(next);
              const edgeKey = aKey < bKey ? aKey + '|' + bKey : bKey + '|' + aKey;
              const edge = edgeMap.get(edgeKey);
              if (edge) edge.count += 1; else edgeMap.set(edgeKey, { count: 1, a: point, b: next });
            });
          }
          const faceGeometry = new THREE.BufferGeometry();
          faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(worldPoints.flatMap(point => [point.x, point.y, point.z]), 3));
          faceGeometry.computeVertexNormals();
          const face = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthTest: false }));
          face.renderOrder = 1000; subObjectHighlight.add(face);
          const outlinePoints: THREE.Vector3[] = [];
          edgeMap.forEach(edge => { if (edge.count === 1) outlinePoints.push(selection.mesh.localToWorld(edge.a.clone()), selection.mesh.localToWorld(edge.b.clone())); });
          if (outlinePoints.length) {
            const outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(outlinePoints), new THREE.LineBasicMaterial({ color: 0x000000, depthTest: false }));
            outline.renderOrder = 1001; subObjectHighlight.add(outline);
          }
        });
      }
      selection.lastWorld.copy(subObjectPivot.position);
      selection.lastQuaternion.copy(subObjectPivot.quaternion);
      selection.lastScale.copy(subObjectPivot.scale);
    });
    // Three.js r172 TransformControls emits mouseDown/mouseUp, not
    // dragging-changed. Use its real events so orbit is disabled only while a
    // gizmo drag is active, and transform snapshots are captured consistently.
    transform.addEventListener('mouseDown', () => {
      controlDiag('transform:mouseDown');
      recordInteractionTrace('Transform gizmo drag started', { axis: transform.axis ?? null, mode: transform.getMode(), selectedId: selectedRef.current });
      syncViewportControls(true);
      const object = transform.object;
      if (object === subObjectPivot && activeSubSelection) subGeometryBefore = activeSubSelection.mesh.geometry.clone();
      else transformBefore = object ? { object, state: snapshot(object) } : null;
    });
    transform.addEventListener('mouseUp', () => {
      controlDiag('transform:mouseUp');
      recordInteractionTrace('Transform gizmo drag ended', { axis: transform.axis ?? null, mode: transform.getMode(), selectedId: selectedRef.current });
      syncViewportControls(false);
      if (subGeometryBefore && activeSubSelection && editModeRef.current === 'Face' && transform.getMode() === 'translate' && activeSubSelection.faceParts?.length) {
        // Face Pull: when a face is moved with the Move gizmo, bridge its
        // original perimeter to its new perimeter with real quad side walls.
        // The wall vertices share the exact old/new boundary coordinates with
        // the body and pulled cap, so the result remains one connected shell.
        const mesh = activeSubSelection.mesh;
        const beforeGeometry = subGeometryBefore;
        const liveGeometry = mesh.geometry;
        const beforePosition = beforeGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        const livePosition = liveGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        const selectedVertexIds = new Set(activeSubSelection.faceParts.flat());
        if (beforePosition && livePosition && beforePosition.count === livePosition.count) {
          const sourceIndex = beforeGeometry.index;
          const triangleCount = sourceIndex ? sourceIndex.count : beforePosition.count;
          const vertexAt = (offset: number) => sourceIndex ? sourceIndex.getX(offset) : offset;
          const pointKey = (index: number) => {
            const point = new THREE.Vector3().fromBufferAttribute(beforePosition, index);
            return [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
          };
          const boundary = new Map<string, { a: number; b: number; count: number }>();
          const selectedTriangleOffsets = new Set<number>();
          for (let offset = 0; offset + 2 < triangleCount; offset += 3) {
            const tri = [vertexAt(offset), vertexAt(offset + 1), vertexAt(offset + 2)];
            if (!tri.every(index => selectedVertexIds.has(index))) continue;
            selectedTriangleOffsets.add(offset / 3);
            for (let edge = 0; edge < 3; edge++) {
              const a = tri[edge], b = tri[(edge + 1) % 3];
              const ka = pointKey(a), kb = pointKey(b);
              const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
              const entry = boundary.get(key);
              if (entry) entry.count++;
              else boundary.set(key, { a, b, count: 1 });
            }
          }
          const perimeter = Array.from(boundary.values()).filter(edge => edge.count === 1);
          const moved = perimeter.filter(edge => {
            const oldA = new THREE.Vector3().fromBufferAttribute(beforePosition, edge.a);
            const oldB = new THREE.Vector3().fromBufferAttribute(beforePosition, edge.b);
            const newA = new THREE.Vector3().fromBufferAttribute(livePosition, edge.a);
            const newB = new THREE.Vector3().fromBufferAttribute(livePosition, edge.b);
            return oldA.distanceToSquared(newA) > 1e-12 || oldB.distanceToSquared(newB) > 1e-12;
          });
          if (moved.length) {
            const source = liveGeometry.index ? liveGeometry.toNonIndexed() : liveGeometry.clone();
            const oldAttributes = Object.entries(source.attributes) as Array<[string, THREE.BufferAttribute]>;
            const originalAttributes = liveGeometry.attributes as Record<string, THREE.BufferAttribute>;
            const append: Record<string, number[]> = {};
            oldAttributes.forEach(([name]) => { append[name] = []; });
            const addVertex = (sourceIndex: number, point: THREE.Vector3) => {
              oldAttributes.forEach(([name, attribute]) => {
                if (name === 'position') append[name].push(point.x, point.y, point.z);
                else {
                  const originalAttribute = originalAttributes[name];
                  for (let component = 0; component < attribute.itemSize; component++) {
                    append[name].push(originalAttribute && sourceIndex < originalAttribute.count
                      ? originalAttribute.getComponent(sourceIndex, component)
                      : 0);
                  }
                }
              });
            };
            moved.forEach(edge => {
              const oldA = new THREE.Vector3().fromBufferAttribute(beforePosition, edge.a);
              const oldB = new THREE.Vector3().fromBufferAttribute(beforePosition, edge.b);
              const newA = new THREE.Vector3().fromBufferAttribute(livePosition, edge.a);
              const newB = new THREE.Vector3().fromBufferAttribute(livePosition, edge.b);
              // [oldA, oldB, newB, oldA, newB, newA] is one quad.
              const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) || new THREE.Vector3();
              const wallNormal = oldB.clone().sub(oldA).cross(newB.clone().sub(oldA));
              const wallCenter = oldA.clone().add(oldB).add(newA).add(newB).multiplyScalar(0.25);
              const order = wallNormal.dot(wallCenter.sub(center)) >= 0
                ? [[edge.a, oldA], [edge.b, oldB], [edge.b, newB], [edge.a, oldA], [edge.b, newB], [edge.a, newA]] as Array<[number, THREE.Vector3]>
                : [[edge.b, oldB], [edge.a, oldA], [edge.a, newA], [edge.b, oldB], [edge.a, newA], [edge.b, newB]] as Array<[number, THREE.Vector3]>;
              order.forEach(([sourceVertex, point]) => addVertex(sourceVertex, point));
            });
            const wallStart = source.getAttribute('position').count;
            let wallVertexCount = 0;
            oldAttributes.forEach(([name, attribute]) => {
              const extra = append[name];
              const values = new Float32Array(attribute.array.length + extra.length);
              values.set(attribute.array as unknown as ArrayLike<number>);
              values.set(extra, attribute.array.length);
              source.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize, attribute.normalized));
              if (name === 'position') wallVertexCount = extra.length / 3;
            });
            // Preserve existing material groups. If this mesh uses groups, put
            // the generated wall quads into the first existing face material.
            if (source.groups.length && wallVertexCount) source.addGroup(wallStart, wallVertexCount, source.groups[0].materialIndex);

            // Remove stale coplanar copies of the selected source face. A moved
            // cap remains in the mesh; only a second triangle still occupying
            // that cap's exact pre-pull position is removed. Adjacent side faces
            // share at most an edge, so they do not match a full triangle key.
            const sourcePosition = source.getAttribute('position') as THREE.BufferAttribute;
            const pointKeyFrom = (attribute: THREE.BufferAttribute, index: number) => {
              const point = new THREE.Vector3().fromBufferAttribute(attribute, index);
              return [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
            };
            const triangleKeyFrom = (attribute: THREE.BufferAttribute, start: number) =>
              [pointKeyFrom(attribute, start), pointKeyFrom(attribute, start + 1), pointKeyFrom(attribute, start + 2)].sort().join('|');
            const movedSourceFaceKeys = new Set<string>();
            selectedTriangleOffsets.forEach(triangleOffset => {
              const oldStart = triangleOffset * 3;
              const oldIds = [vertexAt(oldStart), vertexAt(oldStart + 1), vertexAt(oldStart + 2)];
              const oldKey = oldIds.map(index => pointKeyFrom(beforePosition, index)).sort().join('|');
              const liveStart = triangleOffset * 3;
              if (oldKey !== triangleKeyFrom(sourcePosition, liveStart)) movedSourceFaceKeys.add(oldKey);
            });
            if (movedSourceFaceKeys.size) {
              const removedDuplicateTriangles = new Set<number>();
              const sourceTriangleCount = Math.floor(sourcePosition.count / 3);
              for (let triangleOffset = 0; triangleOffset < sourceTriangleCount; triangleOffset++) {
                if (selectedTriangleOffsets.has(triangleOffset)) continue;
                const liveStart = triangleOffset * 3;
                if (movedSourceFaceKeys.has(triangleKeyFrom(sourcePosition, liveStart))) {
                  removedDuplicateTriangles.add(triangleOffset);
                }
              }
              if (removedDuplicateTriangles.size) {
                const originalGroups = source.groups.map(group => ({ ...group }));
                const keptIndices: number[] = [];
                const rebuiltGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
                for (let triangleOffset = 0; triangleOffset < sourceTriangleCount; triangleOffset++) {
                  if (removedDuplicateTriangles.has(triangleOffset)) continue;
                  const originalStart = triangleOffset * 3;
                  const group = originalGroups.find(item => originalStart >= item.start && originalStart + 3 <= item.start + item.count);
                  const materialIndex = group?.materialIndex ?? originalGroups[0]?.materialIndex ?? 0;
                  const newStart = keptIndices.length;
                  keptIndices.push(originalStart, originalStart + 1, originalStart + 2);
                  const previousGroup = rebuiltGroups[rebuiltGroups.length - 1];
                  if (previousGroup && previousGroup.materialIndex === materialIndex && previousGroup.start + previousGroup.count === newStart) {
                    previousGroup.count += 3;
                  } else if (originalGroups.length) {
                    rebuiltGroups.push({ start: newStart, count: 3, materialIndex });
                  }
                }
                source.setIndex(keptIndices);
                source.groups.splice(0, source.groups.length, ...rebuiltGroups);
                recordInteractionTrace('Face Pull stale duplicate surface removed', {
                  removedTriangles: removedDuplicateTriangles.size,
                  movedCapTriangles: movedSourceFaceKeys.size,
                });
              }
            }
            source.computeVertexNormals();
            source.computeBoundingBox();
            source.computeBoundingSphere();
            if (liveGeometry !== source) liveGeometry.dispose();
            mesh.geometry = source;
            refreshTopologyOverlay(mesh);
            recordInteractionTrace('Face Pull side walls committed', { boundaryEdges: moved.length, connectedQuadWalls: moved.length, closedShellBridge: true });
          } else recordInteractionTrace('Face Pull skipped · no moved face perimeter', { selectedVertexCount: selectedVertexIds.size });
        }
      }
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
    });
    const resize = () => {
      const w = Math.max(host.clientWidth, 1), h = Math.max(host.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      activeCamera.aspect = w / h;
      activeCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (ikHost) {
        const activeHost = runtime.current?.riggingView ? ikHost : host;
        const iw = Math.max(activeHost.clientWidth, 1), ih = Math.max(activeHost.clientHeight, 1);
        ikCamera.aspect = iw / ih;
        ikCamera.updateProjectionMatrix();
        if (runtime.current?.riggingView) renderer.setSize(iw, ih);
      }
      setPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', resize);
    transform.addEventListener('mouseUp', () => {
      if (autoKeyRef.current && selectedRef.current) captureRef.current();
    });
      runtime.current = { ...(runtime.current || {}), scene, camera, activeCamera, renderer, orbit, activeOrbit, ikCamera, ikRenderer, ikOrbit, transform, selectable, syncViewportControls, syncItems, addObject, attachRootToShape, captureRigStateFor, restoreRigState, setPerformanceMode: (enabled: boolean) => { const pixelRatio = Math.min(window.devicePixelRatio || 1, enabled ? 1.15 : 2); renderer.setPixelRatio(pixelRatio); const renderHost = runtime.current?.riggingView && ikHost ? ikHost : host; renderer.setSize(Math.max(renderHost.clientWidth, 1), Math.max(renderHost.clientHeight, 1), false); renderer.shadowMap.enabled = !enabled; renderer.renderLists.dispose(); renderer.info.reset(); }, createManualRig, bindSelectedMeshToRig, createIKTarget, solveIK, mirrorSelectedBone, deleteSelectedBone, createPoleTarget, detectRiggedMeshes, autoRigSelectedMesh, normalizeSelectedSkinWeights, smoothSelectedSkinWeights, addUniversalBone, copySelectedBone, setRigParentTarget, attachSelectedToRigParent, detachSelectedRigObject, toggleSelectedBoneControlHandle, toggleSelectedBoneLock, toggleSelectedControlLock, refreshRigVisuals, toggleBoneDisplay, isBoneDisplayVisible, restoreRigGroup: (rig: THREE.Object3D) => { const bones: THREE.Bone[] = []; rig.traverse(node => { if ((node as THREE.Bone).isBone) { bones.push(node as THREE.Bone); ensureBoneJoint(node as THREE.Bone); } }); if (!bones.length || rigChains.some(entry => entry.bones[0] === bones[0])) return; const helper = new THREE.SkeletonHelper(bones[0]); helper.name = rig.name + ' Skeleton'; (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff); scene.add(helper); rigChains.push({ bones, helper, target: null, pole: null }); }, attachRigHandle: (handle: THREE.Object3D, rootId: string, kind: string) => { const chain = rigChains.find(entry => String(entry.bones[0]?.userData.editorId) === String(rootId)); if (!chain) return; if (kind === 'IK Target') chain.target = handle; if (kind === 'IK Pole') chain.pole = handle; }, restoreSkinnedMesh: (mesh: THREE.SkinnedMesh, bones: THREE.Bone[], savedSkeleton?: any) => { const inverses = Array.isArray(savedSkeleton?.boneInverses) && savedSkeleton.boneInverses.length === bones.length ? savedSkeleton.boneInverses.map((elements: number[]) => new THREE.Matrix4().fromArray(elements)) : undefined; const skeleton = new THREE.Skeleton(bones, inverses); if (!inverses) skeleton.calculateInverses(); const bindMatrix = Array.isArray(savedSkeleton?.bindMatrix) && savedSkeleton.bindMatrix.length === 16 ? new THREE.Matrix4().fromArray(savedSkeleton.bindMatrix) : mesh.matrixWorld.clone(); mesh.bind(skeleton, bindMatrix); if (savedSkeleton?.bindMode) mesh.bindMode = savedSkeleton.bindMode; const existingChain = rigChains.find(entry => entry.bones[0] === bones[0]); if (!existingChain) { const helper = new THREE.SkeletonHelper(bones[0]); helper.name = mesh.name + ' Skeleton'; (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff); scene.add(helper); rigChains.push({ bones, helper, target: null, pole: null }); } }, selectObject, removeObject, toggleVisibility, reparentObject, reorderObject, updateLightProperty, toggleLightEnabled, camBody, lightSources, addSceneLight, applyPreset, applySettings, toggleParticle, grid, subObjectHighlight, topologyOverlay, refreshTopologyOverlay, clearSubSelection: () => { activeSubSelection = null; }, getActiveSubSelection: () => activeSubSelection, setActiveSubSelection: (selection: any) => { activeSubSelection = selection; }, restoreExtrudedFaceSelection: (mesh: THREE.Mesh, indices: number[], faceParts?: number[][], linkedIndices?: number[]) => { const position = mesh.geometry.getAttribute('position'); if (!position || indices.length < 3) return; const unique = new Map<string, THREE.Vector3>(); indices.forEach(index => { if (index < 0 || index >= position.count) return; const point = new THREE.Vector3().fromBufferAttribute(position, index); const key = [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(','); unique.set(key, point); }); const center = new THREE.Vector3(); unique.forEach(point => center.add(point)); center.multiplyScalar(1 / Math.max(unique.size, 1)); const a = new THREE.Vector3().fromBufferAttribute(position, indices[0]); const b = new THREE.Vector3().fromBufferAttribute(position, indices[1]); const c = new THREE.Vector3().fromBufferAttribute(position, indices[2]); const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); mesh.updateWorldMatrix(true, false); const worldPivot = mesh.localToWorld(center.clone()); const worldNormal = normal.transformDirection(mesh.matrixWorld); subObjectPivot.position.copy(worldPivot); subObjectPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal); subObjectPivot.scale.set(1, 1, 1); activeSubSelection = { mesh, indices: [...new Set(indices)], faceParts: faceParts?.map(part => [...part]), linkedIndices: linkedIndices ? [...new Set(linkedIndices)] : undefined, lastWorld: worldPivot.clone(), lastQuaternion: subObjectPivot.quaternion.clone(), lastScale: subObjectPivot.scale.clone() }; transform.attach(subObjectPivot); transform.setMode(modeRef.current); transform.setSpace(spaceRef.current); transform.enabled = true; transform.getHelper().visible = true; } };
    const frameLoop = () => {
      orbit.update();
      if (runtime.current?.riggingView && ikOrbit) ikOrbit.update();
      if (!runtime.current?.cameraView) {
        activeCamera.position.copy(camBody.position);
        activeCamera.quaternion.copy(camBody.quaternion);
      } else {
        activeOrbit.update();
      }
      const inCam = Boolean(runtime.current?.cameraView);
      // Keep Manual Shape Rig connection lines synchronized with live bone transforms.
      // SkeletonHelper.update() is not automatic when bones move through TransformControls.
      if (rigChains.some(chain => chain.shapeRig && chain.displayVisible !== false)) {
        scene.updateMatrixWorld(true);
        rigChains.forEach(chain => {
          if (chain.shapeRig && chain.displayVisible !== false) chain.helper.updateMatrixWorld(true);
        });
      }
      const topologyTarget = topologyOverlay.userData.targetMesh as THREE.Mesh | null;
      if (topologyTarget) {
        topologyTarget.updateWorldMatrix(true, false);
        topologyOverlay.matrix.copy(topologyTarget.matrixWorld);
        topologyOverlay.matrixWorldNeedsUpdate = true;
      }
      camBody.visible = !inCam && !Boolean(runtime.current?.riggingView);
      // Selection changes own gizmo visibility; never reveal an old attachment.
      transform.getHelper().visible = Boolean(selectedRef.current && transform.object && transform.enabled);
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
      if (runtime.current?.riggingView) {
        renderer.render(scene, ikCamera);
      } else {
        renderer.render(scene, inCam ? activeCamera : camera);
      }
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
      window.removeEventListener('blur', onWindowBlur);
      renderer.domElement.removeEventListener('pointerdown', onIKPointerDown);
      renderer.domElement.removeEventListener('pointerup', onIKPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onIKPointerCancel);
      if (runtime.current?.renderer === renderer) runtime.current = null;
      clearLoopCutPreview();
      orbit.dispose();
      activeOrbit.dispose();
      ikOrbit?.dispose();
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
      runtime.current?.transform?.setMode(next);
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
    runtime.current?.transform?.setSpace(next);
    setStatus(next === 'world' ? 'World axis space' : 'Local axis space');
  };
  const add = (kind: string) => { if (!cameraView) runtime.current?.addObject(kind); };
  const applyGeometryTool = (tool: 'Extrude' | 'Subdivide' | 'Smooth' | 'LoopCut' | 'FacesCut' | '', rawAmount: number, partOverride?: { mesh: THREE.Mesh; indices: number[]; faceParts?: number[][] }, rebuildExtrudeFromBase = false) => {
    if (!tool) return;
    const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selectedRef.current);
    const savedLoop = tool === 'LoopCut' ? loopCutContext.current : null;
    const savedExtrude = tool === 'Extrude' ? extrudeContext.current : null;
    const part = partOverride || (savedLoop && target instanceof THREE.Mesh && String(target.userData.editorId) === savedLoop.meshId ? { mesh: target, indices: savedLoop.indices } : null) || (savedExtrude && target instanceof THREE.Mesh && String(target.userData.editorId) === savedExtrude.meshId ? { mesh: target, indices: savedExtrude.indices, faceParts: savedExtrude.faceParts } : null) || runtime.current?.getActiveSubSelection?.() || ((tool === 'Subdivide' || tool === 'Smooth') && target instanceof THREE.Mesh ? { mesh: target, indices: Array.from({ length: target.geometry.getAttribute('position')?.count || 0 }, (_value, index) => index) } : null);
    if (!(target instanceof THREE.Mesh) || !part || part.mesh !== target) {
      setStatus('Select a vertex, edge, or face before using a geometry tool');
      return;
    }
    const currentVertexCount = target.geometry.getAttribute('position')?.count || 0;
    // Character safety: the generic triangle subdivision path interpolates every
    // attribute as floating-point data. That is not valid for skinIndex (integer
    // bone references), and can also invalidate skin weights and morph targets.
    // Until a dedicated rig-aware quad subdivision path is available, fail closed
    // before cloning or mutating any skinned/deformation-driven character mesh.
    const hasSkinning = target instanceof THREE.SkinnedMesh ||
      Boolean((target as THREE.Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) ||
      Boolean((target as THREE.Mesh & { skeleton?: THREE.Skeleton }).skeleton) ||
      Boolean(target.geometry.getAttribute('skinIndex')) ||
      Boolean(target.geometry.getAttribute('skinWeight'));
    const hasMorphTargets = Object.values(target.geometry.morphAttributes).some(attributes => Boolean(attributes?.length));
    if (tool === 'Subdivide' && (hasSkinning || hasMorphTargets)) {
      setStatus('Subdivide protected this character: rigged or morph-target meshes need the character-safe quad subdivision path. No mesh, bones, weights, or animation data was changed.');
      diagnosticSinkRef.current('WARN', 'Geometry Safety', 'Character subdivision blocked', JSON.stringify({
        object: target.name,
        skinning: hasSkinning,
        morphTargets: hasMorphTargets,
        vertexCount: target.geometry.getAttribute('position')?.count || 0,
      }));
      return;
    }
    // Extrude depth adjustments always rebuild from the pre-extrusion face snapshot.
    const useExtrudeBaseline = tool === 'Extrude' && rebuildExtrudeFromBase && extrudeBaseGeometry.current;
    let geometry = useExtrudeBaseline ? extrudeBaseGeometry.current!.clone() : target.geometry.clone();
    const before = useExtrudeBaseline ? extrudeBaseGeometry.current!.clone() : target.geometry.clone();
    recordInteractionTrace('Geometry tool requested', { tool, amount: rawAmount, editMode: editModeRef.current, object: target.name, vertexCount: target.geometry.getAttribute('position')?.count ?? 0, indexed: Boolean(target.geometry.index) });
    const ids = Array.from(new Set(part.indices as number[]));
     const selectedFaceParts = Array.isArray(part.faceParts) ? part.faceParts : [];
    const original = geometry.getAttribute('position');
    if (!original || !ids.length) { geometry.dispose(); before.dispose(); return; }
    const pt = (i: number) => new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute, i);
    const selectedPoints = ids.slice(0, 3).map(pt);
    const same = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) < 1e-8;
    const depth = Math.max(0, rawAmount / 100) * 0.8;
    let extrudedCapIndices: number[] = [];
    let extrudedWallCapIndices: number[] = [];
    let selectedExtrudedFaceParts: number[][] = [];
    let generatedCutLoops: number[][][] = [];
    let extrudeQuadGridVerified = false;
    const previousCutLoops = useExtrudeBaseline ? extrudeBaseCutLoops.current.map(loop => loop.map(point => [...point])) : Array.isArray(target.userData.cutLoops) ? (target.userData.cutLoops as number[][][]).map(loop => loop.map(point => [...point])) : [];
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

    if (tool === 'FacesCut') {
       if (editModeRef.current !== 'Face' || selectedFaceParts.length !== 2) {
         geometry.dispose(); before.dispose();
         setStatus('Faces Cut requires exactly two selected opposite faces. Tap one face, then its opposite face.');
         return;
       }
       const position = geometry.getAttribute('position');
       if (!position) { geometry.dispose(); before.dispose(); setStatus('Faces Cut cancelled: mesh has no position data.'); return; }
       const selectedKeys = new Set<string>();
       ids.forEach(index => {
         if (index < 0 || index >= position.count) return;
         const point = new THREE.Vector3().fromBufferAttribute(position, index);
         selectedKeys.add([point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(','));
       });
       const source = geometry.index ? geometry.toNonIndexed() : geometry;
       if (source !== geometry) geometry.dispose();
       const sourcePosition = source.getAttribute('position');
       const kept: number[] = [];
       let removedCaps = 0;
       const capGroups = [{ center: new THREE.Vector3(), count: 0 }, { center: new THREE.Vector3(), count: 0 }];
       let referenceCapNormal: THREE.Vector3 | null = null;
       const keyAt = (index: number) => {
         const point = new THREE.Vector3().fromBufferAttribute(sourcePosition, index);
         return [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
       };
       for (let offset = 0; offset + 2 < sourcePosition.count; offset += 3) {
         const isSelectedCap = selectedKeys.has(keyAt(offset)) && selectedKeys.has(keyAt(offset + 1)) && selectedKeys.has(keyAt(offset + 2));
         if (isSelectedCap) {
           const a = new THREE.Vector3().fromBufferAttribute(sourcePosition, offset);
           const b = new THREE.Vector3().fromBufferAttribute(sourcePosition, offset + 1);
           const c = new THREE.Vector3().fromBufferAttribute(sourcePosition, offset + 2);
           const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
           if (!referenceCapNormal) referenceCapNormal = normal.clone();
           const group = normal.dot(referenceCapNormal) < 0 ? 1 : 0;
           capGroups[group].center.add(a).add(b).add(c);
           capGroups[group].count += 3;
           removedCaps++;
           continue;
         }
         kept.push(offset, offset + 1, offset + 2);
       }
       // Faces Cut opens a passage by removing the two selected, opposite
       // extruded cap surfaces. Their centers do NOT need to touch: requiring
       // coincident caps prevented a through-opening whenever the user had
       // scaled, moved, or rotated the caps before cutting.
       const hasBothOpposingCaps = capGroups[0].count >= 6 && capGroups[1].count >= 6;
       if (!hasBothOpposingCaps || removedCaps < 4 || kept.length < 6) {
         source.dispose(); before.dispose();
         recordInteractionTrace('Faces Cut rejected · opposing cap geometry not found', {
           removedCapTriangles: removedCaps,
           positiveNormalCapVertices: capGroups[0].count,
           oppositeNormalCapVertices: capGroups[1].count,
           remainingVertices: kept.length,
         });
         setStatus('Faces Cut cancelled: select the two opposite extruded cap faces again, then apply Faces Cut.');
         return;
       }
       const cutGeometry = new THREE.BufferGeometry();
       for (const [name, rawAttribute] of Object.entries(source.attributes)) {
         const attribute = rawAttribute as THREE.BufferAttribute;
         const values = new Float32Array(kept.length * attribute.itemSize);
         kept.forEach((sourceIndex, outputIndex) => {
           for (let component = 0; component < attribute.itemSize; component++) values[outputIndex * attribute.itemSize + component] = attribute.getComponent(sourceIndex, component);
         });
         cutGeometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize, attribute.normalized));
       }
       source.dispose();
       geometry = cutGeometry;
       geometry.computeVertexNormals();
       recordInteractionTrace('Faces Cut committed', { removedCapTriangles: removedCaps, remainingTriangles: kept.length / 3, dualFaceCount: selectedFaceParts.length });
     } else if (tool === 'Subdivide') {
      // Recover quad perimeters from pairs of render triangles without assuming
      // their vertex order. The shared render diagonal is never a modeling edge.
      let sourceQuadCorners: number[][] | null = null;
      if (geometry.index && target.userData.kind === 'Cube' && target.userData.nexusQuadGrid !== true) {
        const indexedSource = geometry;
        geometry = indexedSource.toNonIndexed();
        indexedSource.dispose();
        sourceQuadCorners = [];
        for (let base = 0; base < geometry.getAttribute('position').count; base += 6) {
          sourceQuadCorners.push([base, base + 1, base + 4, base + 2]);
        }
      } else {
        if (geometry.index) {
          const indexedSource = geometry;
          geometry = indexedSource.toNonIndexed();
          indexedSource.dispose();
        }
        const candidate = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (candidate && candidate.count >= 6 && candidate.count % 6 === 0) {
          geometry.computeBoundingSphere();
          const tolerance = Math.max(geometry.boundingSphere?.radius || 1, 1) * 1e-5;
          const close = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) <= tolerance * tolerance;
          const reconstructed: number[][] = [];
          let invalidPair = -1;
          for (let offset = 0; offset < candidate.count; offset += 6) {
            const triA = [offset, offset + 1, offset + 2];
            const triB = [offset + 3, offset + 4, offset + 5];
            const point = (index: number) => new THREE.Vector3().fromBufferAttribute(candidate, index);
            const shared: Array<[number, number]> = [];
            triA.forEach(a => triB.forEach(b => { if (close(point(a), point(b))) shared.push([a, b]); }));
            if (shared.length !== 2) { invalidPair = offset / 6; break; }
            const uniqueA = triA.find(index => !shared.some(pair => pair[0] === index));
            const uniqueB = triB.find(index => !shared.some(pair => pair[1] === index));
            if (uniqueA === undefined || uniqueB === undefined) { invalidPair = offset / 6; break; }
            const uniquePosition = triA.indexOf(uniqueA);
            const firstShared = triA[(uniquePosition + 1) % 3];
            const secondShared = triA[(uniquePosition + 2) % 3];
            const firstMatch = shared.find(pair => pair[0] === firstShared)?.[1];
            const secondMatch = shared.find(pair => pair[0] === secondShared)?.[1];
            if (firstMatch === undefined || secondMatch === undefined ||
                !triB.includes(firstMatch) || !triB.includes(secondMatch) ||
                point(uniqueA).distanceToSquared(point(uniqueB)) <= tolerance * tolerance) {
              invalidPair = offset / 6; break;
            }
            const corners = [uniqueA, firstShared, uniqueB, secondShared];
            const p = corners.map(point);
            const areaA = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).lengthSq();
            const areaB = p[2].clone().sub(p[0]).cross(p[3].clone().sub(p[0])).lengthSq();
            if (areaA <= tolerance ** 4 || areaB <= tolerance ** 4) { invalidPair = offset / 6; break; }
            reconstructed.push(corners);
          }
          if (invalidPair < 0 && reconstructed.length === candidate.count / 6) sourceQuadCorners = reconstructed;
          else recordInteractionTrace('Subdivide rejected', {
            reason: 'A render-triangle pair could not be reconstructed as a quad perimeter',
            failingQuadIndex: invalidPair,
            renderVertexCount: candidate.count,
            verifiedQuadCount: reconstructed.length,
          });
        }
      }
      const source = geometry.getAttribute('position') as THREE.BufferAttribute;
      const sourceUv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (!sourceQuadCorners || source.count % 6 !== 0 || sourceQuadCorners.length !== source.count / 6) {
        geometry.dispose(); before.dispose();
        setStatus('Subdivide cancelled: this mesh has no verified quad-cell layout. Existing geometry was preserved.');
        diagnosticSinkRef.current('WARN', 'Geometry Safety', 'Quad subdivision unavailable for current topology', JSON.stringify({
          object: target.name,
          kind: target.userData.kind || 'Imported Mesh',
          vertexCount: source.count,
          indexed: Boolean(geometry.index),
          quadGridMarker: Boolean(target.userData.nexusQuadGrid),
        }));
        return;
      }
      const cellCount = sourceQuadCorners!.length;
      // No arbitrary per-operation vertex cap: each quad always becomes four
      // quad cells. Device memory remains the only practical constraint.
      const outputVertexCount = cellCount * 24;
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
        const quadCorners = sourceQuadCorners![offset / 6];
        const corners = quadCorners.map(readPoint);
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
        const [t00, t10, t11, t01] = quadCorners.map(readUv);
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
      recordInteractionTrace('Subdivide committed', { sourceQuadCount: cellCount, outputQuadCount: cellCount * 4, outputVertexCount });
    } else if (tool === 'Subdivide') {
      // Fail closed for meshes without a verified quad-cell topology. Splitting
      // arbitrary triangles creates diagonal triangle grids and loses reliable
      // face/edge identity. Extruded and non-Cube meshes remain untouched until
      // their quad topology is explicitly represented by the editor.
      geometry.dispose(); before.dispose();
      setStatus('Subdivide paused: this mesh does not have verified quad topology yet. No triangles were split and the original mesh was preserved.');
      diagnosticSinkRef.current('WARN', 'Geometry Safety', 'Quad subdivision unavailable for current topology', JSON.stringify({
        object: target.name,
        kind: target.userData.kind || 'Imported Mesh',
        vertexCount: target.geometry.getAttribute('position')?.count || 0,
        indexed: Boolean(target.geometry.index),
      }));
      return;
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
        } else if (tool === 'LoopCut') {
      // Loop Cut remains a separate operation. Subdivide is deliberately excluded
      // from this triangle-clipping path; all Subdivide requests must pass the
      // verified quad-only branch above or fail closed without changing geometry.
      if (editModeRef.current !== 'Face' || selectedPoints.length < 3) { geometry.dispose(); before.dispose(); setStatus('Loop Cut requires a selected face'); return; }
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
       const dualFaceExtrude = editModeRef.current === 'Face' && selectedFaceParts.length === 2;
       if (dualFaceExtrude) geometry.computeBoundingBox();
       const inwardCenter = dualFaceExtrude ? geometry.boundingBox?.getCenter(new THREE.Vector3()) || null : null;
      if (editModeRef.current === 'Face' && selectedPoints.length === 3) {
        const selectedVertexIds = new Set(ids);
        const sourcePosition = geometry.getAttribute('position');
        const sourceIndex = geometry.index;
        const pointKey = (v: THREE.Vector3) =>
          [v.x, v.y, v.z].map(n => Math.round(n * 1e5)).join(',');
        // Match selected faces by their original triangle identity, never by
        // coordinates alone. Coincident/overlapping triangles can occupy the
        // same positions while belonging to different source faces; a position
        // key would incorrectly extrude every such duplicate and pull its
        // surrounding plane geometry along with the intended selection.
        const selectedTriangleOffsets = new Set<number>();
        selectedExtrudedFaceParts = selectedFaceParts.map(() => []);
        const sourceCount = sourceIndex ? sourceIndex.count : (sourcePosition?.count || 0);
        const sourceVertex = (offset: number) =>
          sourceIndex ? sourceIndex.getX(offset) : offset;
        if (sourcePosition) {
          for (let start = 0; start + 2 < sourceCount; start += 3) {
            const vertexIds = [sourceVertex(start), sourceVertex(start + 1), sourceVertex(start + 2)];
            if (!vertexIds.every(index => selectedVertexIds.has(index))) continue;
            selectedTriangleOffsets.add(Math.floor(start / 3));
          }
        }
        if (!selectedTriangleOffsets.size) {
          geometry.dispose(); before.dispose();
          setStatus('Extrude cancelled: selected face region has no matching triangles');
          return;
        }
        const indexedGeometry = geometry;
        geometry = geometry.toNonIndexed();
        indexedGeometry.dispose();
        const p = geometry.getAttribute('position');
        const data: number[] = Array.from(p.array as ArrayLike<number>);
        const uvAttribute = geometry.getAttribute('uv');
        const uvData: number[] | null = uvAttribute ? Array.from(uvAttribute.array as ArrayLike<number>) : null;
        const boundary = new Map<string, { count: number; a: THREE.Vector3; b: THREE.Vector3 }>();
        let movedTriangles = 0;
        for (let start = 0; start + 2 < p.count; start += 3) {
          const triangleOffset = Math.floor(start / 3);
          if (!selectedTriangleOffsets.has(triangleOffset)) continue;
          const tri = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, start + k));
          movedTriangles++;
          const sourceTriangleVertexIds = [0, 1, 2].map(k => sourceVertex(start + k));
          const selectedPartIndex = selectedFaceParts.findIndex(facePart => {
            const faceVertexIds = new Set(facePart);
            return sourceTriangleVertexIds.every(index => faceVertexIds.has(index));
          });
          if (selectedPartIndex >= 0) tri.forEach((_vertex, corner) => selectedExtrudedFaceParts[selectedPartIndex].push(start + corner));
          const faceOffset = dualFaceExtrude && inwardCenter
            ? inwardCenter.clone().sub(tri[0].clone().add(tri[1]).add(tri[2]).multiplyScalar(1 / 3)).normalize().multiplyScalar(depth)
            : offset;
          tri.forEach((v, k) => {
            extrudedCapIndices.push(start + k);
            const moved = v.clone().add(faceOffset);
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
            const a = edge.a, b = edge.b;
            const wallOffset = dualFaceExtrude && inwardCenter
              ? inwardCenter.clone().sub(a.clone().add(b).multiplyScalar(0.5)).normalize().multiplyScalar(depth)
              : offset;
            const an = a.clone().add(wallOffset), bn = b.clone().add(wallOffset);
            const wallStartIndex = data.length / 3;
            [a, b, bn, a, bn, an].forEach(v => data.push(v.x, v.y, v.z));
            // These duplicated upper wall corners follow the selected cap through transforms.
            extrudedWallCapIndices.push(wallStartIndex + 2, wallStartIndex + 4, wallStartIndex + 5);
            if (uvData) {
              const edgeLength = a.distanceTo(b), wallDepth = offset.length();
              [[0,0],[edgeLength,0],[edgeLength,wallDepth],[0,0],[edgeLength,wallDepth],[0,wallDepth]].forEach(([u,v]) => uvData.push(u,v));
            }
            // Commit each extruded side-wall perimeter as explicit topology lines.
            // This keeps the raised cell outline visible even where faces are coplanar.
            generatedCutLoops.push([a, b, bn, an, a].map(point => point.toArray()));
          });
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
          if (uvData) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvData, 2));
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
// Reconstruct each existing pair of triangles as one canonical quad cell.
      // BoxGeometry commonly stores [A,B,D,B,C,D], while the quad Subdivide path
      // expects [A,B,C,A,C,D]. Pair triangles that share exactly one diagonal
      // and consistent winding. A rotated extrusion may form a warped quad; it
      // remains valid and is subdivided bilinearly rather than rejected.
      if (tool === 'Extrude' && editModeRef.current === 'Face' && !geometry.index) {
        const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        geometry.computeBoundingSphere();
        const tolerance = Math.max(1e-6, (geometry.boundingSphere?.radius || 1) * 1e-5);
        const closePoint = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) <= tolerance * tolerance;
        let verified = Boolean(position && position.count >= 6 && position.count % 6 === 0);
        const reorder: number[] = [];
        if (position && verified) {
          for (let start = 0; start < position.count; start += 6) {
            const triA = [start, start + 1, start + 2];
            const triB = [start + 3, start + 4, start + 5];
            const point = (index: number) => new THREE.Vector3().fromBufferAttribute(position, index);
            const shared: Array<[number, number]> = [];
            triA.forEach(indexA => triB.forEach(indexB => {
              if (closePoint(point(indexA), point(indexB))) shared.push([indexA, indexB]);
            }));
            if (shared.length !== 2) { verified = false; break; }
            const uniqueA = triA.find(index => !shared.some(pair => pair[0] === index));
            const uniqueB = triB.find(index => !shared.some(pair => pair[1] === index));
            if (uniqueA === undefined || uniqueB === undefined) { verified = false; break; }
            const uniquePosition = triA.indexOf(uniqueA);
            const firstShared = triA[(uniquePosition + 1) % 3];
            const secondShared = triA[(uniquePosition + 2) % 3];
            const triBMatchesWinding = triB.some((value, index) =>
              value === shared.find(pair => pair[0] === firstShared)?.[1] &&
              triB[(index + 1) % 3] === uniqueB &&
              triB[(index + 2) % 3] === shared.find(pair => pair[0] === secondShared)?.[1]
            );
            if (!triBMatchesWinding) { verified = false; break; }
            reorder.push(uniqueA, firstShared, uniqueB, uniqueA, uniqueB, secondShared);
          }
        }
        if (verified && position && reorder.length === position.count) {
          // Reorder every vertex attribute together so UVs, colors and integer
          // skin attributes remain attached to their original vertices.
          for (const [name, rawAttribute] of Object.entries(geometry.attributes)) {
            const attribute = rawAttribute as THREE.BufferAttribute;
            if (attribute.count !== position.count) { verified = false; break; }
          }
          if (verified) {
            for (const [name, rawAttribute] of Object.entries(geometry.attributes)) {
              const attribute = rawAttribute as THREE.BufferAttribute;
              const TypedArray = attribute.array.constructor as new (length: number) => typeof attribute.array;
              const values = new TypedArray(reorder.length * attribute.itemSize);
              reorder.forEach((sourceIndex, outputIndex) => {
                for (let component = 0; component < attribute.itemSize; component++) {
                  values[outputIndex * attribute.itemSize + component] = attribute.array[sourceIndex * attribute.itemSize + component];
                }
              });
              geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
            }
            const canonical = geometry.getAttribute('position') as THREE.BufferAttribute;
            for (let start = 0; start < canonical.count; start += 6) {
              const q = Array.from({ length: 6 }, (_value, index) => new THREE.Vector3().fromBufferAttribute(canonical, start + index));
              const normalA = q[1].clone().sub(q[0]).cross(q[2].clone().sub(q[0]));
              const normalB = q[4].clone().sub(q[3]).cross(q[5].clone().sub(q[3]));
              // A rotated/scaled extruded cap can make its connecting wall a
              // non-planar (twisted) quad. That is still valid quad topology:
              // bilinear subdivision handles it. Verify only the shared corners
              // and non-degenerate triangle areas; never discard the whole mesh
              // merely because the four corners are not coplanar.
              if (!closePoint(q[0], q[3]) || !closePoint(q[2], q[4]) ||
                  normalA.lengthSq() <= tolerance ** 4 || normalB.lengthSq() <= tolerance ** 4) {
                verified = false; break;
              }
            }
          }
        }
        extrudeQuadGridVerified = verified;
        if (!verified) {
          diagnosticSinkRef.current('WARN', 'Geometry Safety', 'Extrude quad topology handoff unavailable', JSON.stringify({
            object: target.name,
            vertexCount: position?.count || 0,
            reason: 'Triangle pairs could not be reconstructed as verified quad cells; Subdivide remains disabled for ambiguous topology.'
          }));
        }
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
    const afterQuadGridState = tool === 'Subdivide'
      ? { enabled: true, layout: 'canonical-v1', bounds: null, divisions: 0 }
      : tool === 'Extrude'
        ? { enabled: extrudeQuadGridVerified, layout: extrudeQuadGridVerified ? 'canonical-v1' : null, bounds: null, divisions: 0 }
        : tool === 'LoopCut'
          ? { enabled: false, layout: null, bounds: null, divisions: 0 }
          : captureQuadGridState();
    target.geometry.dispose(); target.geometry = geometry;
    restoreQuadGridState(afterQuadGridState);
    // Keep the working snapshot synchronized with the committed live mesh.
    editBaseGeometry.current?.dispose();
    editBaseGeometry.current = target.geometry.clone();
    const beforeSnapshot = before.clone();
    if (useExtrudeBaseline && extrudeHistoryUpdate.current) {
      // Depth changes update the original Extrude history entry, not a new entry per drag.
      extrudeHistoryUpdate.current(after, afterCutLoops);
      beforeSnapshot.dispose();
    } else {
      let afterSnapshot = after.clone();
      let redoCutLoops = afterCutLoops.map(loop => loop.map(point => [...point]));
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
          target.geometry.dispose(); target.geometry = afterSnapshot.clone();
          target.geometry.computeVertexNormals(); target.geometry.computeBoundingBox();
          target.userData.cutLoops = redoCutLoops.map(loop => loop.map(point => [...point]));
          restoreQuadGridState(afterQuadGridState);
          runtime.current?.refreshTopologyOverlay?.(target);
        }
      });
      if (tool === 'Extrude') {
        extrudeHistoryUpdate.current = (nextGeometry, nextCutLoops) => {
          afterSnapshot.dispose();
          afterSnapshot = nextGeometry.clone();
          redoCutLoops = nextCutLoops.map(loop => loop.map(point => [...point]));
        };
      } else extrudeHistoryUpdate.current = null;
    }
    after.dispose();
    before.dispose();
    if (tool === 'Subdivide' || tool === 'LoopCut' || tool === 'Extrude' || tool === 'Smooth' || tool === 'FacesCut') {
      runtime.current?.refreshTopologyOverlay?.(target);
    }
    if (tool === 'Extrude' && editModeRef.current === 'Face' && extrudedCapIndices.length >= 3) {
      // Keep the moved cap selected: the gizmo and future depth-slider updates stay
      // attached to the top face instead of disappearing after the extrusion.
      runtime.current?.restoreExtrudedFaceSelection?.(target, extrudedCapIndices, selectedExtrudedFaceParts, extrudedWallCapIndices);
      runtime.current?.refreshTopologyOverlay?.(target);
    } else { runtime.current?.clearSubSelection?.(); const gizmo = runtime.current?.transform; if (gizmo) { gizmo.detach(); gizmo.enabled = false; gizmo.getHelper().visible = false; } }
    if (tool !== 'LoopCut') loopCutContext.current = null;
    extrudeContext.current = null;
    if (tool === 'LoopCut' || tool === 'FacesCut') setEditTool('');
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
    const rigSnapshot = r.captureRigStateFor?.(obj) || [];
    r.removeObject(obj, true);
    recordSceneAction({
      label: 'Delete ' + obj.name,
      undo: () => {
        if (parent === r.scene) r.scene.add(obj); else parent.add(obj);
        if (!r.selectable.includes(obj)) r.selectable.push(obj);
        r.restoreRigState?.(rigSnapshot);
        r.selectObject(obj);
        r.syncItems?.();
      },
      redo: () => r.removeObject(obj, true),
    });
  };
  const duplicate = () => {
    const r = runtime.current;
    const obj = r?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected);
    if (obj && !cameraView) r.addObject(obj.userData.kind || obj.name.split(' ')[0], obj.name + ' copy', obj);
    else setStatus('Select an object to duplicate');
  };

  const selectTreeObject = (obj: THREE.Object3D) => {
    const id = String(obj.userData.editorId || '');
    recordInteractionTrace('Scene Tree selection', { object: obj.name, editorId: id, kind: obj.userData.kind || obj.type });
    setSelected(id);
    runtime.current?.selectObject(obj);
  };
  const renameTreeObject = (obj: THREE.Object3D) => {
    if (obj === runtime.current?.camBody || obj.userData.kind === 'Camera') return;
    setRenameTreeDraft(obj.name);
    setRenamingTreeId(String(obj.userData.editorId || ''));
  };
  const commitTreeRename = (obj: THREE.Object3D) => {
    const previousName = obj.name;
    const name = renameTreeDraft.trim();
    setRenamingTreeId('');
    if (!name || name === previousName) return;
    obj.name = name;
    runtime.current?.syncItems?.();
    recordSceneAction({
      label: 'Rename ' + previousName,
      undo: () => { obj.name = previousName; runtime.current?.syncItems?.(); },
      redo: () => { obj.name = name; runtime.current?.syncItems?.(); },
    });
    setStatus('Renamed object to ' + name);
  };
  const toggleTreeObjectLock = (obj: THREE.Object3D) => {
    const previous = Boolean(obj.userData.objectManagerLocked);
    const applyLock = (locked: boolean) => {
      obj.userData.objectManagerLocked = locked;
      runtime.current?.syncItems?.();
      if (String(obj.userData.editorId) === selectedRef.current) runtime.current?.selectObject(obj);
    };
    applyLock(!previous);
    recordSceneAction({
      label: (previous ? 'Unlock ' : 'Lock ') + obj.name,
      undo: () => applyLock(previous),
      redo: () => applyLock(!previous),
    });
    setStatus(obj.name + (obj.userData.objectManagerLocked ? ' locked against transforms' : ' unlocked'));
  };
  const duplicateTreeObject = (obj: THREE.Object3D) => {
    if (obj === runtime.current?.camBody || obj.userData.kind === 'Camera') return;
    selectTreeObject(obj);
    runtime.current?.addObject(obj.userData.kind || obj.name.split(' ')[0], obj.name + ' copy', obj);
  };
  const deleteTreeObject = (obj: THREE.Object3D) => {
    const r = runtime.current;
    if (!r || obj === r.camBody || obj.userData.kind === 'Camera') {
      setStatus('MainCamera is protected from deletion');
      return;
    }
    const parent = obj.parent || r.scene;
    const removedNodes: THREE.Object3D[] = [];
    obj.traverse((node: THREE.Object3D) => { if (r.selectable.includes(node)) removedNodes.push(node); });
    const rigSnapshot = r.captureRigStateFor?.(obj) || [];
    r.removeObject(obj, true);
    recordSceneAction({
      label: 'Delete ' + obj.name,
      undo: () => {
        if (parent === r.scene) r.scene.add(obj); else parent.add(obj);
        removedNodes.forEach(node => { if (!r.selectable.includes(node)) r.selectable.push(node); });
        r.restoreRigState?.(rigSnapshot);
        r.syncItems?.();
        const restoredRigRoot = removedNodes.find(node => node instanceof THREE.Bone && node.userData.shapeRig && node.userData.rigRole === 'root');
        if (restoredRigRoot) { r.selectObject(restoredRigRoot); r.selectObject(obj); }
        else r.selectObject(obj);
      },
      redo: () => r.removeObject(obj, true),
    });
  };
  const groupTreeObject = (obj: THREE.Object3D) => {
    const r = runtime.current;
    if (!r || obj === r.camBody || obj instanceof THREE.Bone || obj.userData.rigControlMarker || obj.userData.kind === 'Camera') {
      setStatus('This object type cannot be grouped');
      return;
    }
    const previousParent = obj.parent || r.scene;
    const group = new THREE.Group();
    group.name = obj.name + ' Group';
    group.userData.editorId = uid();
    group.userData.kind = 'Group';
    r.scene.updateMatrixWorld(true);
    group.position.copy(obj.getWorldPosition(new THREE.Vector3()));
    group.quaternion.copy(obj.getWorldQuaternion(new THREE.Quaternion()));
    group.scale.copy(obj.getWorldScale(new THREE.Vector3()));
    previousParent.attach(group);
    group.attach(obj);
    r.selectable.push(group);
    r.syncItems?.();
    r.selectObject(group);
    recordSceneAction({
      label: 'Group ' + obj.name,
      undo: () => {
        previousParent.attach(obj);
        group.parent?.remove(group);
        const index = r.selectable.indexOf(group);
        if (index >= 0) r.selectable.splice(index, 1);
        r.syncItems?.();
        r.selectObject(obj);
      },
      redo: () => {
        previousParent.add(group);
        group.attach(obj);
        if (!r.selectable.includes(group)) r.selectable.push(group);
        r.syncItems?.();
        r.selectObject(group);
      },
    });
    setStatus(obj.name + ' placed inside a new Group');
  };
  const addTreeObjectToExistingGroup = (obj: THREE.Object3D, targetGroup: THREE.Object3D) => {
    const r = runtime.current;
    if (!r || !targetGroup || targetGroup.userData.kind !== 'Group' || obj === targetGroup ||
        obj === r.camBody || obj.userData.kind === 'Camera' || obj instanceof THREE.Bone || obj.userData.rigControlMarker) return;
    // Never allow parenting an object into one of its own descendants.
    let ancestor: THREE.Object3D | null = targetGroup;
    while (ancestor) {
      if (ancestor === obj) {
        setStatus('Cannot add an object to a Group inside itself');
        return;
      }
      ancestor = ancestor.parent;
    }
    if (obj.parent === targetGroup) {
      setStatus(obj.name + ' is already inside ' + targetGroup.name);
      return;
    }
    const previousParent = obj.parent || r.scene;
    r.scene.updateMatrixWorld(true);
    targetGroup.attach(obj); // Preserve the object's world transform.
    r.syncItems?.();
    r.selectObject(obj);
    recordSceneAction({
      label: 'Add ' + obj.name + ' to ' + targetGroup.name,
      undo: () => {
        previousParent.attach(obj);
        r.syncItems?.();
        r.selectObject(obj);
      },
      redo: () => {
        targetGroup.attach(obj);
        r.syncItems?.();
        r.selectObject(obj);
      },
    });
    setStatus(obj.name + ' added to ' + targetGroup.name + ' · transform preserved');
  };
  const ungroupTreeObject = (group: THREE.Object3D) => {
    const r = runtime.current;
    if (!r || group.userData.kind !== 'Group') return;
    const parent = group.parent || r.scene;
    const children = [...group.children];
    r.scene.updateMatrixWorld(true);
    children.forEach(child => parent.attach(child));
    parent.remove(group);
    const index = r.selectable.indexOf(group);
    if (index >= 0) r.selectable.splice(index, 1);
    r.syncItems?.();
    if (children.length) r.selectObject(children.find(child => r.selectable.includes(child)) || children[0]);
    else r.selectObject();
    recordSceneAction({
      label: 'Ungroup ' + group.name,
      undo: () => {
        parent.add(group);
        children.forEach(child => group.attach(child));
        if (!r.selectable.includes(group)) r.selectable.push(group);
        r.syncItems?.();
        r.selectObject(group);
      },
      redo: () => {
        r.scene.updateMatrixWorld(true);
        children.forEach(child => parent.attach(child));
        parent.remove(group);
        const at = r.selectable.indexOf(group);
        if (at >= 0) r.selectable.splice(at, 1);
        r.syncItems?.();
        if (children.length) r.selectObject(children.find(child => r.selectable.includes(child)) || children[0]);
        else r.selectObject();
      },
    });
    setStatus(group.name + ' ungrouped · child transforms preserved');
  };
  const toggleRiggingWorkspace = () => {
    const r = runtime.current;
    if (!r || !r.renderer || !r.ikCamera || !r.ikOrbit || !ikHostRef.current) {
      setStatus('IK Rigging viewport is still initializing. Please try again.');
      return;
    }
    const opening = !riggingView;
    if (opening) {
      if (cameraView || r.cameraView) {
        setStatus('Exit CAM view before opening IK Rigging');
        return;
      }
      try {
        const rigSubject = r.selectable.find((object: THREE.Object3D) => object.userData.editorId === selectedRef.current)
          || r.selectable.find((object: THREE.Object3D) => object.userData.kind !== 'Light' && object.userData.kind !== 'Camera');
        const bounds = new THREE.Box3();
        if (rigSubject) {
          rigSubject.updateWorldMatrix(true, true);
          bounds.setFromObject(rigSubject);
        }
        const size = new THREE.Vector3();
        const center = new THREE.Vector3(0, 1.2, 0);
        let distance = 6;
        if (!bounds.isEmpty()) {
          bounds.getSize(size);
          bounds.getCenter(center);
          const maxDimension = Math.max(size.x, size.y, size.z);
          if (Number.isFinite(maxDimension) && maxDimension > 0) distance = THREE.MathUtils.clamp(maxDimension * 2.6, 2.5, 10000);
        }
        if (![center.x, center.y, center.z, distance].every(Number.isFinite)) throw new Error('Invalid rig bounds');
        const maxDimension = Math.max(size.x, size.y, size.z, 1);
        r.ikCamera.near = Math.max(0.01, distance / 10000);
        r.ikCamera.far = Math.max(150, distance * 8 + maxDimension * 4);
        r.ikCamera.position.set(center.x, center.y, center.z + distance);
        r.ikCamera.lookAt(center);
        r.ikCamera.updateProjectionMatrix();
        r.ikOrbit.target.copy(center);
        r.ikOrbit.minDistance = Math.max(0.05, Math.min(1, distance * 0.08));
        r.ikOrbit.maxDistance = Math.max(35, distance * 5);
        r.riggingView = true;
        r.syncViewportControls?.();
        // Keep the single TransformControls instance connected; switch its camera.
        r.transform.camera = r.ikCamera;
        const ikHost = ikHostRef.current;
        if (!ikHost) throw new Error('IK viewport host is unavailable');
        if (r.renderer.domElement.parentNode !== ikHost) ikHost.appendChild(r.renderer.domElement);
        r.renderer.setSize(Math.max(ikHost.clientWidth, 1), Math.max(ikHost.clientHeight, 1));
        r.ikCamera.aspect = Math.max(ikHost.clientWidth, 1) / Math.max(ikHost.clientHeight, 1);
        r.ikCamera.updateProjectionMatrix();
        r.transform.enabled = Boolean(selectedRef.current);
        r.transform.getHelper().visible = Boolean(selectedRef.current);
        r.transform.setMode(modeRef.current);
        r.transform.setSpace(spaceRef.current);
        // Re-apply selection after switching the active camera/controller so the
        // IK gizmo is attached to the current Scene Tree item, never a stale target.
        const activeRigSelection = r.selectable.find((object: THREE.Object3D) => String(object.userData.editorId) === selectedRef.current);
        r.selectObject(activeRigSelection);
        setRiggingView(true);
        setRigPanelOpen(true);
        setPanel(true);
        setInspectorOpen(false);
        setMenuOpen(false);
        setQuickPanel(null);
        setShapeLibraryOpen(false);
        setMeshToolsOpen(false);
        setSkyboxOpen(false);
        setRenderVideoOpen(false);
        setStatus('IK Rigging · Single Renderer Viewport');
      } catch (error) {
        r.riggingView = false;
        r.transform.camera = r.camera;
        r.orbit.enabled = true;
        const mainHost = hostRef.current;
        if (mainHost && r.renderer.domElement.parentNode !== mainHost) mainHost.appendChild(r.renderer.domElement);
        if (mainHost) r.renderer.setSize(Math.max(mainHost.clientWidth, 1), Math.max(mainHost.clientHeight, 1));
        setRiggingView(false);
        setRigPanelOpen(false);
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[Nexus3D] Could not open dedicated IK viewport:', error);
        setStatus('IK Rigging could not open · ' + detail);
      }
    } else {
      r.riggingView = false;
      r.ikOrbit.enabled = false;
      r.transform.camera = r.camera;
      const mainHost = hostRef.current;
      if (mainHost && r.renderer.domElement.parentNode !== mainHost) mainHost.appendChild(r.renderer.domElement);
      if (mainHost) {
        r.renderer.setSize(Math.max(mainHost.clientWidth, 1), Math.max(mainHost.clientHeight, 1));
        r.camera.aspect = Math.max(mainHost.clientWidth, 1) / Math.max(mainHost.clientHeight, 1);
        r.camera.updateProjectionMatrix();
      }
      r.syncViewportControls?.();
      r.transform.enabled = false;
      r.transform.getHelper().visible = false;
      const mainSelection = r.selectable.find((object: THREE.Object3D) => String(object.userData.editorId) === selectedRef.current);
      r.selectObject(mainSelection);
      r.transform.enabled = Boolean(selectedRef.current) && editModeRef.current === 'Object';
      const helper = r.transform.getHelper?.();
      if (helper) helper.visible = Boolean(selectedRef.current);
      setRiggingView(false);
      setRigPanelOpen(false);
      setInspectorOpen(false);
      setPanel(true);
      setStatus('Main Viewport restored');
    }
  };

  const toggleCamera = () => {
    const r = runtime.current;
    if (!r) return;
    if (r.riggingView) {
      setStatus('Exit IK Rigging before switching CAM view');
      return;
    }
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
      r.syncViewportControls?.();
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

  const analyzeCoreSystem = () => {
    const renderer = runtime.current?.renderer;
    const info = renderer?.info;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
    const usedMB = heap?.usedJSHeapSize ? Math.round(heap.usedJSHeapSize / 1048576) : null;
    let objects = 0;
    runtime.current?.scene?.traverse(() => { objects += 1; });
    const report = [
      'CORE SYSTEM ANALYSIS',
      `Scene objects: ${objects}`,
      `Geometries: ${info?.memory?.geometries ?? 'unavailable'}`,
      `Textures: ${info?.memory?.textures ?? 'unavailable'}`,
      `Last render calls: ${info?.render?.calls ?? 'unavailable'}`,
      `Triangles: ${info?.render?.triangles ?? 'unavailable'}`,
      `JS heap: ${usedMB === null ? 'not exposed by this WebView' : usedMB + ' MB'}`,
      `Device pixel ratio: ${window.devicePixelRatio || 1}`,
      `Performance mode: ${performanceMode ? 'ON' : 'OFF'}`,
      '',
      'Read-only analysis. No scene or project data was changed.'
    ].join('\\n');
    setCoreOptimizerReport(report);
    setCoreOptimizerAnalyzed(true);
    diagnosticSinkRef.current('INFO', 'Core Optimizer', 'Core system analysis completed', report);
    setStatus('Core system analysis completed · no project data changed');
  };
  const loadRdsSourceAudit = async () => {
    try {
      const response = await fetch('./rds-source-audit.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Build audit asset unavailable (HTTP ${response.status})`);
      const audit = await response.json() as {
        generatedAt?: string; scannedFiles?: number; errors?: number; warnings?: number;
        findings?: Array<{ severity?: string; file?: string; line?: number; rule?: string; message?: string }>;
        limitations?: string[];
      };
      const report = [
        'NEXUS3D RDS · BUILD-TIME SOURCE AUDIT',
        `Generated: ${audit.generatedAt || 'unknown'}`,
        `Scanned source files: ${audit.scannedFiles ?? 'unknown'}`,
        `Errors: ${audit.errors ?? 'unknown'} · Warnings: ${audit.warnings ?? 'unknown'}`,
        '',
        ...(audit.findings || []).map(item => `[${item.severity || 'INFO'}] ${item.file || 'source'}:${item.line || '?'} ${item.rule || ''}\n  ${item.message || ''}`),
        ...(audit.findings?.length ? [] : ['No findings from the currently enabled static rules.']),
        '',
        'LIMITATIONS:',
        ...(audit.limitations || ['Targeted static rules only; not a complete semantic analyzer.'])
      ].join('\\n');
      setRdsSourceAuditReport(report);
      diagnosticSinkRef.current(audit.errors ? 'ERROR' : audit.warnings ? 'WARN' : 'INFO',
        'RDS Source Audit', `${audit.errors || 0} error(s), ${audit.warnings || 0} warning(s)`, report);
      setStatus('Build-time source audit loaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRdsSourceAuditReport(`SOURCE AUDIT UNAVAILABLE\\n${message}\\nRun a new APK build with the RDS audit workflow.`);
      diagnosticSinkRef.current('WARN', 'RDS Source Audit', 'Build-time source audit could not be loaded', message);
      setStatus('Source audit unavailable in this build');
    }
  };
  const runRdsFullScan = () => {
    if (rdsScanBusy) return;
    setRdsScanBusy(true);
    try {
      const rt = runtime.current;
      const scene = rt?.scene as THREE.Scene | undefined;
      const renderer = rt?.renderer as THREE.WebGLRenderer | undefined;
      const checks: Array<{ name: string; status: 'PASS' | 'WARN' | 'ERROR'; detail: string }> = [];
      const add = (name: string, status: 'PASS' | 'WARN' | 'ERROR', detail: string) => checks.push({ name, status, detail });
      const heap = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
      const usedMB = heap?.usedJSHeapSize ? Math.round(heap.usedJSHeapSize / 1048576) : null;
      const info = renderer?.info;
      const objects: THREE.Object3D[] = [];
      if (scene) scene.traverse(object => objects.push(object));
      const ids = new Map<string, number>();
      let duplicateIds = 0, invalidTransforms = 0, skinnedMeshes = 0, bones = 0, missingGeometry = 0, missingMaterial = 0;
      objects.forEach(object => {
        const id = String(object.userData?.editorId || '');
        if (id) { ids.set(id, (ids.get(id) || 0) + 1); if ((ids.get(id) || 0) > 1) duplicateIds += 1; }
        if (![object.position.x, object.position.y, object.position.z, object.rotation.x, object.rotation.y, object.rotation.z, object.scale.x, object.scale.y, object.scale.z].every(Number.isFinite)) invalidTransforms += 1;
        const mesh = object as THREE.Mesh;
        if (mesh.isSkinnedMesh) skinnedMeshes += 1;
        if ((object as THREE.Bone).isBone) bones += 1;
        if (mesh.isMesh && !mesh.geometry) missingGeometry += 1;
        if (mesh.isMesh && !mesh.material) missingMaterial += 1;
      });
      add('Runtime / Main Scene', scene && renderer ? 'PASS' : 'ERROR', scene && renderer ? 'Scene and WebGL renderer are available.' : 'Scene or renderer is not initialized.');
      add('Viewport & Camera', rt?.camera && rt?.activeCamera && rt?.ikCamera ? 'PASS' : 'WARN', rt?.camera && rt?.activeCamera && rt?.ikCamera ? 'Main, active and IK cameras are registered.' : 'One or more camera references are unavailable.');
      add('Transform / Orbit Controls', rt?.transform && rt?.orbit && rt?.ikOrbit ? 'PASS' : 'WARN', rt?.transform && rt?.orbit && rt?.ikOrbit ? 'TransformControls and both orbit controllers are registered.' : 'A transform or orbit controller reference is unavailable.');
      add('Scene Tree Integrity', duplicateIds || invalidTransforms || missingGeometry || missingMaterial ? 'WARN' : 'PASS', `${objects.length} objects; duplicate editor IDs: ${duplicateIds}; invalid transforms: ${invalidTransforms}; meshes without geometry: ${missingGeometry}; meshes without material: ${missingMaterial}.`);
      add('IK / Rig Inventory', skinnedMeshes || bones ? 'PASS' : 'WARN', `${skinnedMeshes} skinned mesh(es), ${bones} bone(s) currently in scene. No rig was modified.`);
      add('Modeling / Resource Inventory', info ? 'PASS' : 'WARN', `Geometries: ${info?.memory?.geometries ?? 'unavailable'}; textures: ${info?.memory?.textures ?? 'unavailable'}; draw calls: ${info?.render?.calls ?? 'unavailable'}; triangles: ${info?.render?.triangles ?? 'unavailable'}.`);
      add('Memory Leak Trend', 'WARN', rdsResourceBaselineRef.current && info ? (() => {
        const previous = rdsResourceBaselineRef.current!;
        const geometryDelta = (info.memory.geometries || 0) - previous.geometries;
        const textureDelta = (info.memory.textures || 0) - previous.textures;
        return `Since previous scan: geometries ${geometryDelta >= 0 ? '+' : ''}${geometryDelta}, textures ${textureDelta >= 0 ? '+' : ''}${textureDelta}. Growth alone is not proof of a leak.`;
      })() : 'Baseline recorded. Run another scan after repeated create/delete operations to compare resource counts.');
      if (info) rdsResourceBaselineRef.current = { geometries: info.memory.geometries || 0, textures: info.memory.textures || 0, time: Date.now() };
      add('Animation / Keyframe State', 'PASS', `Animation state inventory available; editor reports ${totalKeys} keyframe(s). Deep clip validation requires a project-level animation audit.`);
      add('Project / Asset Integrity', 'WARN', 'Live scene references were inspected. Saved .nexus archives and external asset contents are not opened or modified by this runtime scan.');
      add('Offline / Storage', navigator.onLine ? 'PASS' : 'PASS', `Network status: ${navigator.onLine ? 'online' : 'offline'}; localStorage: ${(() => { try { const k='__nexus_rds_probe__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return 'available'; } catch { return 'unavailable'; } })()}. Offline status does not imply a broken app.`);
      const gl = renderer?.getContext();
      const glVersion = gl?.getParameter(gl.VERSION) || 'unavailable';
      const maxTexture = gl?.getParameter(gl.MAX_TEXTURE_SIZE) || 'unavailable';
      add('Device / WebGL Capability', gl ? 'PASS' : 'WARN', `WebGL: ${glVersion}; max texture size: ${maxTexture}; DPR: ${window.devicePixelRatio || 1}; heap: ${usedMB === null ? 'not exposed' : usedMB + ' MB'}.`);
      add('Module API Contract', ['addObject','syncItems','syncViewportControls','setPerformanceMode','createManualRig','solveIK'].every(key => typeof rt?.[key] === 'function') ? 'PASS' : 'WARN', 'Checks registered runtime entry points; this does not statically inspect every source-code call site.');
      add('Regression Safety', 'PASS', 'Read-only checks only. No transforms, hierarchy, bones, materials, animation, renderer settings or project files were changed.');
      const errors = checks.filter(item => item.status === 'ERROR').length;
      const warnings = checks.filter(item => item.status === 'WARN').length;
      const passed = checks.filter(item => item.status === 'PASS').length;
      const report = [
        'NEXUS3D RDS · FULL CORE DIAGNOSTIC REPORT',
        `Scan time: ${new Date().toLocaleString()}`,
        `Result: ${errors} error(s) · ${warnings} warning(s) · ${passed} passed`,
        `Scene objects: ${objects.length} · JS heap: ${usedMB === null ? 'not exposed' : usedMB + ' MB'}`,
        '',
        ...checks.map(item => `[${item.status}] ${item.name}\n  ${item.detail}`),
        '',
        'LIMITATIONS: This is a runtime integrity scan, not a static source-code analyzer. Native Android process crashes require native Logcat instrumentation. A warning is not automatically a confirmed root cause.'
      ].join('\\n');
      setRdsScanReport(report);
      setRdsScanSummary({ checks: checks.length, passed, warnings, errors });
      setRdsLastScanAt(new Date().toLocaleTimeString());
      diagnosticSinkRef.current(errors ? 'ERROR' : warnings ? 'WARN' : 'INFO', 'RDS Full Core Scan', `${errors} error(s), ${warnings} warning(s), ${passed} passed`, report);
      setStatus(`RDS scan complete · ${errors} error(s), ${warnings} warning(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const report = `RDS scan failed safely: ${message}\\nNo repair or scene mutation was attempted.`;
      setRdsScanReport(report);
      diagnosticSinkRef.current('ERROR', 'RDS Scanner', 'Full scan could not complete', message);
      setStatus('RDS scan failed · diagnostic captured');
    } finally {
      setRdsScanBusy(false);
    }
  };
  const runDfiInvestigation = async () => {
    if (dfiBusy) return;
    setDfiBusy(true);
    try {
      const queued = diagnosticQueueRef.current.slice();
      const logs = [...diagnosticLogs, ...queued].slice(-400);
      const errorLogs = logs.filter(entry => entry.level === 'ERROR');
      const warningLogs = logs.filter(entry => entry.level === 'WARN');
      const errorGroups = new Map<string, DiagnosticEntry[]>();
      errorLogs.forEach(entry => {
        const signature = (entry.source + ' :: ' + entry.message).trim().slice(0, 240);
        const group = errorGroups.get(signature) || [];
        group.push(entry);
        errorGroups.set(signature, group);
      });
      const repeatedErrors = [...errorGroups.entries()].filter(([, entries]) => entries.length > 1)
        .sort((a, b) => b[1].length - a[1].length);
      const rt = runtime.current;
      const scene = rt?.scene as THREE.Scene | undefined;
      const geometryFindings: string[] = [];
      const editorIds = new Map<string, number>();
      let meshCount = 0, geometryCount = 0, invalidPositionValues = 0, invalidIndices = 0;
      let nonTriangleElementCounts = 0, degenerateTriangles = 0, trianglesScanned = 0;
      const maxTrianglesToScan = 250000;
      scene?.traverse((object: THREE.Object3D) => {
        const editorId = String(object.userData?.editorId || '');
        if (editorId) editorIds.set(editorId, (editorIds.get(editorId) || 0) + 1);
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        meshCount += 1;
        geometryCount += 1;
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!position || position.itemSize < 3) {
          geometryFindings.push(`${object.name || object.uuid}: missing or invalid position attribute`);
          return;
        }
        for (let i = 0; i < position.count; i += 1) {
          if (!Number.isFinite(position.getX(i)) || !Number.isFinite(position.getY(i)) || !Number.isFinite(position.getZ(i))) invalidPositionValues += 1;
        }
        const index = geometry.getIndex();
        const elementCount = index ? index.count : position.count;
        if (elementCount % 3 !== 0) nonTriangleElementCounts += 1;
        const triangleCount = Math.floor(elementCount / 3);
        for (let t = 0; t < triangleCount && trianglesScanned < maxTrianglesToScan; t += 1, trianglesScanned += 1) {
          const ia = index ? index.getX(t * 3) : t * 3;
          const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          if (![ia, ib, ic].every(value => Number.isInteger(value) && value >= 0 && value < position.count)) {
            invalidIndices += 1;
            continue;
          }
          const ax = position.getX(ia), ay = position.getY(ia), az = position.getZ(ia);
          const bx = position.getX(ib), by = position.getY(ib), bz = position.getZ(ib);
          const cx = position.getX(ic), cy = position.getY(ic), cz = position.getZ(ic);
          const abx = bx - ax, aby = by - ay, abz = bz - az;
          const acx = cx - ax, acy = cy - ay, acz = cz - az;
          const crossX = aby * acz - abz * acy;
          const crossY = abz * acx - abx * acz;
          const crossZ = abx * acy - aby * acx;
          if (crossX * crossX + crossY * crossY + crossZ * crossZ < 1e-18) degenerateTriangles += 1;
        }
      });
      const duplicateEditorIds = [...editorIds.entries()].filter(([, count]) => count > 1);
      if (invalidPositionValues) geometryFindings.push(`${invalidPositionValues} non-finite vertex coordinate value(s)`);
      if (invalidIndices) geometryFindings.push(`${invalidIndices} invalid triangle index reference(s)`);
      if (nonTriangleElementCounts) geometryFindings.push(`${nonTriangleElementCounts} mesh geometry/ies with element counts not divisible by 3`);
      if (degenerateTriangles) geometryFindings.push(`${degenerateTriangles} degenerate triangle(s) in scanned geometry`);
      if (duplicateEditorIds.length) geometryFindings.push(`${duplicateEditorIds.length} duplicate editor ID value(s): ${duplicateEditorIds.slice(0, 8).map(([id, count]) => id + ' ×' + count).join(', ')}`);

      let sourceAudit: { generatedAt?: string; scannedFiles?: number; errors?: number; warnings?: number; findings?: Array<{ severity?: string; file?: string; line?: number; rule?: string; message?: string }>; limitations?: string[] } | null = null;
      let sourceAuditStatus = 'Build-time DFI source audit unavailable in this build.';
      try {
        const response = await fetch('./nexus-dfi-audit.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        sourceAudit = await response.json();
        sourceAuditStatus = `Generated ${sourceAudit.generatedAt || 'unknown'} · ${sourceAudit.scannedFiles ?? 'unknown'} source file(s) · ${sourceAudit.errors ?? 0} error(s) · ${sourceAudit.warnings ?? 0} warning(s)`;
      } catch (error) {
        sourceAuditStatus += ' ' + (error instanceof Error ? error.message : String(error));
      }

      const findings: string[] = [];
      if (errorLogs.length) findings.push(`RUNTIME ERROR EVIDENCE: ${errorLogs.length} error log(s) captured across ${errorGroups.size} distinct signature(s).`);
      repeatedErrors.slice(0, 8).forEach(([signature, entries]) => findings.push(`REPEATED ERROR ×${entries.length}: ${signature}. First seen ${entries[0].time}; latest ${entries[entries.length - 1].time}.`));
      if (warningLogs.length) findings.push(`RUNTIME WARNINGS: ${warningLogs.length} warning log(s) are available for correlation; warnings alone do not prove a failure cause.`);
      if (geometryFindings.length) findings.push(...geometryFindings.map(item => 'SCENE INTEGRITY: ' + item));
      if (sourceAudit?.findings?.length) findings.push(...(sourceAudit.findings || []).slice(0, 30).map(item => `SOURCE ${item.severity || 'INFO'}: ${item.file || 'source'}:${item.line || '?'} ${item.rule || ''} — ${item.message || ''}`));
      if (!findings.length) findings.push('No deterministic failure signature was identified by the currently enabled checks. This is not proof that the project is bug-free.');

      const invalidMeshes = geometryFindings.length;
      const sourceErrors = sourceAudit?.errors || 0;
      const sourceWarnings = sourceAudit?.warnings || 0;
      const totalFindings = errorLogs.length + geometryFindings.length + (sourceAudit?.findings?.length || 0);
      const report = [
        'NEXUS3D DFI CORE · DEEP FORENSIC INVESTIGATION',
        `Scan time: ${new Date().toLocaleString()}`,
        `Runtime evidence: ${logs.length} log(s) · ${errorLogs.length} error(s) · ${warningLogs.length} warning(s)`,
        `Repeated error signatures: ${repeatedErrors.length}`,
        `Scene geometry: ${meshCount} mesh(es) / ${geometryCount} geometry(ies) · ${trianglesScanned}${trianglesScanned >= maxTrianglesToScan ? '+' : ''} triangle(s) inspected`,
        `Build-time source audit: ${sourceAuditStatus}`,
        '',
        'EVIDENCE & FINDINGS',
        ...findings,
        '',
        'MOST RECENT RUNTIME ERROR',
        ...(errorLogs.length ? [`${errorLogs[errorLogs.length - 1].time} · ${errorLogs[errorLogs.length - 1].source} · ${errorLogs[errorLogs.length - 1].message}`, errorLogs[errorLogs.length - 1].details || 'No stack/details captured.'] : ['No runtime ERROR entry is currently available.']),
        '',
        'SOURCE AUDIT LIMITATIONS',
        ...(sourceAudit?.limitations || ['Build-time DFI audit was not available.']),
        '',
        'INVESTIGATION RULES',
        'Read-only investigation. No scene, mesh, transform, rig, material, or project data was modified.',
        'A repeated error or integrity warning is evidence, not automatic proof of the original root cause. Confirm the cause by reproducing the same operation and tracing the first failing state transition.',
        'This APK scan cannot inspect Git history, the complete source dependency graph, or native Android Logcat. Use repository analysis and native crash logs for those layers.',
      ].join('\n');
      setDfiReport(report);
      setDfiSummary({ findings: totalFindings, errors: errorLogs.length + sourceErrors, warnings: warningLogs.length + sourceWarnings, repeatedErrors: repeatedErrors.length, invalidMeshes });
      diagnosticSinkRef.current(errorLogs.length || sourceErrors || invalidMeshes ? 'WARN' : 'INFO',
        'DFI Core', 'Deep forensic investigation completed', report);
      setStatus('DFI investigation complete · read-only evidence report ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDfiReport('DFI investigation failed safely\n' + message + '\nNo repair or scene mutation was attempted.');
      diagnosticSinkRef.current('ERROR', 'DFI Core', 'Investigation could not complete', message);
      setStatus('DFI investigation failed · diagnostic captured');
    } finally {
      setDfiBusy(false);
    }
  };
  const applyCoreOptimization = () => {
    if (!coreOptimizerAnalyzed) { setStatus('Run Analyze before applying optimization'); return; }
    if (!runtime.current?.setPerformanceMode) { setStatus('Renderer is not ready; optimization was not applied'); return; }
    runtime.current.setPerformanceMode(true);
    setPerformanceMode(true);
    setCoreOptimizerReport(previous => previous + '\\n\\nSAFE OPTIMIZATION APPLIED\\nRenderer pixel ratio reduced and real-time shadows disabled. Scene and project data were preserved.');
    diagnosticSinkRef.current('INFO', 'Core Optimizer', 'Safe performance profile applied', 'Renderer pixel ratio capped at 1.15 and real-time shadows disabled. No scene resources were disposed.');
    setStatus('Safe Core Optimization applied · scene data preserved');
  };
  const clearNexusCache = async () => {
    if (!Capacitor.isNativePlatform()) {
      setStatus('Clear Cache is available in the installed Android APK only');
      return;
    }
    if (!window.confirm('Clear temporary Nexus3D and WebView cache? Saved projects, imported models, and app data will not be deleted.')) return;
    setMaintenanceBusy(true);
    try {
      const result = await NexusProjectFiles.clearAppCache();
      setStatus(result?.message || 'Temporary cache cleared successfully');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus('Unable to clear cache · ' + detail);
    } finally {
      setMaintenanceBusy(false);
    }
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
      version: 3,
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
        skeleton: obj instanceof THREE.SkinnedMesh ? {
          boneEditorIds: obj.skeleton.bones.map(bone => bone.userData.editorId || null),
          boneInverses: obj.skeleton.boneInverses.map(matrix => Array.from(matrix.elements)),
          bindMatrix: Array.from(obj.bindMatrix.elements),
          bindMode: obj.bindMode
        } : undefined,
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
  const saveProject = async () => {
    try {
      const data = getProjectData();
      const sceneObjects = Array.isArray(data.objects) ? data.objects : [];
      const meshCount = sceneObjects.filter((obj: any) => obj && obj.geometry?.attributes?.position?.array?.length).length;
      if (meshCount === 0) {
        setStatus('SAVE CANCELLED: walang 3D shape/mesh na nakuha sa current scene. Hindi gumawa ng empty project file.');
        return;
      }
      const serialized = JSON.stringify({
        ...data,
        projectName: projectName.trim() || 'Project.nexus',
        savedObjectCount: sceneObjects.length,
        savedMeshCount: meshCount
      });
      const safeName = (projectName.trim() || 'Project.nexus').replace(/[^a-z0-9._-]/gi, '_');
      const fileName = safeName.toLowerCase().endsWith('.nexus') || safeName.toLowerCase().endsWith('.json') ? safeName : safeName + '.nexus';

      if (Capacitor.isNativePlatform()) {
        // Android Storage Access Framework: let the user choose a real .nexus
        // destination. The document is written locally and works without internet.
        const saved = await NexusProjectFiles.saveProject({ fileName, content: serialized });
        try { localStorage.setItem('nexus3d-project-v1', serialized); } catch (storageError) {
          console.warn('Nexus3D local backup unavailable:', storageError);
        }
        setStatus('PROJECT SAVED SUCCESSFULLY — ' + (saved.name || fileName) + ' · ' + meshCount + ' shape(s)');
        return;
      }

      localStorage.setItem('nexus3d-project-v1', serialized);
      const blob = new Blob([serialized], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Project saved and downloaded as ' + link.download);
    } catch (error) {
      console.error('Nexus3D save failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus('SAVE FAILED: ' + message);
    }
  };
  const loadProject = async () => {
    setStatus('Choose a .nexus project from Internal Storage');
    if (Capacitor.isNativePlatform()) {
      try {
        const selectedFile = await NexusProjectFiles.loadProject();
        const file = new File([selectedFile.content], selectedFile.name || 'project.nexus', { type: 'application/json' });
        handleProjectFile(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/cancel/i.test(message)) setStatus('LOAD FAILED: ' + message);
      }
      return;
    }
    projectFileRef.current?.click();
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
        const savedMeshCount = data.objects.filter((saved: any) =>
          saved && Array.isArray(saved.geometry?.attributes?.position?.array) &&
          saved.geometry.attributes.position.array.length >= 9
        ).length;
        if (savedMeshCount === 0) {
          setStatus('LOAD STOPPED: walang 3D shapes sa file na ito. Posibleng empty/duplicate save file ang napili.');
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
            obj = saved.objectType === 'SkinnedMesh' ? new THREE.SkinnedMesh(geometry, material) : new THREE.Mesh(geometry, material);
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

        // Rebuild manual rig chains before reconnecting their IK handles.
        data.objects.forEach((saved: any) => {
          if (saved?.kind !== 'Rig') return;
          const rig = saved.editorId ? restoredById.get(saved.editorId) : restoredByName.get(saved.name);
          if (rig) r.restoreRigGroup?.(rig);
        });
        // Restore skinned meshes only after every bone and parent transform exists.
        r.scene.updateMatrixWorld(true);
        data.objects.forEach((saved: any) => {
          if (saved?.objectType !== 'SkinnedMesh' || !saved.skeleton || !Array.isArray(saved.skeleton.boneEditorIds)) return;
          const mesh = saved.editorId ? restoredById.get(saved.editorId) : restoredByName.get(saved.name);
          if (!(mesh instanceof THREE.SkinnedMesh)) return;
          const bones = saved.skeleton.boneEditorIds.map((id: string) => restoredById.get(id)).filter((bone: any): bone is THREE.Bone => bone instanceof THREE.Bone);
          if (bones.length !== saved.skeleton.boneEditorIds.length || bones.length === 0) { console.warn('Nexus3D: skipped incomplete saved skeleton', saved.name); return; }
          r.restoreSkinnedMesh?.(mesh, bones, saved.skeleton);
        });
        data.objects.forEach((saved: any) => {
          if (saved?.kind !== 'IK Target' && saved?.kind !== 'IK Pole') return;
          const handle = saved.editorId ? restoredById.get(saved.editorId) : restoredByName.get(saved.name);
          const rootId = saved.editorData?.rigRootBoneId;
          if (handle && rootId) r.attachRigHandle?.(handle,rootId,saved.kind);
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
        setStatus('PROJECT LOADED SUCCESSFULLY · ' + savedMeshCount + ' shape(s), ' + restoredCount + ' scene objects restored');
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
  const importModelArchive = async (archive?: File) => {
    if (!archive || !runtime.current?.scene) return;
    try {
      setStatus('Extracting model ZIP…');
      const zip = await JSZip.loadAsync(archive);
      const supported = /\.(glb|gltf|obj|fbx|dae|stl|ply|vrm|bvh)$/i;
      const entries = Object.values(zip.files).filter((entry: any) => !entry.dir && supported.test(entry.name));
      if (!entries.length) throw new Error('ZIP contains no supported 3D model (GLB, GLTF, OBJ, FBX, DAE, STL, PLY, VRM or BVH)');
      // Prefer a GLB, then GLTF, then OBJ; prefer the shallowest path when there are multiple assets.
      entries.sort((a: any, b: any) => {
        const rank = (name: string) => /\.glb$/i.test(name) ? 0 : /\.gltf$/i.test(name) ? 1 : /\.vrm$/i.test(name) ? 2 : /\.fbx$/i.test(name) ? 3 : /\.dae$/i.test(name) ? 4 : /\.obj$/i.test(name) ? 5 : /\.ply$/i.test(name) ? 6 : /\.stl$/i.test(name) ? 7 : 8;
        return rank(a.name) - rank(b.name) || a.name.split('/').length - b.name.split('/').length;
      });
      const primary: any = entries[0];
      const extracted: File[] = [];
      for (const entry of Object.values(zip.files) as any[]) {
        if (entry.dir) continue;
        const blob = await entry.async('blob');
        const file = new File([blob], entry.name.split('/').pop() || entry.name, { type: blob.type || 'application/octet-stream' });
        Object.defineProperty(file, 'webkitRelativePath', { value: entry.name, configurable: true });
        extracted.push(file);
      }
      const main = extracted.find(file => (file as any).webkitRelativePath === primary.name);
      if (!main) throw new Error('Could not extract the main model file');
      await importModel(main, extracted.filter(file => file !== main));
      setStatus('ZIP MODEL IMPORTED · ' + primary.name);
    } catch (error) {
      console.error('Nexus3D model ZIP import failed:', error);
      setStatus('MODEL ZIP IMPORT FAILED: ZIP must contain a valid GLB, GLTF, OBJ or FBX and its companion files');
    }
  };
  const importModel = async (file?: File, companionFiles: File[] = []) => {
    if (!file || !runtime.current?.scene) return;
    const r = runtime.current;
    const objectUrls: string[] = [];
    try {
      let object: THREE.Object3D;
      let importedAnimations: THREE.AnimationClip[] = [];
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const allFiles = [file, ...companionFiles];
      const fileMap = new Map<string, File>();
      allFiles.forEach(asset => {
        const relativePath = ((asset as any).webkitRelativePath || asset.name).replace(/\\/g, '/').toLowerCase();
        fileMap.set(relativePath, asset);
        fileMap.set(asset.name.toLowerCase(), asset);
        fileMap.set(relativePath.split('/').pop() || asset.name.toLowerCase(), asset);
      });
      const primaryPath = ((file as any).webkitRelativePath || file.name).replace(/\\/g, '/').toLowerCase();
      const primaryDirectory = primaryPath.includes('/') ? primaryPath.slice(0, primaryPath.lastIndexOf('/') + 1) : '';
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url: string) => {
        const clean = decodeURIComponent(url.split(/[?#]/)[0]).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        const match = fileMap.get(clean) || fileMap.get((primaryDirectory + clean).replace(/\/+/g, '/')) || fileMap.get(clean.split('/').pop() || '');
        if (!match) return url;
        const blobUrl = URL.createObjectURL(match);
        objectUrls.push(blobUrl);
        return blobUrl;
      });
      if (extension === 'obj') {
        const materialFile = companionFiles.find(asset => asset.name.toLowerCase().endsWith('.mtl'));
        const objLoader = new OBJLoader(manager);
        if (materialFile) {
          const materials = new MTLLoader(manager).parse(await materialFile.text(), '');
          materials.preload();
          objLoader.setMaterials(materials);
        }
        object = objLoader.parse(await file.text());
      } else if (extension === 'gltf' || extension === 'glb' || extension === 'vrm') {
        const buffer = await file.arrayBuffer();
        const loader = new GLTFLoader(manager);
        if (extension === 'vrm') loader.register(parser => new VRMLoaderPlugin(parser));
        const gltf = await new Promise<any>((resolve, reject) => loader.parse(buffer, primaryDirectory, resolve, reject));
        object = gltf.scene;
        importedAnimations = gltf.animations || [];
        if (gltf.userData?.vrm) object.userData.nexusVRM = gltf.userData.vrm;
      } else if (extension === 'fbx') {
        const buffer = await file.arrayBuffer();
        object = new FBXLoader(manager).parse(buffer, primaryDirectory);
        importedAnimations = (object as any).animations || [];
      } else if (extension === 'dae') {
        const collada = new ColladaLoader(manager).parse(await file.text(), primaryDirectory);
        object = collada.scene;
        importedAnimations = collada.animations || [];
      } else if (extension === 'stl' || extension === 'ply') {
        const buffer = await file.arrayBuffer();
        const geometry = extension === 'stl' ? new STLLoader(manager).parse(buffer) : new PLYLoader(manager).parse(buffer);
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
        const hasColors = Boolean(geometry.getAttribute('color'));
        const material = new THREE.MeshStandardMaterial({ color: hasColors ? 0xffffff : 0xb8c5d6, roughness: 0.72, metalness: 0.08, vertexColors: hasColors });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = file.name.replace(/\.(stl|ply)$/i, '') || 'Imported Geometry';
        object = new THREE.Group();
        object.add(mesh);
      } else if (extension === 'bvh') {
        const bvh = new BVHLoader().parse(await file.text());
        const rootBone = bvh.skeleton.bones[0];
        if (!rootBone) throw new Error('BVH file does not contain a skeleton root');
        object = new THREE.Group();
        object.name = 'BVH Skeleton';
        object.add(rootBone);
        const helper = new THREE.SkeletonHelper(rootBone);
        helper.name = 'BVH Bone Display';
        object.add(helper);
        importedAnimations = bvh.clip ? [bvh.clip] : [];
        object.userData.nexusBVHSkeleton = true;
      } else {
        setStatus('Unsupported model format. Choose GLB, GLTF, OBJ, FBX, DAE, STL, PLY, VRM or BVH.');
        return;
      }
      object.userData.nexusAnimationClips = importedAnimations;
      object.name = file.name.replace(/\.(gltf|glb|obj|fbx|dae|stl|ply|vrm|bvh)$/i, '') || 'Imported Model';
      const importedNodes: THREE.Object3D[] = [];
      object.traverse((node: any) => {
        if (!node.userData.editorId) node.userData.editorId = uid();
        node.userData.kind = node === object ? 'Imported Model' : node.isBone ? 'Bone' : node.isMesh ? 'Mesh' : 'GLTF Node';
        importedNodes.push(node);
        if (node.isMesh && node.geometry) {
          node.geometry.computeVertexNormals();
          node.geometry.computeBoundingBox();
          node.geometry.computeBoundingSphere();
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      r.scene.add(object);
      importedNodes.forEach(node => { if (!r.selectable.includes(node)) r.selectable.push(node); });
      r.detectRiggedMeshes?.(object);
      r.syncItems?.();
      setStatus('Imported ' + file.name);
    } catch (error) {
      console.error('Nexus3D model import failed:', error);
      setStatus('Model import failed. Check the model and its companion BIN/MTL/texture files, and confirm the format is supported.');
    } finally {
      // Keep dependency object URLs alive while the loaded textures finish decoding.
      window.setTimeout(() => objectUrls.forEach(url => URL.revokeObjectURL(url)), 30000);
    }
  };
  const exportProjectZip = async () => {
    const r = runtime.current;
    if (!r?.scene) { setStatus('ZIP EXPORT FAILED: 3D scene is not ready'); return; }
    try {
      setStatus('Preparing portable project ZIP…');
      const data = getProjectData();
      const exporter = new GLTFExporter();
      const userDataSnapshots: Array<{ target: any; userData: any }> = [];
      r.scene.traverse((node: any) => {
        userDataSnapshots.push({ target: node, userData: node.userData });
        node.userData = {};
        const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
        materials.forEach((material: any) => {
          userDataSnapshots.push({ target: material, userData: material.userData });
          material.userData = {};
        });
      });
      let glb: ArrayBuffer;
      try {
        glb = await new Promise<ArrayBuffer>((resolve, reject) => {
          exporter.parse(
            r.scene,
            result => {
              if (result instanceof ArrayBuffer) resolve(result);
              else reject(new Error('GLB exporter did not return a binary scene'));
            },
            error => reject(error instanceof Error ? error : new Error(String(error))),
            { binary: true, onlyVisible: true }
          );
        });
      } finally {
        userDataSnapshots.forEach(snapshot => { snapshot.target.userData = snapshot.userData; });
      }
      const zip = new JSZip();
      const safeBase = (projectName.trim() || 'Nexus3D_Project').replace(/\.(nexus|zip)$/i, '').replace(/[^a-z0-9._-]/gi, '_');
      zip.file('Project.nexus', JSON.stringify({
        ...data,
        settings: { ...settings },
        projectName: safeBase + '.nexus',
        savedObjectCount: data.objects.length,
        savedMeshCount: data.objects.filter((item: any) => item?.geometry?.attributes?.position?.array?.length).length
      }));
      zip.file('Scene/Scene.glb', glb);
      zip.file('Manifest.json', JSON.stringify({
        format: 'Nexus3D Portable Project',
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        projectFile: 'Project.nexus',
        sceneFile: 'Scene/Scene.glb',
        sceneBinaryIncludes: ['mesh geometry', 'node hierarchy and transforms', 'supported materials and embedded textures', 'supported skinning and skeleton data', 'supported cameras and lights'],
        editorDataFileIncludes: ['Nexus3D editor IDs and metadata', 'scene object snapshots', 'keyframes']
      }, null, 2));
      const base64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const fileName = safeBase.toLowerCase().endsWith('.zip') ? safeBase : safeBase + '.zip';
      if (Capacitor.isNativePlatform()) {
        const saved = await NexusProjectFiles.saveProjectArchive({ fileName, base64 });
        setStatus('PROJECT ZIP EXPORTED SUCCESSFULLY — ' + (saved.name || fileName));
      } else {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        setStatus('PROJECT ZIP EXPORTED SUCCESSFULLY — ' + fileName);
      }
    } catch (error) {
      console.error('Nexus3D ZIP export failed:', error);
      setStatus('ZIP EXPORT FAILED: ' + (error instanceof Error ? error.message : String(error)));
    }
  };
  const importProjectZip = async (file?: File) => {
    const r = runtime.current;
    if (!r?.scene) return;
    try {
      setStatus('Reading Nexus3D project ZIP…');
      const zip = await JSZip.loadAsync(file || new Blob());
      const projectEntry = zip.file('Project.nexus');
      const sceneEntry = zip.file('Scene/Scene.glb');
      if (!projectEntry || !sceneEntry) throw new Error('ZIP is missing Project.nexus or Scene/Scene.glb');
      const projectData = JSON.parse(await projectEntry.async('string'));
      if (!Array.isArray(projectData.objects)) throw new Error('Project metadata is invalid');
      const sceneBuffer = await sceneEntry.async('arraybuffer');
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => loader.parse(sceneBuffer, '', resolve, reject));
      const importedScene: THREE.Object3D = gltf.scene;
      importedScene.name = (projectData.projectName || file?.name || 'Nexus3D Imported Project').replace(/\.(nexus|zip)$/i, '');
      const savedByName = new Map<string, any[]>();
      projectData.objects.forEach((saved: any) => {
        if (!saved || typeof saved.name !== 'string') return;
        const key = saved.name + '::' + (saved.kind || '');
        const list = savedByName.get(key) || [];
        list.push(saved);
        savedByName.set(key, list);
      });
      const restoredById = new Map<string, THREE.Object3D>();
      const importedNodes: THREE.Object3D[] = [];
      importedScene.traverse((node: any) => {
        const kind = node.isBone ? 'Bone' : node.isSkinnedMesh ? 'Mesh' : node.isMesh ? 'Mesh' : node.userData?.kind || node.type;
        const candidates = savedByName.get(node.name + '::' + kind) || savedByName.get(node.name + '::') || [];
        const saved = candidates.shift();
        if (saved) {
          if (saved.editorId) {
            node.userData.editorId = saved.editorId;
            restoredById.set(saved.editorId, node);
          }
          if (saved.editorData && typeof saved.editorData === 'object') {
            Object.entries(saved.editorData).forEach(([key, value]) => {
              if (key !== 'editorId') node.userData[key] = value;
            });
          }
          node.userData.kind = saved.kind || kind;
        } else {
          node.userData.editorId = node.userData.editorId || uid();
          node.userData.kind = kind;
        }
        importedNodes.push(node);
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
      });
      r.scene.add(importedScene);
      importedNodes.forEach(node => { if (!r.selectable.includes(node)) r.selectable.push(node); });
      projectData.objects.forEach((saved: any) => {
        if (saved?.kind !== 'Rig') return;
        const rig = saved.editorId ? restoredById.get(saved.editorId) : undefined;
        if (rig) r.restoreRigGroup?.(rig);
      });
      projectData.objects.forEach((saved: any) => {
        if (saved?.kind !== 'IK Target' && saved?.kind !== 'IK Pole') return;
        const handle = saved.editorId ? restoredById.get(saved.editorId) : undefined;
        const rootId = saved.editorData?.rigRootBoneId;
        if (handle && rootId) r.attachRigHandle?.(handle, rootId, saved.kind);
      });
      if (projectData.keyframes && typeof projectData.keyframes === 'object') {
        keysRef.current = projectData.keyframes as Keyframes;
        setKeyframes(keysRef.current);
        setUndoStack([]); setRedoStack([]);
        setActionUndoStack([]); setActionRedoStack([]);
      }
      if (projectData.settings && typeof projectData.settings === 'object') setSettings(prev => ({ ...prev, ...projectData.settings }));
      r.detectRiggedMeshes?.(importedScene);
      r.scene.updateMatrixWorld(true);
      r.syncItems?.();
      r.selectObject?.(importedScene);
      setStatus('PROJECT ZIP IMPORTED · ' + importedNodes.filter((node: any) => node.isMesh).length + ' mesh(es), textures/materials and embedded GLB skeleton data loaded');
    } catch (error) {
      console.error('Nexus3D ZIP import failed:', error);
      setStatus('ZIP IMPORT FAILED: ' + (error instanceof Error ? error.message : String(error)));
    }
  };
  const chooseProjectZip = async (file?: File) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const picked = await NexusProjectFiles.loadProjectArchive();
        const binary = atob(picked.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await importProjectZip(new File([bytes], picked.name || 'Nexus3D_Project.zip', { type: 'application/zip' }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/cancel/i.test(message)) setStatus('ZIP LOAD FAILED: ' + message);
      }
      return;
    }
    if (file) await importProjectZip(file);
    else projectZipFileRef.current?.click();
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
    <main className={'editor-shell ' + (animationMode ? 'animation-mode' : '') + (riggingView ? ' rigging-mode' : '')}>


      <div className={'viewport ' + (pathTool ? 'path-tool-active' : '')} ref={hostRef} onPointerDown={e => { if (!pathTool || animationMode) return; const rect = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - rect.left) / rect.width - .5) * 20; const z = ((e.clientY - rect.top) / rect.height - .5) * -20; setMotionPathPoints(prev => [...prev, {x, y:0.05, z}]); }} onDragOver={e => { if (e.dataTransfer.types.includes('text/nexus3d-object')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={e => { const childId = e.dataTransfer.getData('text/nexus3d-object'); if (!childId) return; e.preventDefault(); const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); if (child) runtime.current?.reparentObject(child); }} />
      <div ref={ikHostRef} className={'ik-dedicated-viewport ' + (riggingView ? 'active' : '')} aria-label="Dedicated IK Rigging 3D viewport" />
       {riggingView && <div className="ik-rig-actions" aria-label="Manual rig attachment actions">
         <button type="button" onClick={() => runtime.current?.addUniversalBone?.('root')}>＋ ROOT</button>
         <button type="button" onClick={() => runtime.current?.attachRootToShape?.()}>ATTACH TO SHAPE</button>
         <button type="button" onClick={() => runtime.current?.bindSelectedMeshToRig?.()}>BIND MESH</button>
       </div>}
      
      <div className={'camera-mode-hud ' + (cameraView ? 'cine-active' : '')} aria-live="polite"><span className="camera-mode-dot" />{cameraView ? 'CINE CAMERA VIEW' : riggingView ? 'IK RIGGING · FRONT PERSPECTIVE' : 'PERSPECTIVE MODE'}</div>
      {!animationMode && !cameraView && <div className="quick-access-rail" aria-label="Quick access controls">
        <button type="button" className={quickPanel === 'lights' ? 'active' : ''} onClick={() => { setQuickPanel(quickPanel === 'lights' ? null : 'lights'); setInspectorOpen(false); setPanel(false); setMenuOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Quick Light Controls"><Sun size={14}/><span>LIGHTS</span></button>
        <button type="button" className={quickPanel === 'materials' ? 'active' : ''} onClick={() => { setQuickPanel(quickPanel === 'materials' ? null : 'materials'); setInspectorOpen(false); setPanel(false); setMenuOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Quick Material and Color Controls"><Palette size={14}/><span>MATERIAL</span></button>
        <button type="button" className={inspectorOpen ? 'active' : ''} onClick={() => { setInspectorOpen(v => !v); setQuickPanel(null); if (!riggingView) setPanel(false); setMenuOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Unified Transform Inspector"><SlidersHorizontal size={14}/><span>PROPS</span></button>
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
          <button className={'icon-btn ' + (panel ? 'active' : '')} id="btn-hierarchy" onClick={() => { const opening = !panel; setPanel(opening); setMenuOpen(false); setQuickPanel(null); if (!riggingView) setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title={panel ? 'Hide Scene Tree' : 'Show Scene Tree'} disabled={cameraView}><Layers size={14} /></button>
          <button className="icon-btn" onClick={() => { setMenuOpen(v => !v); setPanel(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Menu"><Settings2 size={14} /></button>
          <div className="tool-divider" />
          <button className="icon-btn" onClick={undo} disabled={!actionUndoStack.length && !undoStack.length} title="Undo scene or timeline action"><Undo2 size={15} /></button>
          <button className="icon-btn" onClick={redo} disabled={!actionRedoStack.length && !redoStack.length} title="Redo scene or timeline action"><Redo2 size={15} /></button>
          <button className={'icon-btn ' + (shapeLibraryOpen ? 'active' : '')} onClick={() => { setShapeLibraryOpen(v => !v); setMenuOpen(false); setPanel(false); setQuickPanel(null); setInspectorOpen(false); setMeshToolsOpen(false); }} title="Open Shape Library" aria-label="Open Shape Library"><Box size={14} /></button>
          <button className={'icon-btn ' + (meshToolsOpen ? 'active' : '')} onClick={() => { const candidate = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected); if (!(candidate instanceof THREE.Mesh)) { setStatus('Select a mesh to enable Mesh Editing'); return; } const opening = !meshToolsOpen; setMeshToolsOpen(opening); setShapeLibraryOpen(false); setPanel(false); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); if (opening) { setEditMode('Object'); editModeRef.current = 'Object'; setEditTool(''); runtime.current?.clearSubSelection?.(); const tr = runtime.current?.transform; if (tr) { tr.detach(); tr.enabled = false; tr.getHelper().visible = false; } } else { const tr = runtime.current?.transform; if (tr) { tr.detach(); tr.attach(candidate); tr.setMode(mode); tr.setSpace(space); tr.enabled = true; tr.getHelper().visible = true; } } }} disabled={!selected || !(runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected) instanceof THREE.Mesh)} title="Toggle Mesh Editing" aria-label="Toggle Mesh Editing"><Scissors size={15}/></button>
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
      {meshToolsOpen && selected && !cameraView && runtime.current?.selectable.some((o: THREE.Object3D) => String(o.userData.editorId) === selected && o instanceof THREE.Mesh) && <section className={'mesh-edit-panel nexus-modeling-workspace ' + (editMode === 'Face' ? 'face-edit-active' : '')} aria-label="Nexus3D Modeling Workspace" role="dialog"><div className="edit-workspace-heading"><div className="edit-workspace-brand"><span className="edit-workspace-mark">N</span><div><strong>MODELING WORKSPACE</strong><small>LIVE MESH EDITOR</small></div></div><span className="edit-workspace-live"><i/> LIVE</span></div><div className="edit-workspace-target"><span>ACTIVE OBJECT</span><strong>{runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected)?.name || 'Selected Mesh'}</strong><small>{editMode === 'Object' ? 'Object-level editing' : editMode + ' component editing'} · changes apply to viewport</small></div><div className="edit-workspace-section-label">EDIT MODE</div><div className="shape-edit-modes">{(['Object', 'Vertex', 'Edge', 'Face'] as const).map(level => <button key={level} className={editMode === level ? 'active' : ''} onClick={() => { editModeRef.current = level; setEditMode(level); const tr = runtime.current?.transform; const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selectedRef.current); if (tr) { if (level === 'Object') { tr.detach(); if (target) tr.attach(target); tr.setMode(mode); tr.setSpace(space); tr.enabled = Boolean(target); tr.getHelper().visible = Boolean(target); } else { tr.detach(); tr.enabled = false; tr.getHelper().visible = false; } } if (level === 'Object') { runtime.current?.clearSubSelection?.(); const group = runtime.current?.subObjectHighlight as THREE.Group | undefined; if (group) { while (group.children.length) { const child = group.children[0]; group.remove(child); child.traverse((node: any) => { node.geometry?.dispose?.(); if (node.material?.dispose) node.material.dispose(); }); } } } else if (target instanceof THREE.Mesh) { runtime.current?.clearSubSelection?.(); runtime.current?.refreshTopologyOverlay?.(target); } setStatus(level === 'Object' ? 'Object transform enabled' : level + ' mode · committed mesh cuts remain visible'); }} title={level + ' selection mode'}>{level === 'Vertex' ? <GitBranch size={13}/> : level === 'Edge' ? <Scissors size={13}/> : level === 'Face' ? <Layers size={13}/> : <Move size={13}/>}<span>{level}</span></button>)}</div>{editMode === 'Face' && <><div className="edit-workspace-section-label edit-operations-label">FACE OPERATIONS</div><div className="shape-edit-actions" aria-label="Face editing actions">{(['Extrude', 'Subdivide', 'Smooth', 'Loop Cut', 'Faces Cut'] as const).map(tool => <button key={tool} disabled={tool === 'Extrude' && (runtime.current?.getActiveSubSelection?.()?.faceParts?.length || 0) < 1} className={activeEditTool === (tool === 'Loop Cut' ? 'Cutting' : tool) ? 'active' : ''} onClick={() => { if (tool === 'Faces Cut') {
         const target = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected);
         const active = runtime.current?.getActiveSubSelection?.();
         if (!(target instanceof THREE.Mesh) || !active || active.mesh !== target || active.faceParts?.length !== 2) {
           setStatus('Faces Cut requires Dual Faces: select one face, then the opposite face, extrude both inward, then tap Faces Cut.');
           return;
         }
         applyGeometryTool('FacesCut', 0, { mesh: target, indices: [...active.indices], faceParts: active.faceParts.map((part: number[]) => [...part]) });
         return;
       }
       if (tool === 'Loop Cut') { const target = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected); const active = runtime.current?.getActiveSubSelection?.(); if (!(target instanceof THREE.Mesh) || !active || active.mesh !== target) { setStatus('Select a face before Loop Cut'); return; } setEditTool('Cutting'); setEditAmount(50); loopCutContext.current = { meshId: String(target.userData.editorId), indices: [...active.indices] }; editBaseGeometry.current?.dispose(); editBaseGeometry.current = target.geometry.clone(); setStatus('Loop Cut active · drag across the selected face; pink preview follows your finger'); return; } const target = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === selected); if (!(target instanceof THREE.Mesh)) { setStatus('Select a mesh to edit geometry'); return; } if (tool === 'Extrude') { const active = runtime.current?.getActiveSubSelection?.(); if (!active || !active.faceParts?.length) { setStatus('Select and lock a face before Extrude'); recordInteractionTrace('Extrude blocked · no face selected', { selectedFaceCount: active?.faceParts?.length || 0 }); return; } } setEditTool(tool); const meshId = String(target.userData.editorId); const cutAmount = tool === 'Subdivide' ? 50 : 35; if (tool === 'Subdivide') subdivideCutCount.current[meshId] = (subdivideCutCount.current[meshId] || 0) + 1; setEditAmount(cutAmount); editBaseGeometry.current?.dispose(); editBaseGeometry.current = target.geometry.clone(); if (tool === 'Extrude') { const active = runtime.current?.getActiveSubSelection?.(); extrudeContext.current = active ? { meshId: meshId, indices: [...active.indices], faceParts: active.faceParts?.map((part: number[]) => [...part]) } : null; extrudeBaseGeometry.current?.dispose(); extrudeBaseGeometry.current = target.geometry.clone(); extrudeBaseCutLoops.current = Array.isArray(target.userData.cutLoops) ? (target.userData.cutLoops as number[][][]).map(loop => loop.map(point => [...point])) : []; extrudeHistoryUpdate.current = null; } applyGeometryTool(tool, tool === 'Extrude' ? 0 : cutAmount); if (tool !== 'Extrude') { editBaseGeometry.current?.dispose(); editBaseGeometry.current = target.geometry.clone(); } }} title={tool + ' selected geometry'}>{tool === 'Extrude' ? <Move size={13}/> : tool === 'Subdivide' ? <GitBranch size={13}/> : tool === 'Smooth' ? <Sparkles size={13}/> : tool === 'Faces Cut' ? <Aperture size={13}/> : <Scissors size={13}/>}<span>{tool}</span></button>)}</div></>}{activeEditTool === 'Extrude' && <div className="shape-edit-slider"><label>Extrude ready · use Move / Rotate / Scale on the selected cap</label><button onClick={() => { setEditTool(''); extrudeContext.current = null; extrudeBaseGeometry.current?.dispose(); extrudeBaseGeometry.current = null; extrudeBaseCutLoops.current = []; extrudeHistoryUpdate.current = null; editBaseGeometry.current?.dispose(); editBaseGeometry.current = null; }} aria-label="Close extrude adjustment"><X size={12}/></button></div>}{activeEditTool === 'Cutting' && <div className="shape-edit-slider"><label>Loop Position <strong>{editAmount}%</strong></label><input aria-label="Loop cut position" type="range" min="1" max="99" step="1" value={editAmount} onChange={e => setEditAmount(Number(e.target.value))} onPointerUp={() => { const context = loopCutContext.current; const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === context?.meshId); if (target instanceof THREE.Mesh && context) applyGeometryTool('LoopCut', editAmount, { mesh: target, indices: context.indices }); }}/><button onClick={() => { setEditTool(''); loopCutContext.current = null; extrudeContext.current = null; extrudeBaseGeometry.current?.dispose(); extrudeBaseGeometry.current = null; extrudeBaseCutLoops.current = []; extrudeHistoryUpdate.current = null; editBaseGeometry.current?.dispose(); editBaseGeometry.current = null; }} aria-label="Close loop cutting"><X size={12}/></button></div>}</section>}

      {shapeLibraryOpen && !cameraView && <section className="shape-library-popover" role="dialog" aria-label="Shape Library"><div className="shape-library-heading"><strong><Cuboid size={14} /> Shape Library</strong><button onClick={() => setShapeLibraryOpen(false)} aria-label="Close Shape Library"><X size={13} /></button></div><div className="shape-library-grid">{[{name:'Cube',icon:<Box size={18}/>},{name:'Sphere',icon:<Circle size={18}/>},{name:'Cylinder',icon:<Cylinder size={18}/>},{name:'Cone',icon:<Cone size={18}/>},{name:'Torus',icon:<Circle size={18}/>},{name:'Directional Light',icon:<Sun size={18}/>},{name:'Spotlight',icon:<Flashlight size={18}/>},{name:'Flashlight',icon:<Lightbulb size={18}/>}].map(shape => <button key={shape.name} onClick={() => { if (shape.name.endsWith('Light') || shape.name === 'Spotlight' || shape.name === 'Flashlight') runtime.current?.addSceneLight(shape.name === 'Directional Light' ? 'Directional' : shape.name === 'Spotlight' ? 'Spot' : 'Flashlight'); else add(shape.name); setShapeLibraryOpen(false); }}><span>{shape.icon}</span><small>{shape.name}</small></button>)}</div><p>Choose an item to add it to the current scene.</p></section>}

      {animOpen && !cameraView && <section className="interpolation-float" aria-label="Interpolation editor"><div className="interpolation-float-head"><strong>INTERPOLATION</strong><span>{interpolation}</span></div><svg viewBox="0 0 180 76" role="img" aria-label="Bezier interpolation curve"><path d="M8 66 L172 8" stroke="#26394f" strokeDasharray="3 3" fill="none"/><path d={`M8 66 C ${8 + curveTangent * 0.55} ${66 - curveWeight * 0.5}, ${172 - curveTangent * 0.55} ${8 + curveTension * 0.5}, 172 8`} stroke="#59ddff" strokeWidth="2.5" fill="none"/><circle cx={8 + curveTangent * 0.55} cy={66 - curveWeight * 0.5} r="4" fill="#ff73c8"/><circle cx={172 - curveTangent * 0.55} cy={8 + curveTension * 0.5} r="4" fill="#59ddff"/></svg><label>CURVE WEIGHT <span>{(curveWeight / 50).toFixed(2)}</span><input type="range" min="0" max="100" value={curveWeight} onChange={e => setCurveWeight(Number(e.target.value))}/></label><label>TENSION <span>{(curveTension / 40).toFixed(2)}</span><input type="range" min="0" max="100" value={curveTension} onChange={e => setCurveTension(Number(e.target.value))}/></label><label>BIAS <span>{((curveTangent - 50) / 40).toFixed(2)}</span><input type="range" min="0" max="100" value={curveTangent} onChange={e => setCurveTangent(Number(e.target.value))}/></label></section>}

      {!panel && !cameraView && !riggingView && <button className={'floating-menu-toggle ' + (menuOpen ? 'active' : '')} id="btn-menu-panel" onClick={() => { const opening = !menuOpen; setMenuOpen(opening); if (opening) { setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); } }} title={menuOpen ? 'Close Menu Panel' : 'Open Menu Panel'}><span className="menu-glyph">☰</span><span>MENU</span></button>}

      {menuOpen && !panel && !cameraView && !riggingView && <aside className="menu-panel" style={{ "--nexus-panel-width": sharedPanelWidth + "px" } as React.CSSProperties}>
        <div className="panel-heading"><div><Settings2 size={13} /><span>Menu</span></div><button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={13} /></button></div>
        <div className="menu-panel-scroll">
        <section className="menu-category diagnostic-menu-section">
          <button type="button" className={'menu-option diagnostic-toggle-button ' + (diagnosticPanelOpen ? 'expanded' : '')}
                          aria-expanded={diagnosticPanelOpen}
                          onClick={() => setDiagnosticPanelOpen(open => !open)}>
                          <Activity size={13}/><span>REALTIME DIAGNOSTIC SYSTEM</span>
                          {diagnosticPanelOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                        </button>
                        {diagnosticPanelOpen && <section className="diagnostic-panel-expanded" aria-label="Realtime Diagnostic System Panel">
                        <div className="diagnostic-summary"><span>{diagnosticLogs.length} captured log(s)</span><span>{diagnosticLogs.filter(entry => entry.level === 'ERROR').length} error(s)</span></div>
                        <div className="rds-rit-toolbar">
                          <button type="button" className={'diagnostic-toggle-button rds-rit-toggle rds-icon-button ' + (interactionTraceOpen ? 'expanded' : '')}
                            aria-label="Realtime Interaction Trace" title="Realtime Interaction Trace · toggle panel"
                            aria-expanded={interactionTraceOpen} onClick={() => setInteractionTraceOpen(open => !open)}>
                            <Activity size={15}/>
                            {interactionTraceOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                          </button>
                        </div>
                        {interactionTraceOpen && <section className="rds-rit-panel" aria-label="Realtime Interaction Trace results">
                          <div className="diagnostic-summary"><span>{diagnosticLogs.filter(entry => entry.source === 'Interaction Trace').length} interaction event(s)</span><span>{diagnosticLogs.filter(entry => entry.source === 'Interaction Trace' && entry.level === 'ERROR').length} trace error(s)</span></div>
                          <div className="diagnostic-actions rds-rit-actions rds-icon-actions" aria-label="RIT actions">
                            <button type="button" aria-label="Copy all RIT logs" title="Copy all RIT logs" onClick={() => void copyDiagnosticText([...diagnosticLogs.filter(entry => entry.source === 'Interaction Trace'), ...diagnosticQueueRef.current.filter(entry => entry.source === 'Interaction Trace')])} disabled={!diagnosticLogs.some(entry => entry.source === 'Interaction Trace') && !diagnosticQueueRef.current.some(entry => entry.source === 'Interaction Trace')}><ClipboardCopy size={15}/></button>
                            <button type="button" aria-label="Clear all RIT logs" title="Clear all RIT logs" onClick={clearInteractionTraceLogs} disabled={!diagnosticLogs.some(entry => entry.source === 'Interaction Trace') && !diagnosticQueueRef.current.some(entry => entry.source === 'Interaction Trace')}><Trash2 size={15}/></button>
                          </div>
                          <div className="diagnostic-log-list" role="log" aria-live="polite" aria-label="Nexus3D interaction trace">
                            {!diagnosticLogs.some(entry => entry.source === 'Interaction Trace') && <div className="diagnostic-empty">No interaction events captured yet. Tap the viewport, Scene Tree, or a modeling tool to begin tracing.</div>}
                            {diagnosticLogs.filter(entry => entry.source === 'Interaction Trace').slice(-120).reverse().map(entry => <article className={'diagnostic-entry diagnostic-' + entry.level.toLowerCase()} key={entry.id}>
                              <div><strong>{entry.level}</strong><time>{entry.time}</time></div>
                              <b>{entry.source}</b><p>{entry.message}</p>
                              {entry.details && <pre>{entry.details}</pre>}
                            </article>)}
                          </div>
                          <div className="menu-info"><Info size={12}/><span>RIT captures viewport taps, gizmo drags, Scene Tree selections and modeling-tool requests. Live capture continues while this panel is closed.</span></div>
                        </section>}
                        <div className="diagnostic-actions rds-icon-actions" aria-label="RDS actions">
                          <button type="button" aria-label="Copy filtered RDS logs" title="Copy filtered RDS logs" onClick={() => void copyDiagnosticText(visibleDiagnosticLogs)} disabled={!visibleDiagnosticLogs.length}><ClipboardCopy size={15}/></button>
                          <button type="button" aria-label="Copy all RDS logs" title="Copy all RDS logs" onClick={() => void copyDiagnosticText(diagnosticLogs)} disabled={!diagnosticLogs.length}><Copy size={15}/></button>
                          <button type="button" aria-label="Clear all RDS logs" title="Clear all RDS logs" onClick={clearDiagnosticLogs} disabled={!diagnosticLogs.length}><Trash2 size={15}/></button>
                        </div>
                        <div className="diagnostic-filters rds-icon-filters" role="group" aria-label="Diagnostic log filter">
                          <button type="button" title="Show all logs" aria-label="Show all logs" className={diagnosticFilter === 'ALL' ? 'active' : ''} onClick={() => setDiagnosticFilter('ALL')}><Layers size={14}/></button>
                          <button type="button" title="Show errors" aria-label="Show errors" className={diagnosticFilter === 'ERROR' ? 'active' : ''} onClick={() => setDiagnosticFilter('ERROR')}><ScanEye size={14}/></button>
                          <button type="button" title="Show warnings" aria-label="Show warnings" className={diagnosticFilter === 'WARN' ? 'active' : ''} onClick={() => setDiagnosticFilter('WARN')}><Gauge size={14}/></button>
                          <button type="button" title="Show info logs" aria-label="Show info logs" className={diagnosticFilter === 'INFO' ? 'active' : ''} onClick={() => setDiagnosticFilter('INFO')}><Info size={14}/></button>
                        </div>
                        <div className="diagnostic-log-list" role="log" aria-live="polite" aria-label="Nexus3D runtime diagnostics">
                          {!visibleDiagnosticLogs.length && <div className="diagnostic-empty">No {diagnosticFilter === 'ALL' ? '' : diagnosticFilter.toLowerCase() + ' '}logs captured yet. Reproduce the problem, then open this panel again.</div>}
                          {visibleDiagnosticLogs.slice().reverse().map(entry => <article className={'diagnostic-entry diagnostic-' + entry.level.toLowerCase()} key={entry.id}>
                            <div><strong>{entry.level}</strong><time>{entry.time}</time></div>
                            <b>{entry.source}</b><p>{entry.message}</p>
                            {entry.details && <pre>{entry.details}</pre>}
                          </article>)}
                        </div>
                        <div className="menu-info"><Info size={12}/><span>Live capture stays active even when this panel is collapsed. Monitors JavaScript errors, rejected promises, failed resources, relevant console warnings, WebGL context events, main-thread stalls, FPS drops, memory and WebGL load, plus Nexus3D viewport-control state. Native Android process crashes may not leave a JavaScript log. Maximum 400 recent entries.</span></div>
          
                        </section>}
        </section>
        <section className="menu-category dfi-core-section">
          <button type="button" className={'menu-option diagnostic-toggle-button ' + (dfiPanelOpen ? 'expanded' : '')}
            aria-expanded={dfiPanelOpen} onClick={() => setDfiPanelOpen(open => !open)}>
            <ScanEye size={13}/><span>NEXUS DFI CORE · FORENSIC ANALYZER</span>
            {dfiPanelOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
          </button>
          {dfiPanelOpen && <section className="diagnostic-panel-expanded" aria-label="Nexus DFI Core forensic analyzer">
            <div className="menu-subtitle">DEEP ROOT-CAUSE INVESTIGATION</div>
            <div className="diagnostic-summary"><span>{dfiSummary.findings} finding(s)</span><span>{dfiSummary.errors} error(s)</span><span>{dfiSummary.warnings} warning(s)</span></div>
            <div className="diagnostic-summary"><span>{dfiSummary.repeatedErrors} repeated signature(s)</span><span>{dfiSummary.invalidMeshes} integrity finding(s)</span></div>
            <div className="diagnostic-actions dfi-actions">
              <button type="button" onClick={() => void runDfiInvestigation()} disabled={dfiBusy}><ScanEye size={12}/> {dfiBusy ? 'INVESTIGATING…' : 'RUN DEEP ANALYSIS'}</button>
              <button type="button" onClick={() => void copyDiagnosticText([{ id: 'dfi-report', time: new Date().toLocaleTimeString(), level: dfiSummary.errors ? 'ERROR' : dfiSummary.warnings ? 'WARN' : 'INFO', source: 'DFI Core', message: 'Forensic investigation report', details: dfiReport }])} disabled={dfiReport.startsWith('No DFI investigation')}><ClipboardCopy size={12}/> COPY REPORT</button>
              <button type="button" onClick={() => { setDfiReport('No DFI investigation has been run yet.'); setDfiSummary({ findings: 0, errors: 0, warnings: 0, repeatedErrors: 0, invalidMeshes: 0 }); }}><RefreshCw size={12}/> RESET</button>
            </div>
            <pre className="core-optimizer-report dfi-report">{dfiReport}</pre>
            <div className="menu-info"><Info size={12}/><span>DFI correlates captured RDS errors, repeated failure signatures, live mesh integrity and the build-time source audit. It reports evidence and likely investigation leads, not guaranteed root causes. Git history, full dependency/data-flow analysis and native Android Logcat require repository/build-side tools. Read-only: no automatic fixes.</span></div>
          </section>}
        </section>
        <section className="menu-category core-optimizer-section">
          <button type="button" className={'menu-option diagnostic-toggle-button ' + (coreOptimizerOpen ? 'expanded' : '')}
            aria-expanded={coreOptimizerOpen} onClick={() => setCoreOptimizerOpen(open => !open)}>
            <Gauge size={13}/><span>NEXUS3D CORE OPTIMIZER</span>
            {coreOptimizerOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
          </button>
          {coreOptimizerOpen && <section className="diagnostic-panel-expanded" aria-label="Nexus3D Core Optimizer">
            <div className="menu-subtitle">ADVANCED RDS DIAGNOSTICS</div>
            <div className="diagnostic-summary"><span>{rdsScanSummary.checks} checks</span><span>{rdsScanSummary.errors} errors</span><span>{rdsScanSummary.warnings} warnings</span></div>
            <div className="diagnostic-actions core-optimizer-actions">
              <button type="button" onClick={runRdsFullScan} disabled={rdsScanBusy}><ScanEye size={12}/> {rdsScanBusy ? 'SCANNING…' : 'SCAN ALL MODULES'}</button>
              <button type="button" onClick={() => void loadRdsSourceAudit()}><Code2 size={12}/> LOAD SOURCE AUDIT</button>
              <button type="button" onClick={() => void copyDiagnosticText([{ id: 'rds-report', time: rdsLastScanAt || new Date().toLocaleTimeString(), level: rdsScanSummary.errors ? 'ERROR' : rdsScanSummary.warnings ? 'WARN' : 'INFO', source: 'RDS Full Core Scan', message: 'Full scan report', details: rdsScanReport + '\\n\\n' + rdsSourceAuditReport }])} disabled={!rdsLastScanAt}><ClipboardCopy size={12}/> COPY REPORT</button>
            </div>
            <pre className="core-optimizer-report">{rdsScanReport}</pre>
            <div className="menu-subtitle">BUILD-TIME SOURCE CONFLICT AUDIT</div>
            <pre className="core-optimizer-report">{rdsSourceAuditReport}</pre>
            <div className="menu-info"><Info size={12}/><span>Scans runtime modules, scene hierarchy, transform values, rig inventory, animation inventory, renderer resources, device capabilities, storage availability and registered API entry points. Read-only: no project or scene data is changed. Static source analysis and native Android crash logs are not included.</span></div>
            <div className="menu-subtitle">CORE PERFORMANCE PROFILE</div>
            <div className="menu-info"><Info size={12}/><span>Analyze first. Safe optimization changes renderer quality only; it never deletes scene objects, meshes, materials, bones, animation, or saved projects.</span></div>
            <div className="diagnostic-actions core-optimizer-actions">
              <button type="button" onClick={analyzeCoreSystem}><Activity size={12}/> ANALYZE</button>
              <button type="button" onClick={applyCoreOptimization} disabled={!coreOptimizerAnalyzed || performanceMode}><Gauge size={12}/> APPLY SAFE</button>
              <button type="button" onClick={() => { setCoreOptimizerReport('Run an analysis to inspect current runtime load.'); setCoreOptimizerAnalyzed(false); }}><RefreshCw size={12}/> RESET</button>
            </div>
            <pre className="core-optimizer-report">{coreOptimizerReport}</pre>
          </section>}
        </section>
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
              <button className="menu-option" onClick={() => modelFileRef.current?.click()}><Upload size={13} /><span>Import 3D Model / ZIP</span></button>
              <button className="menu-option" onClick={exportProject}><Download size={13} /><span>Export Scene JSON</span></button>
              <button className="menu-option" onClick={() => { void exportProjectZip(); }}><Download size={13} /><span>Export Project ZIP</span></button>
              <button className="menu-option" onClick={() => { void chooseProjectZip(); }}><FolderOpen size={13} /><span>Import Project ZIP</span></button>
              <input ref={projectZipFileRef} type="file" accept=".zip,application/zip" hidden onChange={e => { void chooseProjectZip(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              <input ref={projectFileRef} type="file" accept=".nexus,.json,application/json" hidden onChange={e => { handleProjectFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              <input ref={modelFileRef} type="file" multiple accept=".zip,application/zip,.gltf,.glb,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.fbx,.dae,.stl,.ply,.vrm,.bvh,model/gltf+json,model/gltf-binary,text/plain,image/*" hidden onChange={e => { const files = Array.from(e.target.files || []); const archive = files.find(file => /\.zip$/i.test(file.name)); const primary = files.find(file => /\.(gltf|glb|obj|fbx|dae|stl|ply|vrm|bvh)$/i.test(file.name)); if (archive) void importModelArchive(archive); else if (primary) void importModel(primary, files.filter(file => file !== primary)); else setStatus('Select a ZIP archive, or one supported 3D model with its companion files.'); e.currentTarget.value = ''; }} />
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
              <div className="menu-subtitle">APK MAINTENANCE</div>
              <button className="menu-option" onClick={() => { const next = !performanceMode; runtime.current?.setPerformanceMode?.(next); setPerformanceMode(next); setStatus(next ? 'Performance Mode enabled · reduced GPU load' : 'Performance Mode disabled · standard quality restored'); }}><Gauge size={13}/><span>{performanceMode ? 'Disable Performance Mode' : 'Optimize Performance'}</span></button>
              <button className="menu-option" onClick={clearNexusCache} disabled={maintenanceBusy || !Capacitor.isNativePlatform()}><Trash2 size={13}/><span>{maintenanceBusy ? 'Clearing Cache…' : 'Clear Temporary APK Cache'}</span></button>
              <div className="menu-info"><Info size={13}/><span>Cache clearing removes temporary WebView/cache files only. It does not erase saved projects or imported assets. Performance Mode lowers render resolution and disables real-time shadows until switched off.</span></div>
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
        </div>
        <div className="panel-bottom-bar" aria-label="Menu Panel resize control"><button type="button" className="panel-resize-handle" aria-label="Resize Menu Panel horizontally" title="Drag right to widen panel" onPointerDown={beginPanelResize} onPointerMove={movePanelResize} onPointerUp={endPanelResize} onPointerCancel={endPanelResize}><span /></button></div>
      </aside>}

      {panel && !cameraView && <aside className="hierarchy-panel" style={{ "--nexus-panel-width": sharedPanelWidth + "px" } as React.CSSProperties}>
        <div className="panel-heading"><div><Layers size={13} /><span>Scenes Tree</span></div><div className="tree-manager-tools"><button type="button" title="Duplicate selected object" aria-label="Duplicate selected object" disabled={!selected || cameraView} onClick={() => { const obj = items.find(entry => entry.id === selected)?.object; if (obj) duplicateTreeObject(obj); }}><Copy size={12}/></button><button type="button" title="Group selected object" aria-label="Group selected object" disabled={!selected || cameraView} onClick={() => { const obj = items.find(entry => entry.id === selected)?.object; if (obj) groupTreeObject(obj); }}><FolderPlus size={12}/></button><button type="button" title="Delete selected object" aria-label="Delete selected object" disabled={!selected || cameraView} onClick={() => { const obj = items.find(entry => entry.id === selected)?.object; if (obj) deleteTreeObject(obj); }}><Trash2 size={12}/></button><span className="count">{items.length.toString().padStart(2, '0')}</span></div></div>
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
            return <div key={item.id} data-tree-id={item.id} className={'tree-row ' + (selected === item.id ? 'selected ' : '') + (dragTargetId === item.id ? 'drop-target ' : '') + (treeActionId === item.id ? 'menu-open' : '')}
              draggable={!('ontouchstart' in window)}
              onContextMenu={e => { if ('ontouchstart' in window) e.preventDefault(); }}
              onSelectStart={e => { if ('ontouchstart' in window) e.preventDefault(); }}
              onDragStart={e => { e.dataTransfer.setData('text/nexus3d-object', item.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDragTargetId(item.id); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragTargetId(''); }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragTargetId(''); const childId = e.dataTransfer.getData('text/nexus3d-object'); const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); if (!child || child === item.object) return; const rect = e.currentTarget.getBoundingClientRect(); const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1); runtime.current?.reorderObject(child, item.object, ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside'); }}
              onTouchStart={e => {
                if ((e.target as HTMLElement).closest('.tree-row-actions, .tree-eye, .tree-item-action, .tree-rename-inline')) {
                  if (touchDragTimer.current) clearTimeout(touchDragTimer.current);
                  touchDragTimer.current = null;
                  touchDragOrigin.current = null;
                  return;
                }
                const touch = e.touches[0];
                if (!touch) return;
                touchDragActive.current = false;
                touchDragId.current = '';
                touchDragOrigin.current = { x: touch.clientX, y: touch.clientY };
                touchPoint.current = { x: touch.clientX, y: touch.clientY };
                if (touchDragTimer.current) clearTimeout(touchDragTimer.current);
                touchDragTimer.current = setTimeout(() => {
                  touchDragId.current = item.id;
                  touchDragActive.current = true;
                  setDragTargetId(item.id);
                }, 450);
              }}
              onTouchMove={e => {
                const touch = e.touches[0];
                if (!touch) return;
                if (!touchDragActive.current) {
                  const origin = touchDragOrigin.current;
                  if (origin && Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > 10) {
                    if (touchDragTimer.current) clearTimeout(touchDragTimer.current);
                    touchDragTimer.current = null;
                    touchDragOrigin.current = null;
                  }
                  return;
                }
                e.preventDefault();
                touchPoint.current = { x: touch.clientX, y: touch.clientY };
                const hit = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-tree-id]') as HTMLElement | null;
                setDragTargetId(hit?.dataset.treeId || '');
              }}
              onTouchEnd={e => {
                if (touchDragTimer.current) clearTimeout(touchDragTimer.current);
                touchDragTimer.current = null;
                const wasDragging = touchDragActive.current;
                touchDragActive.current = false;
                touchDragOrigin.current = null;
                const touch = e.changedTouches[0];
                const point = touchPoint.current || (touch ? { x: touch.clientX, y: touch.clientY } : null);
                const childId = touchDragId.current;
                touchDragId.current = '';
                touchPoint.current = null;
                setDragTargetId('');
                // Tap selection is handled in onTouchEndCapture on the button,
                // before this row-level handler clears the touch origin. This handler
                // is reserved for completed long-press drag gestures.
                if (!wasDragging) return;
                if (!point || !childId) return;
                const rootHit = document.elementFromPoint(point.x, point.y)?.closest('.tree-root');
                const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-tree-id]') as HTMLElement | null;
                const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId);
                const target = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === hit?.dataset.treeId);
                const treePanel = document.querySelector('.hierarchy-panel') as HTMLElement | null;
                 const panelRect = treePanel?.getBoundingClientRect();
                 const outsideTree = Boolean(panelRect && (point.x < panelRect.left || point.x > panelRect.right || point.y < panelRect.top || point.y > panelRect.bottom));
                 if (child && (rootHit || outsideTree)) runtime.current?.reparentObject(child);
                else if (child && target && child !== target) {
                  const rect = hit!.getBoundingClientRect();
                  const ratio = (point.y - rect.top) / Math.max(rect.height, 1);
                  runtime.current?.reorderObject(child, target, ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside');
                }
              }}
              onTouchCancel={() => {
                if (touchDragTimer.current) clearTimeout(touchDragTimer.current);
                touchDragTimer.current = null;
                touchDragActive.current = false;
                touchDragId.current = '';
                touchPoint.current = null;
                touchDragOrigin.current = null;
                setDragTargetId('');
              }}>
              {renamingTreeId === item.id ? <div className="tree-rename-inline" style={{ paddingLeft: 5 + depth * 12 }}>
                <input aria-label={'Rename ' + item.name} autoFocus value={renameTreeDraft} onChange={e => setRenameTreeDraft(e.target.value)} onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }} onBlur={() => commitTreeRename(item.object)} />
              </div> : <button className={'tree-item ' + (selected === item.id ? 'selected' : '')} style={{ paddingLeft: 5 + depth * 12 }} onTouchEndCapture={e => { if (!touchDragOrigin.current || touchDragActive.current || cameraView) return; setSelected(item.id); runtime.current?.selectObject(item.object); }} onPointerDown={e => { e.stopPropagation(); if (!cameraView) { setSelected(item.id); runtime.current?.selectObject(item.object); } }} onClick={e => { e.stopPropagation(); if (!cameraView) { setSelected(item.id); runtime.current?.selectObject(item.object); } }} disabled={cameraView}>
                {hasChildren ? <span className="tree-expand" onClick={e => { e.stopPropagation(); setExpanded(prev => ({ ...prev, [item.id]: prev[item.id] === false })); }}>{expanded[item.id] === false ? <ChevronRight size={11} /> : <ChevronDown size={11} />}</span> : <span className="tree-expand empty" />}
                {item.kind === 'Group' ? <Folder size={13} /> : item.kind === 'Sphere' ? <Circle size={13} /> : item.kind === 'Cylinder' ? <Cylinder size={13} /> : item.kind === 'Cone' ? <Cone size={13} /> : item.kind === 'Torus' ? <Circle size={13} /> : item.kind === 'Camera' ? <Film size={13} /> : <Box size={13} />}
                <span className="tree-name">{item.name}</span>{selected === item.id && <span className="tree-selected-dot" />}
              </button>}
              <button type="button" className="tree-eye" aria-label={(item.object.visible ? 'Hide ' : 'Show ') + item.name} title={item.object.visible ? 'Hide object' : 'Show object'} onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); item.object instanceof THREE.Bone ? runtime.current?.toggleBoneDisplay(item.object) : runtime.current?.toggleVisibility(item.object); }}>{(item.object instanceof THREE.Bone ? runtime.current?.isBoneDisplayVisible(item.object) : item.object.visible) ? <Eye size={12} /> : <EyeOff size={12} />}</button>
              <div className="tree-row-actions">
                <button type="button" className={'tree-row-action ' + (item.object.userData.objectManagerLocked ? 'locked' : '')} aria-label={(item.object.userData.objectManagerLocked ? 'Unlock ' : 'Lock ') + item.name} title={item.object.userData.objectManagerLocked ? 'Unlock transforms' : 'Lock transforms'} onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggleTreeObjectLock(item.object); }}>{item.object.userData.objectManagerLocked ? <Lock size={11}/> : <Unlock size={11}/>}</button>
                <button type="button" className="tree-row-action" aria-label={'Duplicate ' + item.name} title="Duplicate object" disabled={item.object.userData.kind === 'Camera'} onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); duplicateTreeObject(item.object); }}><Copy size={11}/></button>
                <button type="button" className={'tree-row-action ' + (treeActionId === item.id ? 'active' : '')} aria-label={'More actions for ' + item.name} title="More object actions" onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setTreeActionId(current => current === item.id ? '' : item.id); }}><MoreHorizontal size={13}/></button>
                {treeActionId === item.id && <div className="tree-more-menu" onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
                  <button type="button" onClick={() => { renameTreeObject(item.object); setTreeActionId(''); }}><Pencil size={11}/> Rename</button>
                  {item.object.userData.kind === 'Group' ? <button type="button" onClick={() => { ungroupTreeObject(item.object); setTreeActionId(''); }}><Folder size={11}/> Ungroup</button> : <>
                    <button type="button" disabled={item.object.userData.kind === 'Camera' || item.object instanceof THREE.Bone || Boolean(item.object.userData.rigControlMarker)} onClick={() => { groupTreeObject(item.object); setTreeActionId(''); }}><FolderPlus size={11}/> Create Group</button>
                    {items.some(entry => entry.object.userData.kind === 'Group' && entry.object !== item.object && !(() => { let p: THREE.Object3D | null = entry.object.parent; while (p) { if (p === item.object) return true; p = p.parent; } return false; })()) && <div className="tree-group-targets"><span>Add to existing Group</span>
                      {items.filter(entry => entry.object.userData.kind === 'Group' && entry.object !== item.object && entry.object !== item.object.parent && !(() => { let p: THREE.Object3D | null = entry.object; while (p) { if (p === item.object) return true; p = p.parent; } return false; })()).map(entry => <button type="button" key={entry.id} onClick={() => { addTreeObjectToExistingGroup(item.object, entry.object); setTreeActionId(''); }}><Folder size={11}/> {entry.name}</button>)}
                    </div>}
                  </>}
                  <button type="button" className="danger" disabled={item.object.userData.kind === 'Camera'} onClick={() => { deleteTreeObject(item.object); setTreeActionId(''); }}><Trash2 size={11}/> Delete</button>
                </div>}
              </div>
            </div>;
          })}
        </div>
        <div className="panel-bottom-bar" aria-label="Scene Tree resize control"><button type="button" className="panel-resize-handle" aria-label="Resize Scene Tree panel horizontally" title="Drag right to widen panel" onPointerDown={beginPanelResize} onPointerMove={movePanelResize} onPointerUp={endPanelResize} onPointerCancel={endPanelResize}><span /></button></div>
      </aside>}





      <div className="right-rail">
        <button className={'rail-btn ' + (cameraView ? 'active' : '')} onClick={toggleCamera} title={cameraView ? 'Return to User View' : 'Directly view through MainCamera'}><Camera size={17} /><span>{cameraView ? 'USER' : 'CAM'}</span></button>
        <button className={'rail-btn animation-rail-btn ' + (animationMode ? 'active' : '')} onClick={() => { if (animationMode) { setPlaybackControlsOpen(v => !v); } else { if (!cameraView) toggleCamera(); setPlaying(false); setAnimationMode(true); setAnimationObjectsOpen(true); setAnimOpen(false); setPlaybackControlsOpen(false); setTimelineOptionsOpen(false); } }} title={animationMode ? (playbackControlsOpen ? 'Hide playback controls' : 'Show playback controls') : 'Open Animation System Viewport'} aria-label="Toggle Animation Mode"><Film size={17} /><span>ANIM</span></button>
        <button className={'rail-btn rig-rail-btn ' + (riggingView ? 'active' : '')} onClick={toggleRiggingWorkspace} title={riggingView ? 'Return to User Workspace' : 'Switch to IK Rigging Workspace · Front Perspective'} aria-label="Rigging workspace"><GitBranch size={17}/><span>{riggingView ? 'USER' : 'RIG'}</span></button>
      </div>

      

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
