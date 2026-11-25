import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import * as THREE from 'three';
import { configureDirectionalShadow } from './lighting/shadow-optimization.mjs';
import { getIkSolvePath, isIkBoneLocked } from './rig/ik-constraints.mjs';
import { buildCharacterMeshAssignments, summarizeCharacterAssignments, isCharacterMeshCandidate } from './rig/character-rigging.mjs';
import { buildTopologyFromCanonicalQuadGeometry, buildTopologyFromIndexedQuadGeometry, updateTopologyPositionsFromRenderGeometry } from './geometry/topology-model.mjs';
import { createSubObjectLockStore } from './geometry/subobject-lock-store.mjs';
import { allocateShapeIdentity, ensureShapeIdentity, formatShapeIdentity } from './identity/shape-identity.mjs';
import { assignShapeOwnership } from './identity/shape-ownership.mjs';
import { collectReservedIdentityIds } from './identity/import-identity-reservations.mjs';
import { remapImportedIdentityReferences } from './identity/import-identity-reference-remap.mjs';
import { reserveImportedShapeIds } from './identity/import-shape-id-reservations.mjs';
import { validateProjectIdentityData } from './identity/project-identity-validation.mjs';
import { collectObjectOnlyProjectNodes, getObjectOnlyProjectRoots, isShapeProjectMesh } from './project/object-project-scope.mjs';
import { getNexusRenderPixelRatio } from './performance/render-budget.mjs';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import JSZip from 'jszip';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkeletonHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  Box, Camera, Circle, Copy, Cuboid, Cylinder, Cone, Focus, Globe, Grid2X2,
  Layers, Maximize, Move, Rotate3D, Scaling, Trash2, Magnet, Gauge,
  Play, Pause, Rewind, ClipboardCopy, ClipboardPaste, Undo2, Redo2,
  Film, Lightbulb, X, Check, Eye, EyeOff, Search, ChevronDown, ChevronRight, Download,
  Save, FolderOpen, FileJson, FileText, Settings2, Info, Keyboard, Sun, Flashlight, Palette, Upload,
  Sparkles, Waves, Aperture, SlidersHorizontal, CloudFog, ScanEye, Lock, Unlock, Scissors, GitBranch,
  Plus, Target, Link2, Unlink, RefreshCw, GitMerge, Activity, Code2, Folder, FolderPlus, MoreHorizontal, Pencil, ScanSearch,
} from 'lucide-react';
import { scanMeshCore, formatMeshForensicReport } from './dfi/mesh-forensics';
import { CLEAN_FLAT_SURFACE_EDGE_ANGLE_DEGREES } from './geometry/clean-flat-surface-contract';
import { scanGeometryRit, formatGeometryRitReport } from './geometry/geometry-rit';
import { RUNTIME_SESSION_ID, RUNTIME_SESSION_STARTED_AT, createRuntimeEventMetadata, formatRuntimeTraceReport } from './diagnostics/runtime-session.mjs';
import { inferTracePoint, filterDiagnosticEntries, formatDiagnosticReport, summarizeFrameTimes } from './diagnostics/logcat-diagnostics.mjs';
import { buildRdsExportFiles } from './diagnostics/rds-export.mjs';
import { loadLogcatEntries, loadRitTraceEntries, saveLogcatEntries, saveRitTraceEntries, clearLogcatEntries, clearRitTraceEntries } from './diagnostics/independent-diagnostic-stores.mjs';
import { buildRdsNoticeSection } from './diagnostics/rds-notice.mjs';
import './index.css';

function createProjectMaterial(data: any): THREE.Material {
  const constructors: Record<string, any> = {
    MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
    MeshStandardMaterial: THREE.MeshStandardMaterial,
    MeshPhongMaterial: THREE.MeshPhongMaterial,
    MeshLambertMaterial: THREE.MeshLambertMaterial,
    MeshBasicMaterial: THREE.MeshBasicMaterial,
    MeshToonMaterial: THREE.MeshToonMaterial,
    MeshMatcapMaterial: THREE.MeshMatcapMaterial,
    MeshNormalMaterial: THREE.MeshNormalMaterial,
    ShadowMaterial: THREE.ShadowMaterial
  };
  const Constructor = constructors[data?.type] || THREE.MeshPhysicalMaterial;
  const material = new Constructor({
    color: data?.color ? '#' + data.color : '#b6d8ff',
    roughness: Number.isFinite(data?.roughness) ? data.roughness : 0.35,
    metalness: Number.isFinite(data?.metalness) ? data.metalness : 0.18,
    opacity: Number.isFinite(data?.opacity) ? data.opacity : 1,
    transparent: Boolean(data?.transparent),
    emissive: data?.emissive ? '#' + data.emissive : '#000000',
    emissiveIntensity: Number.isFinite(data?.emissiveIntensity) ? data.emissiveIntensity : 0,
    clearcoat: Number.isFinite(data?.clearcoat) ? data.clearcoat : 0,
    clearcoatRoughness: Number.isFinite(data?.clearcoatRoughness) ? data.clearcoatRoughness : 0,
    transmission: Number.isFinite(data?.transmission) ? data.transmission : 0,
    ior: Number.isFinite(data?.ior) ? data.ior : 1.5,
    sheen: Number.isFinite(data?.sheen) ? data.sheen : 0,
    sheenRoughness: Number.isFinite(data?.sheenRoughness) ? data.sheenRoughness : 1,
    side: Number.isFinite(data?.side) ? data.side : THREE.FrontSide,
    wireframe: Boolean(data?.wireframe),
    vertexColors: Boolean(data?.vertexColors),
    flatShading: Boolean(data?.flatShading),
    shininess: Number.isFinite(data?.shininess) ? data.shininess : 30,
    specular: data?.specular ? '#' + data.specular : '#111111',
    reflectivity: Number.isFinite(data?.reflectivity) ? data.reflectivity : 0.5,
    refractionRatio: Number.isFinite(data?.refractionRatio) ? data.refractionRatio : 0.98,
    alphaTest: Number.isFinite(data?.alphaTest) ? data.alphaTest : 0,
    depthWrite: data?.depthWrite !== false,
    depthTest: data?.depthTest !== false
  });
  material.name = typeof data?.name === 'string' ? data.name : '';
  if (data?.userData && typeof data.userData === 'object') material.userData = JSON.parse(JSON.stringify(data.userData));
  return material as THREE.Material;
}

type NexusProjectFilesPlugin = {
  stageProject(options: { content: string }): Promise<{ stagedId: string; stagedBytes: number }>;
  saveProject(options: { fileName: string; stagedId: string }): Promise<{ uri: string; name: string; writtenBytes?: number; overwritten?: boolean }>;
  loadProject(): Promise<{ content: string; name: string }>;
  loadProjectArchive(): Promise<{ base64: string; name: string }>;
  saveProjectArchive(options: { fileName: string; base64: string }): Promise<{ uri: string; name: string; writtenBytes?: number; overwritten?: boolean }>;
  saveRdsArchive(options: { fileName: string; base64: string }): Promise<{ uri: string; name: string; path: string; writtenBytes: number }>;
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

type DiagnosticEntry = { id: string; time: string; level: 'VERBOSE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'; source: string; message: string; details?: string; sessionId?: string; sequence?: number; timestampISO?: string; origin?: 'USER_ACTION' | 'AUTO_PROCESS' | 'RESTORE' | 'SYSTEM' | 'UNKNOWN_ORIGIN'; componentTag?: string; tracePoint?: string; objectId?: string };
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
  const [ikSpringPanelOpen, setIkSpringPanelOpen] = useState(false);
  const [characterRigPanelOpen, setCharacterRigPanelOpen] = useState(false);
  const [ikSpringEnabled, setIkSpringEnabled] = useState(false);
  const [ikSpringStrength, setIkSpringStrength] = useState(35);
  const [ikSpringDamping, setIkSpringDamping] = useState(75);
  const [ikSpringFollowThrough, setIkSpringFollowThrough] = useState(40);
  const selectedRef = useRef('');
  const [smoothSelectAllId, setSmoothSelectAllId] = useState('');
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const modeRef = useRef<'translate' | 'rotate' | 'scale'>('translate');
  const [space, setSpace] = useState<'world' | 'local'>('world');
  const spaceRef = useRef<'world' | 'local'>('world');
  const [panel, setPanel] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  // Scene Tree and Menu are independent Mother Panels with fixed top-left anchors.
  const [treePanelWidth, setTreePanelWidth] = useState(172);
  const [menuPanelWidth, setMenuPanelWidth] = useState(172);
  const initialPanelHeight = () => Math.max(220, Math.min(480, window.innerHeight - 120));
  const [treePanelHeight, setTreePanelHeight] = useState(initialPanelHeight);
  const [menuPanelHeight, setMenuPanelHeight] = useState(initialPanelHeight);
  const panelResizeStart = useRef<{ x: number; y: number; width: number; height: number; pointerId: number } | null>(null);
  const panelResizeMoveRef = useRef<((event: PointerEvent) => void) | null>(null);
  const panelResizeEndRef = useRef<((event: PointerEvent) => void) | null>(null);
  const beginPanelResize = (event: React.PointerEvent<HTMLButtonElement>, targetPanel: 'tree' | 'menu', axis: 'width' | 'height') => {
    event.preventDefault();
    event.stopPropagation();
    if (panelResizeMoveRef.current) window.removeEventListener('pointermove', panelResizeMoveRef.current);
    if (panelResizeEndRef.current) {
      window.removeEventListener('pointerup', panelResizeEndRef.current);
      window.removeEventListener('pointercancel', panelResizeEndRef.current);
    }
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: targetPanel === 'tree' ? treePanelWidth : menuPanelWidth,
      height: targetPanel === 'tree' ? treePanelHeight : menuPanelHeight,
      pointerId: event.pointerId,
      handle: event.currentTarget,
      dragging: false
    };
    panelResizeStart.current = start;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      moveEvent.preventDefault();
      if (!start.dragging && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 3) {
        start.dragging = true;
        start.handle.classList.add('is-dragging');
      }
      if (axis === 'height') {
        // The top-left anchor stays fixed; only the bottom edge follows the grip.
        const maxHeight = Math.max(180, window.innerHeight - 52 - 48);
        const nextHeight = Math.max(180, Math.min(maxHeight, start.height + moveEvent.clientY - start.y));
        if (targetPanel === 'tree') setTreePanelHeight(nextHeight);
        else setMenuPanelHeight(nextHeight);
      } else {
        // The left edge stays fixed; only the right edge follows the grip.
        const maxWidth = Math.max(180, Math.min(420, Math.floor(window.innerWidth * 0.48)));
        const nextWidth = Math.max(150, Math.min(maxWidth, start.width + moveEvent.clientX - start.x));
        if (targetPanel === 'tree') setTreePanelWidth(nextWidth);
        else setMenuPanelWidth(nextWidth);
      }
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== start.pointerId) return;
      panelResizeStart.current = null;
      start.handle.classList.remove('is-dragging');
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

  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticEntry[]>(() => loadLogcatEntries(localStorage));
  const [ritTraceLogs, setRitTraceLogs] = useState<DiagnosticEntry[]>(() => loadRitTraceEntries(localStorage));
  const [diagnosticFilter, setDiagnosticFilter] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO'>('ALL');
  const [logcatPaused, setLogcatPaused] = useState(false);
  const [logcatSnapshot, setLogcatSnapshot] = useState<DiagnosticEntry[]>([]);
  const [logcatSearch, setLogcatSearch] = useState('');
  const [logcatLevel, setLogcatLevel] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'VERBOSE' | 'FATAL'>('ALL');
  const [logcatSourceFilter, setLogcatSourceFilter] = useState('');
  const [logcatTagFilter, setLogcatTagFilter] = useState('');
  const [logcatTracePointFilter, setLogcatTracePointFilter] = useState('ALL');
  const [logcatObjectFilter, setLogcatObjectFilter] = useState('');
  const [logcatSessionFilter, setLogcatSessionFilter] = useState('');
  const [logcatFromFilter, setLogcatFromFilter] = useState('');
  const [logcatToFilter, setLogcatToFilter] = useState('');
  const [logcatRegex, setLogcatRegex] = useState(false);
  const [diagnosticPanelOpen, setDiagnosticPanelOpen] = useState(false);
  const [rdsPanelOpen, setRdsPanelOpen] = useState(false);
  const [rdsActiveTool, setRdsActiveTool] = useState('Overview');
  const [rdsPanelWidth, setRdsPanelWidth] = useState(() => Math.min(360, Math.max(280, window.innerWidth - 18)));
  const [rdsPanelHeight, setRdsPanelHeight] = useState(() => Math.min(Math.round(window.innerHeight * 0.48), Math.max(180, window.innerHeight - 78)));
  const [rdsExportBusy, setRdsExportBusy] = useState(false);
  const [rdsExportProgress, setRdsExportProgress] = useState(0);
  const [rdsExportPhase, setRdsExportPhase] = useState<'idle' | 'building' | 'saving' | 'verifying' | 'passed' | 'done' | 'failed'>('idle');
  const rdsResizeRef = useRef<{ axis: 'width' | 'height'; x: number; y: number; width: number; height: number; pointerId: number } | null>(null);
  const beginRdsPanelResize = (event: React.PointerEvent<HTMLButtonElement>, axis: 'width' | 'height') => {
    event.preventDefault();
    event.stopPropagation();
    const start = { axis, x: event.clientX, y: event.clientY, width: rdsPanelWidth, height: rdsPanelHeight, pointerId: event.pointerId };
    rdsResizeRef.current = start;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      moveEvent.preventDefault();
      if (axis === 'width') {
        const maxWidth = Math.max(280, Math.min(760, window.innerWidth - 18));
        setRdsPanelWidth(Math.max(280, Math.min(maxWidth, start.width + start.x - moveEvent.clientX)));
      } else {
        const maxHeight = Math.max(180, window.innerHeight - 78);
        setRdsPanelHeight(Math.max(180, Math.min(maxHeight, start.height + start.y - moveEvent.clientY)));
      }
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== start.pointerId) return;
      rdsResizeRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const [interactionTraceOpen, setInteractionTraceOpen] = useState(false);
  const diagnosticSinkRef = useRef<(level: DiagnosticEntry['level'], source: string, message: string, details?: string) => void>(() => {});
  const diagnosticQueueRef = useRef<DiagnosticEntry[]>([]);
  const interactionTraceQueueRef = useRef<DiagnosticEntry[]>([]);
  const pushDiagnostic = (level: DiagnosticEntry['level'], source: string, message: string, details?: string) => {
    const timestamp = new Date();
    const metadata = createRuntimeEventMetadata(source, message, timestamp);
    let objectId: string | undefined;
    try {
      const parsed = details ? JSON.parse(details) : null;
      objectId = parsed?.objectId || parsed?.selectedId || parsed?.selectedObjectId;
    } catch { /* details may be plain text */ }
    const entry: DiagnosticEntry = {
      id: uid(), time: timestamp.toLocaleTimeString(), level, source,
      message: String(message).slice(0, 1200),
      details: details ? String(details).slice(0, 5000) : undefined,
      componentTag: source,
      tracePoint: inferTracePoint(source, message, rdsActiveTool),
      objectId,
      timestampISO: timestamp.toISOString(),
      ...metadata
    };
    const queue = source === 'Interaction Trace' ? interactionTraceQueueRef.current : diagnosticQueueRef.current;
    queue.push(entry);
    if (queue.length > 100) queue.splice(0, queue.length - 100);
  };
  const clearDiagnosticLogs = () => {
    diagnosticQueueRef.current = [];
    setDiagnosticLogs([]);
    setLogcatSnapshot([]);
    clearLogcatEntries(localStorage);
    setStatus('Cleared LogCat events · RIT Trace preserved');
  };
  const clearInteractionTraceLogs = () => {
    interactionTraceQueueRef.current = [];
    setRitTraceLogs([]);
    clearRitTraceEntries(localStorage);
    setStatus('Cleared RIT Trace events · LogCat preserved');
  };
  diagnosticSinkRef.current = pushDiagnostic;
  const recordInteractionTrace = (action: string, details: Record<string, unknown> = {}) => {
    diagnosticSinkRef.current('INFO', 'Interaction Trace', action, JSON.stringify(details));
  };
  const flush = () => {
    const logBatch = diagnosticQueueRef.current.splice(0, 100);
    const traceBatch = interactionTraceQueueRef.current.splice(0, 100);
    if (logBatch.length) setDiagnosticLogs(previous => {
      const next = [...previous, ...logBatch].slice(-400);
      saveLogcatEntries(localStorage, next);
      return next;
    });
    if (traceBatch.length) setRitTraceLogs(previous => {
      const next = [...previous, ...traceBatch].slice(-400);
      saveRitTraceEntries(localStorage, next);
      return next;
    });
  };
  useEffect(() => {
    const timer = window.setInterval(flush, 1000);
    return () => { window.clearInterval(timer); flush(); };
  }, []);
  const copyDiagnosticText = async (entries: DiagnosticEntry[]) => {
    const report = formatRuntimeTraceReport(entries, { sessionId: RUNTIME_SESSION_ID, startedAt: RUNTIME_SESSION_STARTED_AT });
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
  const getLogcatEntries = () => [...diagnosticLogs, ...diagnosticQueueRef.current].slice(-400);
  const visibleLogcatEntries = filterDiagnosticEntries(logcatPaused ? logcatSnapshot : getLogcatEntries(), {
    level: logcatLevel, query: logcatSearch, source: logcatSourceFilter, tag: logcatTagFilter,
    tracePoint: logcatTracePointFilter, objectId: logcatObjectFilter, sessionId: logcatSessionFilter,
    from: logcatFromFilter, to: logcatToFilter, regex: logcatRegex
  }) as DiagnosticEntry[];
  const getRitTraceEntries = () => [...ritTraceLogs, ...interactionTraceQueueRef.current].slice(-400);
  const pauseLogcat = () => { setLogcatSnapshot(getLogcatEntries()); setLogcatPaused(true); };
  const resumeLogcat = () => setLogcatPaused(false);
  const refreshLogcat = () => { flush(); setStatus('LogCat refreshed'); };
  const exportRdsToolZip = async (tool: string) => {
    if (rdsExportBusy) return;
    setRdsExportBusy(true);
    setRdsExportProgress(0);
    setRdsExportPhase('building');
    try {
      const allLogs = [...diagnosticLogs, ...diagnosticQueueRef.current].slice(-400);
      const logcatEntries = getLogcatEntries();
      const ritEntries = getRitTraceEntries();
      let entries: DiagnosticEntry[] = [];
      let fullReport = '';
      switch (tool) {
        case 'Overview':
          entries = allLogs;
          fullReport = [
            'NEXUS3D RDS · SYSTEM OVERVIEW',
            'Generated: ' + new Date().toISOString(),
            'Runtime events: ' + allLogs.length,
            'Errors: ' + allLogs.filter(entry => entry.level === 'ERROR' || entry.level === 'FATAL').length,
            'Warnings: ' + allLogs.filter(entry => entry.level === 'WARN').length,
            'Scene objects: ' + items.length,
            'Latest full scan: ' + (rdsLastScanAt || 'Not scanned'),
            '',
            rdsScanReport,
            '',
            dfiReport
          ].join('\n');
          break;
        case 'Runtime':
          entries = allLogs;
          fullReport = formatDiagnosticReport(allLogs, { sessionId: RUNTIME_SESSION_ID });
          break;
        case 'LogCat':
          entries = logcatEntries;
          fullReport = formatDiagnosticReport(logcatEntries, { sessionId: RUNTIME_SESSION_ID });
          break;
        case 'RIT Trace':
          entries = ritEntries;
          fullReport = formatRuntimeTraceReport(ritEntries);
          break;
        case 'DFI Core':
          entries = allLogs.filter(entry => /DFI Core|DFI Investigation/i.test(entry.source));
          fullReport = dfiReport;
          break;
        case 'Mesh DFI':
          entries = allLogs.filter(entry => /Shape Core|Mesh DFI|Mesh Integrity/i.test(entry.source));
          fullReport = dfiToolReports['Shape Core'] || 'Mesh integrity scan has not been run yet.';
          break;
        case 'Root Cause':
          entries = allLogs.filter(entry => /DFI Core|Root Cause|RDS Scanner/i.test(entry.source));
          fullReport = dfiReport;
          break;
        case 'Source Audit':
          entries = allLogs.filter(entry => /Source Audit|RDS Source Audit/i.test(entry.source));
          fullReport = rdsSourceAuditReport;
          break;
        case 'Reports':
          entries = allLogs;
          fullReport = [
            'NEXUS3D RDS · CONSOLIDATED REPORTS',
            'Generated: ' + new Date().toISOString(),
            '',
            'FULL CORE SCAN',
            rdsScanReport,
            '',
            'SOURCE AUDIT',
            rdsSourceAuditReport,
            '',
            'DFI INVESTIGATION',
            dfiReport,
            '',
            'SCENE / SHAPE WORKFLOW SUMMARY',
            buildSceneWorkflowSummary()
          ].join('\n');
          break;
        default:
          entries = allLogs;
          fullReport = formatDiagnosticReport(allLogs, { sessionId: RUNTIME_SESSION_ID });
      }
      const generatedAt = new Date().toISOString();
      const exportFiles = buildRdsExportFiles({
        tool, fullReport, entries,
        metadata: {
          generatedAt, app: 'Nexus3D', sessionId: RUNTIME_SESSION_ID,
          sessionStartedAt: RUNTIME_SESSION_STARTED_AT, platform: Capacitor.getPlatform(),
          nativeApp: Capacitor.isNativePlatform(), online: navigator.onLine,
          userAgent: navigator.userAgent, eventCount: entries.length
        }
      });
      const zip = new JSZip();
      const localGeneratedAt = new Date(generatedAt);
      const timeFolder = localGeneratedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, '').toLowerCase();
      const dateFolder = [String(localGeneratedAt.getMonth() + 1).padStart(2, '0'), String(localGeneratedAt.getDate()).padStart(2, '0'), localGeneratedAt.getFullYear()].join('-');
      const toolFolder = 'Nexus3D_' + tool.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      const archiveFolder = zip.folder(toolFolder)?.folder(timeFolder)?.folder(dateFolder);
      if (!archiveFolder) throw new Error('Unable to create RDS ZIP folder structure');
      Object.entries(exportFiles).forEach(([name, content]) => archiveFolder.file(name, content));
      const filename = toolFolder + '_' + timeFolder + '_' + dateFolder + '.zip';
      if (Capacitor.isNativePlatform()) {
        const base64 = await zip.generateAsync(
          { type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } },
          metadata => setRdsExportProgress(Math.min(85, Math.floor(metadata.percent * 0.85)))
        );
        setRdsExportPhase('saving');
        setRdsExportProgress(90);
        const saved = await NexusProjectFiles.saveRdsArchive({ fileName: filename, base64 });
        const verifiedBytes = Number(saved.writtenBytes) || 0;
        setRdsExportPhase('verifying');
        setRdsExportProgress(94);
        const normalizeAndroidName = (value: unknown) => String(value || '').replace(/:/g, '_').trim();
        const normalizeAndroidPath = (value: unknown) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '');
        const expectedPath = 'Documents/Nexus3D/' + filename;
        if (!saved.uri || verifiedBytes <= 0 || normalizeAndroidName(saved.name) !== normalizeAndroidName(filename) || normalizeAndroidPath(saved.path) !== normalizeAndroidPath(expectedPath)) {
          throw new Error('Android ZIP verification mismatch · name=' + String(saved.name || 'missing') + ' · path=' + String(saved.path || 'missing') + ' · bytes=' + verifiedBytes);
        }
        const verifiedArchive = await JSZip.loadAsync(base64, { base64: true, checkCRC32: true });
        const requiredFiles = ['Full_Report.txt', 'Errors.txt', 'Warnings.txt', 'Summary.txt', 'Metadata.txt'];
        const archiveRoot = toolFolder + '/' + timeFolder + '/' + dateFolder + '/';
        const missingFiles = requiredFiles.filter(name => !verifiedArchive.file(archiveRoot + name));
        if (missingFiles.length) throw new Error('ZIP content verification failed · missing ' + missingFiles.join(', '));
        setRdsExportPhase('passed');
        setRdsExportProgress(99);
        setRdsExportProgress(100);
        setRdsExportPhase('done');
        setStatus('SUCCESS · Verified ' + String(saved.name || filename) + ' · Internal Storage/Documents/Nexus3D · ' + verifiedBytes.toLocaleString() + ' bytes');
        diagnosticSinkRef.current('INFO', 'RDS Export', tool + ' ZIP report saved and verified', saved.uri + ' · ' + verifiedBytes + ' bytes');
      } else {
        const blob = await zip.generateAsync(
          { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
          metadata => setRdsExportProgress(Math.floor(metadata.percent))
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = filename;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        setRdsExportProgress(100);
        setRdsExportPhase('done');
        setStatus('Download started: ' + filename);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRdsExportPhase('failed');
      setStatus('RDS ZIP export failed · ' + message);
      diagnosticSinkRef.current('ERROR', 'RDS Export', tool + ' ZIP export failed', message);
    } finally {
      setRdsExportBusy(false);
    }
  };
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
  const [dfiToolReports, setDfiToolReports] = useState<Record<string, string>>({});
  const [dfiToolBusy, setDfiToolBusy] = useState('');
  const [geometryRitOpen, setGeometryRitOpen] = useState(false);
  const [geometryRitBusy, setGeometryRitBusy] = useState(false);
  const [geometryRitReport, setGeometryRitReport] = useState('NOT SCANNED — open Geometry RIT and run Scan to create a current-scene report.');
  const [geometryRitSummary, setGeometryRitSummary] = useState<{ status: 'NOT SCANNED' | 'PASS' | 'REVIEW' | 'FAIL' | 'INSUFFICIENT EVIDENCE'; meshes: number; vertices: number; triangles: number; errors: number; warnings: number }>({ status: 'NOT SCANNED', meshes: 0, vertices: 0, triangles: 0, errors: 0, warnings: 0 });
  const rdsResourceBaselineRef = useRef<{ geometries: number; textures: number; time: number } | null>(null);
  const [menuAccordion, setMenuAccordion] = useState('Project & File');
  const [projectName, setProjectName] = useState('Project.nexus');
  const [isSavingProject, setIsSavingProject] = useState(false);
  const saveInFlightRef = useRef(false);
  const [saveAccordionOpen, setSaveAccordionOpen] = useState(false);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const projectZipFileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const [lightLocks, setLightLocks] = useState<Record<string, boolean>>({});
  const [lightPanelOpen, setLightPanelOpen] = useState<Record<string, boolean>>({ Directional: true, Point: true, Spot: true, Ambient: true, Hemisphere: true });
  const [quickPanel, setQuickPanel] = useState<'lights' | 'materials' | 'transform' | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [skyboxOpen, setSkyboxOpen] = useState(false);
  const [skyboxCategory, setSkyboxCategory] = useState('Time-of-Day Presets');
  const [skyboxType, setSkyboxType] = useState<'Procedural Gradient' | 'Solid Color' | 'HDRI Equirectangular'>('Procedural Gradient');
  const [skyColorTop, setSkyColorTop] = useState('#18283b');
  const [skyColorBottom, setSkyColorBottom] = useState('#080c14');
  const [sunAzimuth, setSunAzimuth] = useState(45);
  const [sunElevation, setSunElevation] = useState(45);
  const [sunIntensity, setSunIntensity] = useState(1.5);
  const [cloudDensity, setCloudDensity] = useState(0.2);
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
  const [animationDock, setAnimationDock] = useState<'scene' | 'transform' | null>(null);
  const [sequenceStates, setSequenceStates] = useState<Array<{ id: string; label: string; width: number; mode: 'continue' | 'independent'; objectId?: string }>>([]);
  const [selectedSequenceState, setSelectedSequenceState] = useState('');
  const [selected3DAlphabetMarkerId, setSelected3DAlphabetMarkerId] = useState('');
  const [sequenceRulerDisplayWidths, setSequenceRulerDisplayWidths] = useState<Record<string, number>>({});
  const sequenceRulerDrag = useRef<{ stateId: string; pointerId: number; startX: number; startWidth: number; scrollLeft: number } | null>(null);
  const suppressSequenceRulerClick = useRef(false);
  const beginSequenceRulerResize = (event: React.PointerEvent<HTMLButtonElement>, stateId: string) => {
    if (event.button !== 0) return;
    sequenceRulerDrag.current = { stateId, pointerId: event.pointerId, startX: event.clientX, startWidth: sequenceRulerDisplayWidths[stateId] || 96, scrollLeft: timelineScrollRef.current?.scrollLeft || 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveSequenceRulerResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sequenceRulerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 3) suppressSequenceRulerClick.current = true;
    setSequenceRulerDisplayWidths(previous => ({ ...previous, [drag.stateId]: Math.max(96, drag.startWidth + delta) }));
    if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft = drag.scrollLeft;
  };
  const endSequenceRulerResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (sequenceRulerDrag.current?.pointerId !== event.pointerId) return;
    sequenceRulerDrag.current = null;
  };
  const handleAlphabetStateHandleClick = (state: typeof sequenceStates[number]) => {
    if (suppressSequenceRulerClick.current) { suppressSequenceRulerClick.current = false; return; }
    selectAlphabetState(state);
  };
  const [pendingStateChoice, setPendingStateChoice] = useState('');
  const [timelineTool, setTimelineTool] = useState<'tracks' | 'dope' | 'graph'>('tracks');
  const [selectedGraphChannel, setSelectedGraphChannel] = useState<'position.x' | 'position.y' | 'position.z' | 'rotation.x' | 'rotation.y' | 'rotation.z' | 'scale.x' | 'scale.y' | 'scale.z'>('position.x');
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const drag = sequenceRulerDrag.current;
    if (drag && timelineScrollRef.current) timelineScrollRef.current.scrollLeft = drag.scrollLeft;
  }, [sequenceRulerDisplayWidths]);
  const [timelineMarkers, setTimelineMarkers] = useState<Array<{id:string;frame:number;label:string}>>([]);
  const [showGhostPreview, setShowGhostPreview] = useState(false);
  const [playbackControlsOpen, setPlaybackControlsOpen] = useState(false);
  const sequenceExtendAt = useRef<Record<string, number>>({});
  const [animationObjectsOpen, setAnimationObjectsOpen] = useState(true);
  const [shapeLibraryOpen, setShapeLibraryOpen] = useState(false);
  const [frameRate, setFrameRate] = useState(30);
  const [timelineDuration, setTimelineDuration] = useState(10);
  const [customRulerStart, setCustomRulerStart] = useState(0);
  const [customRulerStartUnit, setCustomRulerStartUnit] = useState<'s' | 'm'>('s');
  const [customRulerEnd, setCustomRulerEnd] = useState(0);
  const [customRulerEndUnit, setCustomRulerEndUnit] = useState<'s' | 'm'>('s');
  useEffect(() => { setWorkEnd(Math.max(1, Math.round(timelineDuration * frameRate))); }, [timelineDuration, frameRate]);
  const [loopPlayback, setLoopPlayback] = useState(true);
  const [interpolation, setInterpolation] = useState('Ease In-Out');
  const [curveWeight, setCurveWeight] = useState(50);
  const [curveTension, setCurveTension] = useState(50);
  const [curveTangent, setCurveTangent] = useState(50);
  const [editMode, setEditMode] = useState<'Object' | 'Face'>('Object');
  const editModeRef = useRef<'Object' | 'Face'>('Object');
  const [faceSelectionTool, setFaceSelectionTool] = useState<'Face' | 'Vertex' | 'Edge'>('Face');
  const faceSelectionToolRef = useRef<'Face' | 'Vertex' | 'Edge'>('Face');
  const setFaceSelectionMode = (tool: 'Face' | 'Vertex' | 'Edge') => { faceSelectionToolRef.current = tool; setFaceSelectionTool(tool); };
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
  const [playing, setPlaying] = useState(false);
  const [importedAnimationClips, setImportedAnimationClips] = useState<Array<{ id: string; label: string; object: THREE.Object3D; clip: THREE.AnimationClip }>>([]);
  const [activeAnimationClipId, setActiveAnimationClipId] = useState('');
  const animationMixerRef = useRef<{ id: string; mixer: THREE.AnimationMixer; action: THREE.AnimationAction } | null>(null);
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

  useEffect(() => { selectedRef.current = selected; setSmoothSelectAllId(''); }, [selected]);
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
    let slowFrameObserver: PerformanceObserver | null = null;
    let lastSlowFrameLog = 0;
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        longTaskObserver = new PerformanceObserver(list => {
          list.getEntries().forEach(entry => diagnosticSinkRef.current(entry.duration >= 250 ? 'ERROR' : 'WARN',
            'Main Thread', 'Long task blocked UI thread', `${Math.round(entry.duration)} ms`));
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
        const supportedEntries = PerformanceObserver.supportedEntryTypes || [];
        if (supportedEntries.includes('long-animation-frame')) {
          slowFrameObserver = new PerformanceObserver(list => {
            const summary = summarizeFrameTimes(list.getEntries().map(entry => entry.duration));
            if (!summary.slowFrames) return;
            const now = performance.now();
            if (now - lastSlowFrameLog < 1500) return;
            lastSlowFrameLog = now;
            diagnosticSinkRef.current(summary.maxMs !== null && summary.maxMs >= 250 ? 'ERROR' : 'WARN',
              'Frame Monitor', 'Slow frame(s) detected',
              `Samples: ${summary.samples} · Average: ${summary.averageMs} ms · P95: ${summary.p95Ms} ms · Max: ${summary.maxMs} ms · Frames >33.33ms: ${summary.slowFrames}`);
          });
          slowFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
        } else {
          diagnosticSinkRef.current('INFO', 'Frame Monitor', 'Slow-frame observer unavailable on this WebView',
            'Long-task monitoring remains active; no extra animation-frame loop is created.');
        }
      }
    } catch {
      diagnosticSinkRef.current('INFO', 'Performance', 'Long-task or slow-frame observer unavailable on this WebView');
    }
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
      slowFrameObserver?.disconnect();
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
    const entry = importedAnimationClips.find(item => item.id === activeAnimationClipId);
    if (!entry) { animationMixerRef.current = null; return; }
    const mixer = new THREE.AnimationMixer(entry.object);
    const action = mixer.clipAction(entry.clip);
    action.setLoop(loopPlayback ? THREE.LoopRepeat : THREE.LoopOnce, loopPlayback ? Infinity : 1);
    action.clampWhenFinished = !loopPlayback;
    action.play();
    action.paused = !playing;
    mixer.setTime(Math.max(0, frameRef.current) / Math.max(1, frameRate));
    animationMixerRef.current = { id: entry.id, mixer, action };
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(entry.object);
      if (animationMixerRef.current?.id === entry.id) animationMixerRef.current = null;
    };
  }, [activeAnimationClipId, importedAnimationClips, loopPlayback]);
  useEffect(() => { if (animationMixerRef.current) animationMixerRef.current.action.paused = !playing; }, [playing]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a101b');
    scene.fog = new THREE.Fog('#0a101b', 22, 58);
    const camera = new THREE.PerspectiveCamera(52, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 150);
    camera.position.set(7, 6, 9);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(getNexusRenderPixelRatio(window.devicePixelRatio || 1, { native: Capacitor.isNativePlatform() }));
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
      const topology = mesh.userData.nexusTopology;
      const hasPersistentTopology = topology?.version === 1 &&
        Array.isArray(topology.vertices) && Array.isArray(topology.faces) && Array.isArray(topology.edges);
      const isQuadGrid = Boolean(mesh.userData.nexusQuadGrid && !mesh.geometry.index && position && position.count % 6 === 0);
      // Refresh bounds before deriving a scale-aware overlay offset. This is
      // shared by topology and triangle-adjacency paths to prevent z-fighting.
      mesh.geometry.computeBoundingSphere();
      const bounds = mesh.geometry.boundingSphere;
      const lineOffset = Math.max(0.0012, (bounds?.radius || 1) * 0.002);
      let edges: THREE.BufferGeometry;
      if (hasPersistentTopology) {
        // Persistent modeling edges are the source of truth. In particular,
        // Subdivide creates coplanar internal edges which triangle-normal
        // filtering intentionally suppresses; never route those edges through
        // the render-triangle visibility heuristic or they appear to vanish.
        const vertexById = new Map<string, THREE.Vector3>(
          topology.vertices.map((vertex: any) => [vertex.id, new THREE.Vector3(...vertex.position)])
        );
        const normalByVertex = new Map<string, THREE.Vector3>();
        topology.faces.forEach((face: any) => {
          const points = (face.vertices || []).map((id: string) => vertexById.get(id)).filter(Boolean) as THREE.Vector3[];
          if (points.length < 3) return;
          const normal = new THREE.Vector3();
          for (let i = 0; i < points.length; i++) {
            const current = points[i], next = points[(i + 1) % points.length];
            normal.x += (current.y - next.y) * (current.z + next.z);
            normal.y += (current.z - next.z) * (current.x + next.x);
            normal.z += (current.x - next.x) * (current.y + next.y);
          }
          if (normal.lengthSq() < 1e-16) return;
          normal.normalize();
          (face.vertices as string[]).forEach(id => {
            const sum = normalByVertex.get(id) || new THREE.Vector3();
            sum.add(normal);
            normalByVertex.set(id, sum);
          });
        });
        const edgePositions: number[] = [];
        topology.edges.forEach((edge: any) => {
          const a = vertexById.get(edge.a), b = vertexById.get(edge.b);
          if (!a || !b) return;
          const normalA = (normalByVertex.get(edge.a) || new THREE.Vector3()).normalize();
          const normalB = (normalByVertex.get(edge.b) || new THREE.Vector3()).normalize();
          const start = a.clone().addScaledVector(normalA, lineOffset);
          const end = b.clone().addScaledVector(normalB, lineOffset);
          edgePositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
        });
        edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
      } else if (isQuadGrid && position) {
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
        // Build physical edge adjacency from positions, not vertex indices.
        // Face Extrude intentionally produces non-indexed geometry; EdgesGeometry
        // treats every triangle corner as unique there and exposes every diagonal.
        // Coordinate welding is limited to this display overlay and never mutates
        // the editable mesh or its UV/normal seams.
        const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; normal: THREE.Vector3; count: number; hard: boolean }>();
        const pointAt = (index: number) => new THREE.Vector3().fromBufferAttribute(position!, index);
        const coordinateKey = (point: THREE.Vector3) =>
          [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
        const index = mesh.geometry.index;
        const vertexCount = position?.count || 0;
        const elementCount = index ? index.count : vertexCount;
        const angleLimit = THREE.MathUtils.degToRad(CLEAN_FLAT_SURFACE_EDGE_ANGLE_DEGREES);
        for (let start = 0; start + 2 < elementCount; start += 3) {
          const vertexAt = (offset: number) => index ? index.getX(offset) : offset;
          const triangle = [0, 1, 2].map(corner => pointAt(vertexAt(start + corner)));
          const faceNormal = triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0]));
          if (faceNormal.lengthSq() < 1e-16) continue;
          faceNormal.normalize();
          for (let side = 0; side < 3; side++) {
            const a = triangle[side], b = triangle[(side + 1) % 3];
            const ka = coordinateKey(a), kb = coordinateKey(b);
            const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
            const entry = edgeMap.get(key);
            if (!entry) edgeMap.set(key, { a, b, normal: faceNormal.clone(), count: 1, hard: false });
            else {
              entry.count++;
              const angle = Math.acos(THREE.MathUtils.clamp(entry.normal.dot(faceNormal), -1, 1));
              if (angle > angleLimit) entry.hard = true;
            }
          }
        }
        const edgePositions: number[] = [];
        edgeMap.forEach(edge => {
          // Keep true boundaries, hard creases, and non-manifold edges visible.
          // Suppress only shared coplanar edges (the unwanted triangle diagonals).
          if (edge.count === 1 || edge.count > 2 || edge.hard) {
            edgePositions.push(edge.a.x, edge.a.y, edge.a.z, edge.b.x, edge.b.y, edge.b.z);
          }
        });
        edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
        // Offset each edge endpoint along the averaged source vertex normal to
        // keep visible lines from z-fighting after Face Extrude / Scale.
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
      const inCameraView = Boolean(runtime.current?.cameraView || runtime.current?.animationView);
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
    transform.getHelper().userData.nexusEditorHelper = true;
    transform.getHelper().visible = false;
    scene.add(transform.getHelper());

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const subObjectPivot = new THREE.Object3D();
    subObjectPivot.name = 'Sub-object Transform Pivot';
    scene.add(subObjectPivot);
    let activeSubSelection: { mesh: THREE.Mesh; indices: number[]; faceParts?: number[][]; linkedIndices?: number[]; lastWorld: THREE.Vector3; lastQuaternion: THREE.Quaternion; lastScale: THREE.Vector3 } | null = null;
    const subObjectLockStore = createSubObjectLockStore();
    let subGeometryBefore: THREE.BufferGeometry | null = null;
    const selectable: THREE.Object3D[] = [camBody];
    const alphabetStateMarkers = new Map<string, THREE.Sprite>();
    const rigChains: Array<{ bones: THREE.Bone[]; helper: THREE.SkeletonHelper; target: THREE.Object3D | null; pole?: THREE.Object3D | null; displayVisible?: boolean; shapeRig?: boolean; owner?: THREE.Object3D | null }> = [];
    let rigAttachTarget: THREE.Object3D | null = null;
    const nextManualBoneName = () => {
      const used = new Set(selectable.filter(object => object instanceof THREE.Bone).map(object => object.name));
      let index = 1; let candidate = '';
      do { candidate = 'Bone_' + String(index++).padStart(2, '0'); } while (used.has(candidate));
      return candidate;
    };
    const boneVisualColor = (bone: THREE.Bone, active?: THREE.Object3D) => {
      if (bone.userData.locked) return '#ff4d64';
      if (bone === active) return '#00e5ff';
      if (bone.userData.detached) return '#a879ff';
      return bone.userData.rigRole === 'root' || !(bone.parent as any)?.isBone ? '#ffb547' : '#35d7ff';
    };
    const createSphereBoneGeometry = () => new THREE.SphereGeometry(0.025, 12, 8);
    const ensureBoneJoint = (bone: THREE.Bone) => {
      const existing = bone.children.find(child => child.userData.nexusJointVisual) as THREE.Mesh | undefined;
      const childBone = bone.children.find(child => (child as THREE.Bone).isBone) as THREE.Bone | undefined;
      const direction = childBone ? childBone.position.clone() : new THREE.Vector3(0, Number(bone.userData.segmentLength) || 0.24, 0);
      const length = Math.max(direction.length(), 0.12);
      if (existing) {
        if (!existing.geometry.userData.nexusSphereBoneGeometry) {
          existing.geometry.dispose();
          existing.geometry = createSphereBoneGeometry();
          existing.geometry.userData.nexusSphereBoneGeometry = true;
        }
        existing.scale.setScalar(1);
        existing.position.copy(direction).multiplyScalar(0.5);
        existing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
        existing.name = bone.name + ' Sphere Bone';
        existing.userData.nexusBoneVisual = true;
        existing.userData.nexusBoneOwnerId = String(bone.userData.editorId || '');
        const material = existing.material as THREE.MeshBasicMaterial;
        material.color.set(boneVisualColor(bone));
        return;
      }
      const geometry = createSphereBoneGeometry();
      geometry.userData.nexusSphereBoneGeometry = true;
      const visual = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: boneVisualColor(bone), depthTest: false, transparent: true, opacity: 0.96, side: THREE.DoubleSide })
      );
      visual.scale.setScalar(1);
      visual.position.copy(direction).multiplyScalar(0.5);
      visual.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      visual.name = bone.name + ' Sphere Bone';
      visual.userData.nexusJointVisual = true;
      visual.userData.nexusBoneVisual = true;
      visual.userData.nexusBoneOwnerId = String(bone.userData.editorId || '');
      visual.renderOrder = 18;
      bone.add(visual);
    };
    const refreshJointColors = (active?: THREE.Object3D) => {
      selectable.forEach(object => {
        if (!(object instanceof THREE.Bone)) return;
        const visual = object.children.find(child => child.userData.nexusJointVisual) as THREE.Mesh | undefined;
        if (!visual) return;
        ((visual as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(boneVisualColor(object, active));
      });
    };
    const styleSkeletonHelper = (helper: THREE.SkeletonHelper, _bones: THREE.Bone[]) => {
      // SkeletonHelper keeps a fixed bone list from construction time. Color exactly
      // the segments in that list so the color attribute always matches its geometry.
      const helperBones = ((helper as any).bones || []) as THREE.Bone[];
      const colors: number[] = [];
      helperBones.forEach(bone => {
        const lineColor = new THREE.Color('#579bce');
        colors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.r, lineColor.g, lineColor.b);
      });
      helper.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = helper.material as THREE.LineBasicMaterial;
      material.vertexColors = true;
      material.color.set('#ffffff');
      material.transparent = true;
      material.opacity = 0.68;
      material.linewidth = 1;
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
      helper.visible = chain.displayVisible !== false;
      scene.add(helper);
      chain.helper = helper;
    };
    const lightSources: Array<{ type: string; object: THREE.Light; helper?: THREE.Mesh }> = [];
    const lightCounts: Record<string, number> = {};
    const particleSystems: Record<string, THREE.Points> = {};
    const reflectionTarget = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, colorSpace: THREE.SRGBColorSpace });
    const reflectionCamera = new THREE.CubeCamera(0.1, 100, reflectionTarget);
    scene.add(reflectionCamera);
    // Performance Mode freezes expensive live cube reflections until quality mode resumes.
    let performanceModeActive = false;
    const syncItems = () => {
      const ordered: THREE.Object3D[] = [];
      const visit = (parent: THREE.Object3D) => parent.children.forEach(child => {
        if (child.userData.editorId && selectable.includes(child)) ordered.push(child);
        visit(child);
      });
      visit(scene);
      selectable.forEach(o => { if (!ordered.includes(o)) ordered.push(o); });
      setItems(ordered.map(o => ({ id: o.userData.editorId, name: o.userData.shapeId ? formatShapeIdentity(o.name, o.userData.shapeId) : o.name, object: o, kind: o.userData.kind || o.type })));
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
        configureDirectionalShadow(l); l.position.set(5, 8, 5); l.castShadow = true; light = l;
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
            chain.helper.visible = chain.displayVisible !== false;
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
      chain.helper.visible = chain.displayVisible !== false;
      chain.bones.forEach(bone => { ensureBoneJoint(bone); const visual = bone.children.find(child => child.userData.nexusJointVisual); if (visual) visual.visible = chain.displayVisible!; });
      syncItems();
      setStatus((chain.displayVisible ? 'IK bones shown: ' : 'IK bones hidden: ') + (chain.bones[0]?.name || obj.name));
    };
    const isBoneDisplayVisible = (obj: THREE.Object3D) => {
      if (!(obj instanceof THREE.Bone)) return obj.visible;
      const chain = rigChains.find(entry => entry.bones.includes(obj));
      return chain ? chain.displayVisible !== false : true;
    };
    const toggleSelectedRigDisplay = () => {
      const selectedObject = selectable.find(object => String(object.userData.editorId) === selectedRef.current);
      const chain = resolveRigChainForObject(selectedObject);
      if (chain?.bones[0]) return toggleBoneDisplay(chain.bones[0]);
      if (selectedObject) return toggleBoneDisplay(selectedObject);
      setStatus('Select a rig, Shape, or bone before changing bone visibility');
      return false;
    };

    let activeControlSelectionFrame: THREE.Group | null = null;
    const updateControlHandleSelectionFrame = (obj?: THREE.Object3D) => {
      const nextIsControlHandle = Boolean(obj?.userData?.rigControlMarker);
      const currentOwner = activeControlSelectionFrame?.parent;
      if (activeControlSelectionFrame && (!nextIsControlHandle || currentOwner !== obj)) {
        const previousFrame = activeControlSelectionFrame;
        previousFrame.parent?.remove(previousFrame);
        previousFrame.traverse(node => {
          const visual = node as THREE.Mesh | THREE.LineSegments;
          visual.geometry?.dispose();
          const materials = Array.isArray(visual.material) ? visual.material : visual.material ? [visual.material] : [];
          materials.forEach(material => material.dispose());
        });
        activeControlSelectionFrame = null;
      }
      if (!nextIsControlHandle || !obj) return;
      if (activeControlSelectionFrame?.parent === obj) {
        activeControlSelectionFrame.visible = true;
        return;
      }
      const frame = new THREE.Group();
      frame.name = 'Control Handle Selection Frame';
      frame.userData.nexusControlHandleSelectionFrame = true;
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.24, 0.24),
        new THREE.MeshBasicMaterial({
          color: '#ffffff', transparent: true, opacity: 0.035,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
        })
      );
      face.name = 'Transparent Control Handle Selection Box';
      face.renderOrder = 10001;
      face.raycast = () => {};
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.24, 0.24, 0.24)),
        new THREE.LineBasicMaterial({
          color: '#ffffff', transparent: true, opacity: 0.98,
          depthTest: false, depthWrite: false, toneMapped: false
        })
      );
      outline.name = 'White Control Handle Selection Outline';
      outline.renderOrder = 10002;
      outline.raycast = () => {};
      frame.add(face, outline);
      frame.traverse(node => { node.raycast = () => {}; });
      // Keep the selection frame a consistent world-space size for every
      // Shape/Character rig, regardless of the Control Handle's inherited scale.
      obj.updateWorldMatrix(true, false);
      const handleWorldScale = obj.getWorldScale(new THREE.Vector3());
      frame.scale.set(
        1 / Math.max(Math.abs(handleWorldScale.x), 1e-4),
        1 / Math.max(Math.abs(handleWorldScale.y), 1e-4),
        1 / Math.max(Math.abs(handleWorldScale.z), 1e-4)
      );
      frame.visible = true;
      obj.add(frame);
      activeControlSelectionFrame = frame;
    };

    const selectObject = (obj?: THREE.Object3D) => {
      updateControlHandleSelectionFrame(obj);
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
        restoredHelper.visible = true;
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
      const objectMode = editModeRef.current === 'Object';
      const isControlHandle = Boolean(obj.userData.rigControlMarker);
      // A locked IK bone remains selectable. Its lock prevents Move/Scale,
      // but Rotate is allowed for deliberate manual joint posing.
      const lockedBone = obj instanceof THREE.Bone && isIkBoneLocked(obj);
      const selectionLocked = Boolean(obj.userData.objectManagerLocked) || (isControlHandle && obj.userData.controlLocked);
      const canTransform = (objectMode || isControlHandle) && (!lockedBone || (objectMode && modeRef.current === 'rotate'));

      // One controller owns selection in both workspaces. The active camera is
      // switched by the workspace toggle; attachment never changes controllers.
      transform.detach();
      if (selectionLocked || !canTransform) {
        transform.enabled = false;
        transform.getHelper().visible = false;
      } else {
        transform.attach(obj);
        transform.enabled = true;
        transform.getHelper().visible = true;
      }
      transform.setMode(modeRef.current);
      transform.setSpace(spaceRef.current);
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
      if (cloneOf) {
        // A cloned hierarchy needs fresh editor references as well as fresh
        // Shape IDs; remap internal IK/attachment references to the clone.
        const clonedEditorIds = new Map<string, string>();
        obj.traverse((child: THREE.Object3D) => {
          if (child === obj) return;
          const previousId = child.userData.editorId;
          const nextId = uid();
          if (typeof previousId === 'string') clonedEditorIds.set(previousId, nextId);
          child.userData.editorId = nextId;
        });
        obj.traverse((child: THREE.Object3D) => {
          Object.entries(child.userData).forEach(([key, value]) => {
            if (typeof value === 'string' && clonedEditorIds.has(value)) child.userData[key] = clonedEditorIds.get(value);
            else if (Array.isArray(value)) child.userData[key] = value.map(entry => typeof entry === 'string' ? clonedEditorIds.get(entry) || entry : entry);
          });
        });
      }
      const identityObjects: THREE.Object3D[] = [...selectable];
      obj.traverse((child: THREE.Object3D) => {
        if (!isShapeProjectMesh(child)) { delete child.userData.shapeId; delete child.userData.shapeIdentityLabel; return; }
        // editorId remains the runtime link; shapeId is permanent per editable mesh.
        delete child.userData.shapeId;
        const identity = allocateShapeIdentity(identityObjects, Number(scene.userData.nexusNextShapeId) || 1);
        child.userData.shapeId = identity.shapeId;
        child.userData.shapeIdentityLabel = formatShapeIdentity(child.name || obj.name, identity.shapeId);
        scene.userData.nexusNextShapeId = identity.nextId;
        identityObjects.push(child);
      });
      if (obj instanceof THREE.Mesh && ['Cube', 'Sphere', 'Cylinder', 'Cone', 'Torus'].includes(kind)) {
        const primitivePosition = obj.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        const primitiveTopology = primitivePosition
          ? obj.geometry.index
            ? kind === 'Cube'
              ? buildTopologyFromIndexedQuadGeometry(primitivePosition.array, obj.geometry.index.array)
              : null
            : buildTopologyFromCanonicalQuadGeometry(primitivePosition.array)
          : null;
        if (primitiveTopology) {
          obj.userData.nexusQuadGrid = true;
          obj.userData.nexusQuadGridLayout = obj.geometry.index ? 'indexed-primitive-quad-grid' : 'canonical-v1';
          obj.userData.nexusTopology = primitiveTopology;
        } else {
          delete obj.userData.nexusTopology;
          if (kind === 'Cube') delete obj.userData.nexusQuadGrid;
        }
      }
      scene.add(obj);
      selectable.push(obj);
      assignShapeOwnership(selectable);
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
    const addUniversalBone = (mode: 'root' | 'child' = 'root') => {
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
        const parentBone = selectedObject instanceof THREE.Bone
          ? selectedObject
          : selectedObject && !(selectedObject instanceof THREE.Light)
            ? selectable.find(object => object instanceof THREE.Bone &&
                object.userData.rigRole === 'root' &&
                String(object.userData.rigOwnerId || '') === String(selectedObject.userData.editorId || '')) as THREE.Bone | undefined
            : undefined;
        if (!(parentBone instanceof THREE.Bone)) {
          setStatus('Select the Shape or a Root / Child Bone first');
          return false;
        }
        const root = resolveRoot(parentBone);
        if (!root.userData.shapeRig || root.userData.rigRole !== 'root') {
          setStatus('Select a Root Bone from a Manual Shape Rig');
          return false;
        }
        const owner = resolveOwner(root);
        if (!owner) {
          setStatus('Attach the Root Bone to its Shape before adding Child Bones');
          return false;
        }
        const chain = rigChains.find(entry => entry.bones.includes(root)) || makeHelper(root, owner);
        const child = new THREE.Bone();
        child.name = nextManualBoneName();
        let segmentLength = Number(parentBone.userData.segmentLength) || Number(root.userData.segmentLength) || 0;
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
        parentBone.add(child);
        ensureBoneJoint(parentBone);
        ensureBoneJoint(child);
        if (!chain.bones.includes(child)) chain.bones.push(child);
        rebuildRigHelper(chain);
        chain.helper.visible = true;
        chain.displayVisible = true;
        selectable.push(child);
        syncItems();
        selectObject(child);
        setStatus(child.name + ' added · connected to ' + parentBone.name);
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
      if (!anchor || !anchor.userData.nexusRigAnchor) {
        const existingChain = rigChains.find(entry => entry.bones.includes(root!));
        if (existingChain?.owner && existingChain.owner.getObjectById(root!.id)) {
          setStatus('Root Bone is already attached to the Character Group');
          return true;
        }
        setStatus('Root Bone anchor missing');
        return false;
      }
      if (anchor.parent === owner && !anchor.userData.pendingShapeAttachment) { setStatus('Root Bone already attached'); return true; }
      scene.updateMatrixWorld(true); owner.attach(anchor); anchor.name = 'Rig Anchor';
      anchor.userData.pendingShapeAttachment = false;
      root.userData.rigPendingAttachment = false; root.userData.nexusRigSchema = 3;
      const chain = rigChains.find(entry => entry.bones.includes(root!));
      if (chain) {
        chain.owner = owner;
        // Keep Control Handles as independent Scene-root objects. Track the
        // rig owner's world transform so handles follow Shape/Character motion
        // without becoming children of the Shape or Root Bone.
        scene.updateMatrixWorld(true);
        const chainBoneIds = new Set(chain.bones.map(bone => String(bone.userData.editorId || '')));
        selectable.filter(object => object.userData.rigControlMarker &&
          chainBoneIds.has(String(object.userData.controlOwnerBoneId || ''))
        ).forEach(marker => {
          marker.visible = true;
          setControlHandleOwnerBaseline(marker, String(owner.userData.editorId || ''));
          marker.updateMatrixWorld(true);
        });
        rebuildRigHelper(chain);
        chain.helper.updateMatrixWorld(true);
        chain.helper.visible = chain.displayVisible !== false;
      }
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
      if (child instanceof THREE.Mesh && parent instanceof THREE.Bone) {
        child.userData.rigBinding = {
          rigId: String(parent.userData.rigOwnerId || parent.userData.editorId || ''),
          boneId: String(parent.userData.editorId || ''),
          mode: 'rigid',
          source: 'manual',
          needsReview: false
        };
        child.userData.rigPartKey = child.userData.rigPartKey || child.name;
        const boundIds = Array.isArray(parent.userData.rigBoundMeshIds) ? parent.userData.rigBoundMeshIds : [];
        if (!boundIds.includes(String(child.userData.editorId || ''))) boundIds.push(String(child.userData.editorId || ''));
        parent.userData.rigBoundMeshIds = boundIds;
      }
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
        styleSkeletonHelper(chain.helper, chain.bones);
        // Styling resets line materials only; visibility is controlled by the
        // rig's Show/Hide state and must survive every bone transform refresh.
        chain.helper.visible = chain.displayVisible !== false;
        const colors = chain.helper.geometry.getAttribute('color');
        if (colors) colors.needsUpdate = true;
        chain.helper.updateMatrixWorld(true);
      });
      refreshJointColors();
    };
    const toggleSelectedBoneControlHandle = () => {
      const bone = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!(bone instanceof THREE.Bone)) { setStatus('Select a bone first to set a Control Handle'); return false; }
      const existing = selectable.find(child => child.userData.rigControlMarker && String(child.userData.controlOwnerBoneId) === String(bone.userData.editorId));
      let nextSelection: THREE.Object3D = bone;
      if (existing) {
        existing.parent?.remove(existing);
        const markerIndex = selectable.indexOf(existing); if (markerIndex >= 0) selectable.splice(markerIndex, 1);
        (existing as THREE.Mesh).geometry?.dispose();
        const material = (existing as THREE.Mesh).material;
        if (Array.isArray(material)) material.forEach(m => m.dispose()); else (material as THREE.Material)?.dispose();
        bone.userData.controlHandle = false;
        setStatus('Control Handle removed from ' + bone.name);
      } else {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 16, 12),
          new THREE.MeshBasicMaterial({ color: '#ffb52e', depthTest: false, depthWrite: false, transparent: true, opacity: 1, toneMapped: false })
        );
        const placement = getControlHandlePlacement(bone);
        marker.scale.setScalar(placement.radius / 0.07);
        marker.name = bone.name + ' Control Handle';
        marker.userData.rigControlMarker = true;
        marker.userData.editorId = uid();
        marker.userData.kind = 'Control Handle';
        marker.userData.controlLocked = false;
        marker.userData.controlOwnerBoneId = String(bone.userData.editorId);
        marker.userData.controlOwnerRigRootId = String(placement.rigRootBoneId || '');
        marker.userData.controlOwnerObjectId = String(placement.rigOwnerObjectId || '');
        marker.userData.handleRadius = placement.radius;
        marker.renderOrder = 10000;
        marker.frustumCulled = false;
        marker.layers.enableAll();
        marker.visible = true;
        scene.add(marker);
        placeControlHandleAtBone(marker, bone, placement);
        setControlHandleOwnerBaseline(marker, String(placement.rigOwnerObjectId || ''));
        marker.userData.controlLastWorldQuaternion = marker.getWorldQuaternion(new THREE.Quaternion()).toArray();
        selectable.push(marker);
        bone.userData.controlHandle = true;
        nextSelection = marker;
        setStatus('Control Handle enabled · linked to ' + bone.name);
      }
      refreshRigVisuals(); syncItems(); selectObject(nextSelection); return true;
    };
    const toggleSelectedBoneLock = () => {
      const bone = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (bone?.userData.rigControlMarker) return toggleSelectedControlLock();
      if (!(bone instanceof THREE.Bone)) { setStatus('Select a bone or Control Handle first to Lock / Unlock'); return false; }
      bone.userData.locked = !bone.userData.locked; refreshRigVisuals(); selectObject(bone);
      setStatus(bone.name + (bone.userData.locked ? ' locked · selectable and Rotate-only' : ' unlocked · Move / Rotate / Scale')); return true;
    };
    const createManualRig = () => {
      const selectedObject = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (!selectedObject) { setStatus('Select the complete Character Group before creating its Humanoid Rig'); return null; }
      let ancestor: THREE.Object3D | null = selectedObject;
      let existingCharacterChain = rigChains.find(entry => entry.bones.some(bone => selectedObject === bone || selectedObject.getObjectById(bone.id)));
      while (!existingCharacterChain && ancestor) {
        existingCharacterChain = rigChains.find(entry => entry.owner === ancestor || entry.bones.includes(ancestor as THREE.Bone));
        ancestor = ancestor.parent;
      }
      if (existingCharacterChain) {
        setStatus('This Character already has a Rig · use Detect Parts or Bind All instead of creating another skeleton');
        selectObject(existingCharacterChain.bones[0]);
        return null;
      }
      let owner: THREE.Object3D = selectedObject;
      while (owner instanceof THREE.Bone && owner.parent) owner = owner.parent;
      if (!owner.userData.editorId) owner.userData.editorId = uid();
      scene.updateMatrixWorld(true);
      owner.updateWorldMatrix(true, true);
      const worldBounds = new THREE.Box3().setFromObject(owner);
      const localBounds = worldBounds.isEmpty()
        ? new THREE.Box3(new THREE.Vector3(-0.25, 0, -0.15), new THREE.Vector3(0.25, 2.6, 0.15))
        : worldBounds.clone().applyMatrix4(owner.matrixWorld.clone().invert());
      const size = localBounds.getSize(new THREE.Vector3());
      const center = localBounds.getCenter(new THREE.Vector3());
      const height = Math.max(size.y, 0.25);
      const width = Math.max(size.x, height * 0.32);
      const depth = Math.max(size.z, height * 0.12);
      const rig = new THREE.Group();
      rig.name = 'Humanoid Rig ' + (rigChains.length + 1);
      rig.userData.editorId = uid();
      rig.userData.kind = 'Rig';
      rig.userData.characterRig = true;
      rig.userData.rigOwnerId = String(owner.userData.editorId);
      rig.position.set(center.x, localBounds.min.y, center.z);
      owner.add(rig);
      const makeBone = (name: string, parent: THREE.Bone | null, position: [number, number, number], role = 'deform') => {
        const bone = new THREE.Bone();
        bone.name = name;
        bone.position.set(...position);
        bone.userData.editorId = uid();
        bone.userData.kind = 'Bone';
        bone.userData.rigRole = role;
        bone.userData.shapeRig = true;
        bone.userData.characterRig = true;
        bone.userData.rigOwnerId = String(owner.userData.editorId);
        bone.userData.nexusRigSchema = 3;
        bone.userData.locked = role === 'root';
        if (parent) parent.add(bone); else rig.add(bone);
        ensureBoneJoint(bone);
        if (parent) ensureBoneJoint(parent);
        return bone;
      };
      const h = height;
      const root = makeBone('Root', null, [0, 0, 0], 'root');
      root.userData.segmentLength = h * 0.18;
      const hips = makeBone('Hips', root, [0, h * 0.48, 0]);
      const spine = makeBone('Spine', hips, [0, h * 0.14, 0]);
      const chest = makeBone('Chest', spine, [0, h * 0.17, 0]);
      const neck = makeBone('Neck', chest, [0, h * 0.12, 0]);
      makeBone('Head', neck, [0, h * 0.1, 0]);
      for (const side of ['.L', '.R']) {
        const sign = side === '.L' ? -1 : 1;
        const shoulder = makeBone('Shoulder' + side, chest, [sign * width * 0.1, h * 0.13, 0]);
        const upper = makeBone('UpperArm' + side, shoulder, [sign * width * 0.18, -h * 0.02, 0]);
        const forearm = makeBone('Forearm' + side, upper, [sign * width * 0.19, 0, 0]);
        makeBone('Hand' + side, forearm, [sign * width * 0.14, 0, 0]);
        const thigh = makeBone('Thigh' + side, hips, [sign * width * 0.075, -h * 0.04, 0]);
        const shin = makeBone('Shin' + side, thigh, [0, -h * 0.23, 0]);
        makeBone('Foot' + side, shin, [0, -h * 0.22, depth * 0.2]);
      }
      const bones: THREE.Bone[] = [];
      rig.traverse(node => { if ((node as THREE.Bone).isBone) bones.push(node as THREE.Bone); });
      owner.userData.characterRigId = String(rig.userData.editorId);
      const helper = new THREE.SkeletonHelper(root);
      helper.name = rig.name + ' Skeleton';
      styleSkeletonHelper(helper, bones);
      helper.visible = true;
      scene.add(helper);
      selectable.push(rig, ...bones);
      rigChains.push({ bones, helper, target: null, displayVisible: true, shapeRig: true, owner });
      scene.updateMatrixWorld(true);
      syncItems();
      selectObject(root);
      setStatus('Character Humanoid Rig created · fitted to Character bounds · Auto Detect Parts then Bind All');
      return rig;
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
    const resolveRigChainForObject = (object?: THREE.Object3D) => {
      if (!object) return null;
      if (object instanceof THREE.Bone) return [...rigChains].reverse().find(entry => entry.bones.includes(object)) || null;
      const isWithinOwner = (owner: THREE.Object3D | null | undefined, candidate: THREE.Object3D) => {
        let current: THREE.Object3D | null = candidate;
        while (current) { if (current === owner) return true; current = current.parent; }
        return false;
      };
      const direct = [...rigChains].reverse().find(entry =>
        entry.target === object || entry.pole === object || entry.owner === object ||
        isWithinOwner(entry.owner, object) || entry.bones.some(bone => object.getObjectById(bone.id))
      );
      if (direct) return direct;
      const objectId = String(object.userData.editorId || '');
      if (objectId) {
        const owned = [...rigChains].reverse().find(entry =>
          entry.shapeRig === true && String(entry.bones[0]?.userData.rigOwnerId || '') === objectId
        );
        if (owned) return owned;
      }
      let matched: (typeof rigChains)[number] | null = null;
      object.traverse((node: any) => {
        if (!node.isSkinnedMesh || !node.skeleton) return;
        const skeletonBones = node.skeleton.bones as THREE.Bone[];
        matched = [...rigChains].reverse().find(entry =>
          entry.bones.length === skeletonBones.length &&
          entry.bones.every((bone, index) => bone === skeletonBones[index])
        ) || matched;
      });
      return matched;
    };
    const createPoleTarget = () => {
      const selectedObject = selectable.find(object => String(object.userData.editorId) === selectedRef.current);
      const selectedBone = selectedObject instanceof THREE.Bone ? selectedObject : undefined;
      const chain = resolveRigChainForObject(selectedObject) ||
        (rigChains.filter(entry => entry.bones.length >= 3).length === 1 ? rigChains.find(entry => entry.bones.length >= 3) : null);
      if (!chain || chain.bones.length < 3) { setStatus('Select a specific rig with at least three connected bones first'); return null; }
      const endId = selectedBone && chain.bones.includes(selectedBone) ? selectedBone.userData.editorId : chain.target?.userData.ikEndBoneId;
      const endBone = chain.bones.find(bone => String(bone.userData.editorId) === String(endId)) || chain.bones[chain.bones.length-1];
      const path: THREE.Bone[] = []; let cursor: THREE.Object3D | null = endBone;
      while (cursor && path.length < 32) { if (cursor instanceof THREE.Bone && chain.bones.includes(cursor)) path.push(cursor); cursor = cursor.parent; }
      const middle = path[Math.floor(path.length/2)] || endBone;
      const position = middle.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.8,0,0.8));
      let target = chain.pole as THREE.Mesh | null;
      if (!target) {
        target = new THREE.Mesh(new THREE.SphereGeometry(0.11,14,10),new THREE.MeshBasicMaterial({color:0xc58cff,wireframe:true}));
        target.name = 'IK Pole Target'; target.userData.editorId = uid(); target.userData.kind = 'IK Pole';
        target.userData.rigRootBoneId = chain.bones[0]?.userData.editorId || null;
        scene.add(target); selectable.push(target); chain.pole = target;
      }
      target.position.copy(position); syncItems(); selectObject(target);
      setStatus('Pole target ready · drag it to guide the selected rig limb bend plane'); return target;
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
    let activeIkSpring: { marker: THREE.Object3D; ownerBone: THREE.Bone; chainLength: number; current: THREE.Vector3; target: THREE.Vector3; velocity: THREE.Vector3; lastTime: number } | null = null;
    const getControlHandlePlacement = (owner: THREE.Bone) => {
      scene.updateMatrixWorld(true);
      owner.updateWorldMatrix(true, true);
      const child = owner.children.find(node => node instanceof THREE.Bone) as THREE.Bone | undefined;
      const start = owner.getWorldPosition(new THREE.Vector3());
      const end = child ? child.getWorldPosition(new THREE.Vector3()) : start.clone().add(owner.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Vector3(0, 1, 0)));
      const segmentLength = Math.max(end.distanceTo(start), 0.1);
      const chain = resolveRigChainForObject(owner);
      return {
        position: start,
        radius: THREE.MathUtils.clamp(segmentLength * 0.14, 0.05, 0.3),
        rigRootBoneId: chain?.bones[0]?.userData.editorId || owner.userData.rigRootBoneId || '',
        rigOwnerObjectId: chain?.owner?.userData?.editorId || owner.userData.rigOwnerId || ''
      };
    };
    const placeControlHandleAtBone = (marker: THREE.Object3D, bone: THREE.Bone, placement: { position: THREE.Vector3 }) => {
      scene.updateMatrixWorld(true);
      if (marker.parent !== scene) scene.attach(marker);
      marker.position.copy(scene.worldToLocal(placement.position.clone()));
      marker.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion())).normalize();
      marker.updateMatrixWorld(true);
    };
    const setControlHandleOwnerBaseline = (marker: THREE.Object3D, ownerId: string) => {
      marker.userData.controlOwnerObjectId = String(ownerId || '');
      const owner = selectable.find(object => String(object.userData.editorId || '') === String(ownerId || ''));
      if (owner) {
        owner.updateWorldMatrix(true, false);
        marker.userData.controlOwnerLastWorldMatrix = owner.matrixWorld.toArray();
      } else {
        marker.userData.controlOwnerLastWorldMatrix = null;
      }
    };
    const syncControlHandleOwnerTransforms = () => {
      selectable.filter(object => object.userData.rigControlMarker && object.parent === scene).forEach(marker => {
        const ownerId = String(marker.userData.controlOwnerObjectId || '');
        if (!ownerId) return;
        const owner = selectable.find(object => String(object.userData.editorId || '') === ownerId);
        if (!owner) return;
        owner.updateWorldMatrix(true, false);
        const currentOwnerWorld = owner.matrixWorld.clone();
        const previousValues = marker.userData.controlOwnerLastWorldMatrix;
        if (Array.isArray(previousValues) && previousValues.length === 16) {
          const previousOwnerWorld = new THREE.Matrix4().fromArray(previousValues);
          const delta = currentOwnerWorld.clone().multiply(previousOwnerWorld.invert());
          if (delta.elements.some((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0)) > 1e-8)) {
            marker.updateMatrix();
            marker.matrix.premultiply(delta);
            marker.matrix.decompose(marker.position, marker.quaternion, marker.scale);
            marker.updateMatrixWorld(true);
          }
        }
        marker.userData.controlOwnerLastWorldMatrix = currentOwnerWorld.toArray();
      });
    };
    let ikSpringConfig = { enabled: false, strength: 35, damping: 75, followThrough: 40 };
    const configureIkSpring = (next: Partial<typeof ikSpringConfig>) => {
      ikSpringConfig = { ...ikSpringConfig, ...next };
      if (!ikSpringConfig.enabled) activeIkSpring = null;
    };
    transform.addEventListener('objectChange', () => {
      const activeControl = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      if (activeControl?.userData.rigControlMarker && !activeControl.userData.controlLocked) {
        const ownerBone = selectable.find(object => object instanceof THREE.Bone && String(object.userData.editorId) === String(activeControl.userData.controlOwnerBoneId)) as THREE.Bone | undefined || null;
        const chain = ownerBone ? resolveRigChainForObject(ownerBone) : null;
        if (chain && ownerBone) {
          scene.updateMatrixWorld(true);
          const targetWorld = activeControl.getWorldPosition(new THREE.Vector3());
          const chainLength = Math.max(1, chain.bones.length - 1);
          if (transform.getMode() === 'rotate') {
            // The orange Control Handle is an orientation target in Rotate mode.
            // Apply only the handle's incremental world-space rotation to its exact owner bone.
            const currentHandleWorld = activeControl.getWorldQuaternion(new THREE.Quaternion());
            const previousValues = activeControl.userData.controlLastWorldQuaternion;
            const previousHandleWorld = Array.isArray(previousValues) && previousValues.length === 4
              ? new THREE.Quaternion().fromArray(previousValues)
              : currentHandleWorld.clone();
            const rotationDelta = currentHandleWorld.clone().multiply(previousHandleWorld.clone().invert());
            if (rotationDelta.angleTo(new THREE.Quaternion()) > 1e-7 && !isIkBoneLocked(ownerBone)) {
              const ownerWorld = ownerBone.getWorldQuaternion(new THREE.Quaternion());
              const desiredOwnerWorld = rotationDelta.multiply(ownerWorld);
              const parentWorld = ownerBone.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion();
              ownerBone.quaternion.copy(parentWorld.invert().multiply(desiredOwnerWorld)).normalize();
              ownerBone.updateMatrixWorld(true);
              refreshRigVisuals();
            }
            activeControl.userData.controlLastWorldQuaternion = currentHandleWorld.toArray();
            activeIkSpring = null;
          } else if (transform.getMode() === 'translate') {
            const childBone = chain.bones.filter(bone => bone.parent === ownerBone).sort((a,b) =>
              a.getWorldPosition(new THREE.Vector3()).distanceToSquared(targetWorld) -
              b.getWorldPosition(new THREE.Vector3()).distanceToSquared(targetWorld)
            )[0];
            if (!ikSpringConfig.enabled) {
              activeIkSpring = null;
              solveIK(chainLength, targetWorld);
            } else if (!activeIkSpring || activeIkSpring.marker !== activeControl) {
              const initial = childBone?.getWorldPosition(new THREE.Vector3()) || ownerBone.getWorldPosition(new THREE.Vector3());
              activeIkSpring = { marker: activeControl, ownerBone, chainLength, current: initial, target: targetWorld.clone(), velocity: new THREE.Vector3(), lastTime: performance.now() };
            } else {
              activeIkSpring.target.copy(targetWorld);
            }
          }
        }
      }
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
      const isWithinOwner = (owner: THREE.Object3D | null | undefined, object: THREE.Object3D | null | undefined) => {
        let current = object;
        while (current) { if (current === owner) return true; current = current.parent; }
        return false;
      };
      const chain = [...rigChains].reverse().find(entry =>
        entry.bones.length > 1 && (entry.shapeRig === true || Boolean(entry.owner)) &&
        (entry.owner === selectedObject || isWithinOwner(entry.owner, selectedObject) ||
          (!entry.owner && String(entry.bones[0]?.userData.rigOwnerId || '') === selectedOwnerId))
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
      const originalParent = mesh.parent || scene;
      const rigContainerParent = chain.owner && chain.owner !== mesh && !(chain.owner as any).isMesh
        ? chain.owner
        : originalParent;
      rigContainerParent.add(rigGroup);
      scene.updateMatrixWorld(true);
      rigGroup.attach(rigRoot);

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
        helper.visible = true;
        (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff); scene.add(helper);
        bones.forEach(bone => { if (!bone.userData.editorId) bone.userData.editorId = uid(); bone.userData.kind = 'Bone'; ensureBoneJoint(bone); if (!selectable.includes(bone)) selectable.push(bone); });
        rigChains.push({ bones: [...bones], helper, target: null, displayVisible: true, owner: rootObject || node.parent || null }); found += 1;
      });
      syncItems();
      setStatus(found ? 'Detected ' + found + ' existing skinned rig(s)' : 'No existing SkinnedMesh skeleton found. Import a rigged humanoid GLB/GLTF for automatic skeleton detection.');
      return found;
    };
    const resolveCharacterRigContext = (selectedObject?: THREE.Object3D | null) => {
      const selected = selectedObject || selectable.find(o => String(o.userData.editorId) === selectedRef.current) || null;
      const isInside = (root: THREE.Object3D | null | undefined, object: THREE.Object3D | null) => {
        let current = object;
        while (current) { if (current === root) return true; current = current.parent; }
        return false;
      };
      const chain = selected instanceof THREE.Bone
        ? rigChains.find(entry => entry.bones.includes(selected))
        : [...rigChains].reverse().find(entry =>
            Boolean(entry.owner && (entry.owner === selected || isInside(entry.owner, selected))) ||
            Boolean(selected && entry.bones.some(bone => selected.getObjectById(bone.id)))
          ) || (rigChains.length === 1 ? rigChains[0] : null);
      const owner = chain?.owner || (selected instanceof THREE.Bone ? null : selected);
      return { selected, chain, owner };
    };
    const detectCharacterBodyParts = () => {
      const context = resolveCharacterRigContext();
      if (!context.chain || !context.owner) {
        setStatus('Select the Character Group or one of its bones, and make sure its Humanoid Rig exists');
        return [];
      }
      const meshes: THREE.Object3D[] = [];
      context.owner.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (!isCharacterMeshCandidate(mesh) || node === context.owner || (mesh as any).isSkinnedMesh ||
            mesh.geometry.getAttribute('skinIndex') || mesh.geometry.getAttribute('skinWeight')) return;
        meshes.push(mesh);
      });
      scene.updateMatrixWorld(true);
      const meshDescriptors = meshes.map(mesh => {
        const meshBounds = new THREE.Box3().setFromObject(mesh);
        const worldPosition = meshBounds.isEmpty()
          ? mesh.getWorldPosition(new THREE.Vector3())
          : meshBounds.getCenter(new THREE.Vector3());
        return {
          object: mesh,
          name: mesh.name,
          isMesh: true,
          geometry: mesh.geometry,
          userData: mesh.userData,
          worldPosition
        };
      });
      const boneDescriptors = context.chain.bones.map(bone => ({
        bone,
        name: bone.name,
        worldPosition: bone.getWorldPosition(new THREE.Vector3())
      }));
      const assignments = buildCharacterMeshAssignments(meshDescriptors, boneDescriptors);
      context.owner.userData.nexusRigAssignments = assignments.map(item => ({
        meshId: String(item.mesh.object.userData.editorId || ''),
        boneId: String(item.bone?.bone?.userData.editorId || ''),
        meshName: item.mesh.name,
        boneName: item.bone?.bone?.name || '',
        part: item.part || null,
        side: item.side || null,
        confidence: item.confidence,
        needsReview: item.needsReview,
        reason: item.reason,
        mode: item.mode
      }));
      const summary = summarizeCharacterAssignments(assignments);
      setStatus('Body-part detection complete · ' + summary.ready + ' named match(es) · ' + summary.review + ' spatial match(es) need review · ' + summary.unassigned + ' unassigned');
      return assignments;
    };
    const bindAllCharacterMeshesToRig = () => {
      const context = resolveCharacterRigContext();
      if (!context.chain || !context.owner) {
        setStatus('Select the Character Group or one of its bones before Bind All');
        return false;
      }
      if (context.owner instanceof THREE.Mesh) {
        setStatus('For multi-part Auto Bind, select the parent Character Group rather than one individual mesh');
        return false;
      }
      const assignments = detectCharacterBodyParts();
      if (!assignments.length) { setStatus('No unbound body-part meshes found under this Character Group'); return false; }
      scene.updateMatrixWorld(true);
      let bound = 0, alreadyBound = 0, unassigned = 0;
      for (const assignment of assignments) {
        const mesh = assignment.mesh.object as THREE.Mesh;
        const bone = assignment.bone?.bone as THREE.Bone | undefined;
        if (!mesh || !bone) { unassigned += 1; continue; }
        if (mesh === context.owner || mesh.getObjectById(bone.id)) { unassigned += 1; continue; }
        if (mesh.userData.rigBinding?.boneId === String(bone.userData.editorId)) { alreadyBound += 1; continue; }
        bone.attach(mesh);
        mesh.userData.rigBinding = {
          rigId: String(context.chain.bones[0]?.userData.editorId || ''),
          boneId: String(bone.userData.editorId || ''),
          part: assignment.part || null,
          side: assignment.side || null,
          mode: 'rigid',
          source: 'auto',
          confidence: assignment.confidence,
          needsReview: assignment.needsReview
        };
        mesh.userData.rigPartKey = (assignment.part || 'part') + (assignment.side || '');
        const currentIds = Array.isArray(bone.userData.rigBoundMeshIds) ? bone.userData.rigBoundMeshIds : [];
        if (!currentIds.includes(String(mesh.userData.editorId || ''))) currentIds.push(String(mesh.userData.editorId || ''));
        bone.userData.rigBoundMeshIds = currentIds;
        bound += 1;
      }
      context.chain.owner = context.owner;
      scene.updateMatrixWorld(true);
      refreshRigVisuals();
      syncItems();
      selectObject(context.owner);
      const summary = summarizeCharacterAssignments(assignments);
      setStatus('Multi-Mesh Bind complete · ' + bound + ' rigid part(s) attached · ' + alreadyBound + ' already bound · ' + unassigned + ' unassigned · ' + summary.review + ' assignment(s) flagged for review');
      return bound > 0 || alreadyBound > 0;
    };
    const createIKTarget = () => {
      const selectedObject = selectable.find(object => String(object.userData.editorId) === selectedRef.current);
      const selectedBone = selectedObject instanceof THREE.Bone ? selectedObject : undefined;
      const activeChain = resolveRigChainForObject(selectedObject) ||
        (rigChains.length === 1 ? rigChains[0] : null);
      if (!activeChain || !activeChain.bones.length) {
        setStatus('Select the intended rig, Shape, or one of its bones before creating an IK target');
        return null;
      }
      const endBone = selectedBone && activeChain.bones.includes(selectedBone)
        ? selectedBone
        : activeChain.bones[activeChain.bones.length - 1];
      const targetPosition = endBone.getWorldPosition(new THREE.Vector3());
      let target = activeChain.target as THREE.Mesh | null;
      if (!target) {
        target = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb45e, wireframe: true }));
        target.name = 'IK Target Handle';
        target.userData.editorId = uid();
        target.userData.kind = 'IK Target';
        scene.add(target);
        selectable.push(target);
        activeChain.target = target;
      }
      target.position.copy(targetPosition);
      target.userData.ikEndBoneId = endBone.userData.editorId;
      target.userData.rigRootBoneId = activeChain.bones[0]?.userData.editorId || null;
      syncItems();
      selectObject(target);
      setStatus('IK target ready for ' + endBone.name + ' · move it with the gizmo, then Solve Manual IK');
      return target;
    };
    const solveIK = (chainLength = 3, controlTarget?: THREE.Vector3, controlHandleOverride?: THREE.Object3D) => {
      const selectedObject = selectable.find(object => String(object.userData.editorId) === selectedRef.current);
      // Keyframe playback can drive a Control Handle even when another object is selected.
      const controlHandle = controlHandleOverride || (selectedObject?.userData.rigControlMarker ? selectedObject : null);
      const controlBone = controlHandle ? selectable.find(object => object instanceof THREE.Bone && String(object.userData.editorId) === String(controlHandle.userData.controlOwnerBoneId)) as THREE.Bone | undefined || null : null;
      const chain = (controlBone ? resolveRigChainForObject(controlBone) : resolveRigChainForObject(selectedObject)) ||
        (rigChains.filter(entry => entry.target).length === 1 ? rigChains.find(entry => entry.target) : null);
      if (!chain || (!chain.target && !controlTarget)) { setStatus('Select the intended rig and create an IK target or Control Handle first'); return; }
      const controlChildBone = controlBone
        ? chain.bones.filter(bone => bone.parent === controlBone).sort((a, b) =>
            a.getWorldPosition(new THREE.Vector3()).distanceToSquared((controlHandle as THREE.Object3D).getWorldPosition(new THREE.Vector3())) -
            b.getWorldPosition(new THREE.Vector3()).distanceToSquared((controlHandle as THREE.Object3D).getWorldPosition(new THREE.Vector3()))
          )[0] || null
        : null;
      const endBone = controlChildBone || controlBone ||
        chain.bones.find(bone => String(bone.userData.editorId) === String(chain.target?.userData.ikEndBoneId)) ||
        chain.bones[chain.bones.length-1];
      const path: THREE.Bone[] = [];
      let cursor: THREE.Object3D | null = endBone;
      while (cursor && path.length < 32) { if (cursor instanceof THREE.Bone && chain.bones.includes(cursor)) path.push(cursor); cursor = cursor.parent; }
      const bones = getIkSolvePath(path.reverse(), chainLength);
      if (bones.length < 2) {
        setStatus(isIkBoneLocked(bones[0]) ? 'Locked IK anchor has no movable child segment · select an unlocked child bone or its Control Handle' : 'Select a limb bone before creating its IK target');
        return;
      }
      const anchorLocked = isIkBoneLocked(bones[0]);
      const targetPosition = controlTarget ? controlTarget.clone() : chain.target!.getWorldPosition(new THREE.Vector3());
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
            if (isIkBoneLocked(bone)) continue;
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
          if (isIkBoneLocked(bone)) continue;
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
      const poleMiddleIndex = anchorLocked ? 2 : 1;
      const poleBoneIndex = anchorLocked ? 1 : 0;
      if (chain.pole && bones.length > poleMiddleIndex) {
        scene.updateMatrixWorld(true);
        const start = bones[0].getWorldPosition(new THREE.Vector3());
        const end = endBone.getWorldPosition(new THREE.Vector3());
        const axis = end.clone().sub(start).normalize();
        const middle = bones[poleMiddleIndex].getWorldPosition(new THREE.Vector3()).sub(start);
        const pole = chain.pole.getWorldPosition(new THREE.Vector3()).sub(start);
        middle.addScaledVector(axis,-middle.dot(axis)); pole.addScaledVector(axis,-pole.dot(axis));
        if (middle.lengthSq()>1e-8 && pole.lengthSq()>1e-8) {
          const angle = Math.atan2(axis.dot(middle.clone().cross(pole)),middle.dot(pole));
          // With a locked anchor, apply pole correction to its first movable child,
          // never to the locked anchor itself.
          const rootBone = bones[poleBoneIndex];
          if (!isIkBoneLocked(rootBone)) {
            const desired = rootBone.getWorldQuaternion(new THREE.Quaternion());
            desired.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,angle));
            if (rootBone.parent) rootBone.quaternion.copy(rootBone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
            else rootBone.quaternion.copy(desired);
          }
        }
      }
      chain.helper.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      if (!controlTarget) {
        syncItems();
        setStatus(ikSolverRef.current + ' IK + pole constraint solved · ' + bones.length + ' joints');
      }
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
          chain.helper.visible = chain.displayVisible !== false;
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
            chain.helper.visible = chain.displayVisible !== false;
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
      const viewCamera = runtime.current?.animationView || runtime.current?.cameraView ? activeCamera : camera;
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
      if (!runtime.current?.loopCutActive || editModeRef.current !== 'Face' || faceSelectionToolRef.current !== 'Face' || !active?.mesh || active.mesh !== selectable.find(o => String(o.userData.editorId) === selectedRef.current)) return;
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
      const viewCamera = runtime.current?.cameraView || runtime.current?.animationView ? activeCamera : camera;
      raycaster.setFromCamera(pointer, viewCamera);
      const alphabetMarkerHit = raycaster.intersectObjects(Array.from(alphabetStateMarkers.values()), false)[0];
      if (alphabetMarkerHit) {
        // Alphabet State world markers are selectable only while the Animation
        // workspace is active. In the regular Main Viewport they are display-only.
        if (!runtime.current?.animationView) return;
        const marker = alphabetMarkerHit.object as THREE.Sprite;
        const stateId = String(marker.userData.alphabetStateId || '');
        if (stateId) {
          setSelectedSequenceState(stateId);
          setSelected3DAlphabetMarkerId(stateId);
          runtime.current?.setSelectedAlphabetStateMarker?.(stateId);
          const ownerId = String(marker.userData.ownerObjectId || '');
          const owner = selectable.find(object => String(object.userData.editorId || '') === ownerId);
          if (owner) selectObject(owner);
          setCurrentFrame(Number(marker.userData.startFrame) || 1);
          setStatus('Selected Alphabet State ' + marker.name.replace('Alphabet State Marker ', '') + ' from Animation Viewport');
        }
        return;
      }
      raycaster.params.Line = { threshold: Math.max(0.025, viewCamera.position.length() * 0.0035) };
      const targetRoot = selectable.find(o => String(o.userData.editorId) === selectedRef.current);
      // Include visible manual skeleton helpers so their segments can be picked
      // even when the rig is parented inside a Shape/Character mesh.
      const visibleRigHelpers = editModeRef.current === 'Object'
        ? rigChains.filter(chain => chain.shapeRig && chain.displayVisible !== false && chain.helper.visible).map(chain => chain.helper)
        : [];
      const visibleControlHandles = selectable.filter(object => object.userData.rigControlMarker && object.visible);
      const roots = editModeRef.current === 'Object' ? [...selectable.filter(o => o.visible), ...visibleRigHelpers] : [...(targetRoot ? [targetRoot] : []), ...visibleControlHandles];
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
            if (editModeRef.current === 'Face' && faceSelectionToolRef.current === 'Vertex') {
              const selectedVertex = tri.reduce((best, index) => localHit.distanceTo(localVertex(index)) < localHit.distanceTo(localVertex(best)) ? index : best, tri[0]);
              // Move every render vertex at this logical position so adjacent triangles
              // and split-normal/UV seam copies stay visually connected.
              indices = coincidentVertexIndices(selectedVertex);
              pivotLocal.copy(localVertex(selectedVertex));
              const marker = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshBasicMaterial({ color: 0x55f5ff, emissive: 0x159ab5, depthTest: false }));
              marker.position.copy(mesh.localToWorld(pivotLocal.clone())); marker.renderOrder = 1000; subObjectHighlight.add(marker);
            } else if (editModeRef.current === 'Face' && faceSelectionToolRef.current === 'Edge') {
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
      const alphabetMarkerHit = raycaster.intersectObjects(Array.from(alphabetStateMarkers.values()), false)[0];
      // The IK viewport does not own Alphabet State selection; only the
      // Animation workspace may select these world-space letter markers.
      if (alphabetMarkerHit) return;
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
    let subTopologyBefore: any = null;
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
      // Move Face must preserve the existing mesh boundary: include coincident render
      // vertices on adjacent faces so shared cube edges stay connected. This deforms the
      // existing side faces; it does not create Extrude wall geometry. Explicit linked
      // selections remain isolated to their declared indices.
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
      if (selection.mesh.userData.nexusQuadGrid || selection.mesh.userData.nexusTopology?.version === 1) {
        const topologyPosition = selection.mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        const existingTopology = selection.mesh.userData.nexusTopology;
        // Move Face changes coordinates, not connectivity. Prefer the stored
        // face loops. If an earlier commit did not persist them, rebuild only
        // from the explicitly marked canonical/indexed quad layout, never from
        // arbitrary triangle-pair guessing.
        const sourceTopology = existingTopology?.version === 1
          ? existingTopology
          : topologyPosition
            ? selection.mesh.geometry.index
              ? buildTopologyFromIndexedQuadGeometry(topologyPosition.array, selection.mesh.geometry.index.array)
              : selection.mesh.userData.nexusQuadGridLayout === 'canonical-v1'
                ? buildTopologyFromCanonicalQuadGeometry(topologyPosition.array)
                : null
            : null;
        const updatedTopology = topologyPosition && sourceTopology
          ? updateTopologyPositionsFromRenderGeometry(
              sourceTopology,
              topologyPosition.array,
              selection.mesh.geometry.index?.array || null
            )
          : null;
        if (updatedTopology) {
          selection.mesh.userData.nexusTopology = updatedTopology;
          recordInteractionTrace('Persistent topology positions updated', {
            operation: 'Move Face',
            faceCount: updatedTopology.faces.length,
            vertexCount: updatedTopology.vertices.length,
            source: existingTopology?.version === 1 ? 'stored-face-loops' : 'verified-quad-layout-recovery',
            recoveredMissingTopology: existingTopology?.version !== 1,
          });
        } else {
          delete selection.mesh.userData.nexusTopology;
          recordInteractionTrace('Persistent topology update rejected', {
            operation: 'Move Face',
            reason: 'Stored face-loop render mapping did not match the deformed geometry',
            faceCount: existingTopology?.faces?.length || 0,
            vertexCount: topologyPosition?.count || 0,
          });
        }
      }
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
      recordInteractionTrace('Transform gizmo drag started', { axis: transform.axis ?? null, mode: transform.getMode(), space: spaceRef.current, selectedId: selectedRef.current, position: transform.object ? transform.object.position.toArray() : null, rotation: transform.object ? [transform.object.rotation.x, transform.object.rotation.y, transform.object.rotation.z] : null, scale: transform.object ? transform.object.scale.toArray() : null });
      syncViewportControls(true);
      const object = transform.object;
      if (object === subObjectPivot && activeSubSelection) {
        subGeometryBefore = activeSubSelection.mesh.geometry.clone();
        subTopologyBefore = activeSubSelection.mesh.userData.nexusTopology
          ? JSON.parse(JSON.stringify(activeSubSelection.mesh.userData.nexusTopology)) : null;
      }
      else transformBefore = object ? { object, state: snapshot(object) } : null;
    });
    let lastDfiGizmoSampleAt = 0;
    transform.addEventListener('objectChange', () => {
      const now = Date.now();
      if (now - lastDfiGizmoSampleAt < 120) return;
      lastDfiGizmoSampleAt = now;
      const object = transform.object;
      if (!object) return;
      recordInteractionTrace('Gizmo transform sample', {
        axis: transform.axis ?? null, mode: transform.getMode(), space: spaceRef.current,
        selectedId: selectedRef.current, objectName: object.name || null,
        position: object.position.toArray(),
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: object.scale.toArray()
      });
    });
    transform.addEventListener('mouseUp', () => {
      controlDiag('transform:mouseUp');
      recordInteractionTrace('Transform gizmo drag ended', { axis: transform.axis ?? null, mode: transform.getMode(), space: spaceRef.current, selectedId: selectedRef.current, position: transform.object ? transform.object.position.toArray() : null, rotation: transform.object ? [transform.object.rotation.x, transform.object.rotation.y, transform.object.rotation.z] : null, scale: transform.object ? transform.object.scale.toArray() : null });
      syncViewportControls(false);
      if (subGeometryBefore && activeSubSelection && activeEditToolRef.current !== 'Extrude' && editModeRef.current === 'Face' && transform.getMode() === 'translate') {
        // Move Face is a transform-only command: move the selected face without
        // generating connecting side walls. Only the dedicated Extrude command
        // is allowed to create new wall geometry.
        recordInteractionTrace('Move Face committed · no extrusion walls', {
          operation: 'Move Face',
          objectId: String(activeSubSelection.mesh.userData.editorId || ''),
          selectedFaceCount: activeSubSelection.faceParts?.length || 0,
          generatedWallQuadCount: 0,
        });
      }
      if (subGeometryBefore && activeSubSelection) {
        const mesh = activeSubSelection.mesh;
        const beforeGeometry = subGeometryBefore.clone();
        const afterGeometry = mesh.geometry.clone();
        if (beforeGeometry.getAttribute('position').count !== afterGeometry.getAttribute('position').count || beforeGeometry.getAttribute('position').array.some((value: number, index: number) => value !== afterGeometry.getAttribute('position').array[index])) {
          const beforeTopology = subTopologyBefore ? JSON.parse(JSON.stringify(subTopologyBefore)) : null;
          const afterTopology = mesh.userData.nexusTopology ? JSON.parse(JSON.stringify(mesh.userData.nexusTopology)) : null;
          recordSceneAction({ label: 'Move sub-object ' + mesh.name, undo: () => { mesh.geometry.dispose(); mesh.geometry = beforeGeometry.clone(); mesh.geometry.computeVertexNormals(); if (beforeTopology) mesh.userData.nexusTopology = JSON.parse(JSON.stringify(beforeTopology)); else delete mesh.userData.nexusTopology; }, redo: () => { mesh.geometry.dispose(); mesh.geometry = afterGeometry.clone(); mesh.geometry.computeVertexNormals(); if (afterTopology) mesh.userData.nexusTopology = JSON.parse(JSON.stringify(afterTopology)); else delete mesh.userData.nexusTopology; } });
        } else beforeGeometry.dispose();
        subGeometryBefore.dispose(); subGeometryBefore = null;
        subTopologyBefore = null;
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
      const createAlphabetStateMarker = (label: string, stateId: string, objectId?: string, startFrame = 1) => {
        if (alphabetStateMarkers.has(stateId)) return;
        const ownerId = String(objectId || selectedRef.current);
        const owner = selectable.find(object => String(object.userData.editorId || '') === ownerId);
        if (!owner) return;
        owner.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(owner);
        if (bounds.isEmpty()) return;
        const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
        // Markers live in the scene root, not under the moving object. Their first
        // world-space placement is therefore permanent when the owner is transformed.
        const diameter = THREE.MathUtils.clamp(Math.max(size.x,size.z,size.y*0.65)*0.32,0.42,1.8);
        const ownerMarkerCount = Array.from(alphabetStateMarkers.values()).filter(marker => String(marker.userData.ownerObjectId || '') === ownerId).length;
        const worldPosition = new THREE.Vector3(center.x + ownerMarkerCount * diameter * 1.18,bounds.min.y-diameter*0.58,center.z);
        const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=512;
        const context=canvas.getContext('2d'); if(!context)return;
        context.beginPath(); context.arc(256,256,224,0,Math.PI*2); context.fillStyle='rgba(5,18,31,0.96)'; context.fill();
        context.lineWidth=24; context.strokeStyle='#43dfff'; context.stroke();
        context.font='800 220px Arial,sans-serif'; context.textAlign='center'; context.textBaseline='middle';
        context.fillStyle='#e8fbff'; context.shadowColor='#27dfff'; context.shadowBlur=22; context.fillText(label,256,266);
        const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
        const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false,sizeAttenuation:true});
        const sprite=new THREE.Sprite(material); sprite.name='Alphabet State Marker '+label;
        scene.add(sprite); sprite.position.copy(worldPosition);
        sprite.scale.set(diameter*1.55,diameter*1.55,1);
        sprite.renderOrder=20;
        sprite.userData.alphabetStateId=stateId;
        sprite.userData.ownerObjectId=ownerId;
        sprite.userData.startFrame=startFrame;
        sprite.userData.markerCanvas=canvas;
        sprite.userData.markerTexture=texture;
        sprite.userData.baseDiameter=diameter;
        alphabetStateMarkers.set(stateId,sprite);
      };
      const removeAlphabetStateMarker = (stateId: string) => {
        const marker = alphabetStateMarkers.get(stateId);
        if (!marker) return;
        scene.remove(marker);
        const material = marker.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
        alphabetStateMarkers.delete(stateId);
      };
      const setSelectedAlphabetStateMarker = (selectedStateId: string) => {
        alphabetStateMarkers.forEach((marker, stateId) => {
          const canvas = marker.userData.markerCanvas as HTMLCanvasElement | undefined;
          const texture = marker.userData.markerTexture as THREE.CanvasTexture | undefined;
          const context = canvas?.getContext('2d');
          if (!canvas || !context || !texture) return;
          const selected = stateId === selectedStateId;
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.beginPath(); context.arc(256,256,224,0,Math.PI*2);
          context.fillStyle = selected ? 'rgba(0,48,66,0.98)' : 'rgba(5,18,31,0.96)'; context.fill();
          context.lineWidth = selected ? 34 : 24;
          context.strokeStyle = selected ? '#ffe45c' : '#43dfff';
          context.shadowColor = selected ? '#ffe45c' : '#27dfff';
          context.shadowBlur = selected ? 42 : 22;
          context.stroke();
          context.shadowBlur = selected ? 24 : 22;
          context.font='800 220px Arial,sans-serif'; context.textAlign='center'; context.textBaseline='middle';
          context.fillStyle = selected ? '#fff4a6' : '#e8fbff';
          context.fillText(String(marker.name.replace('Alphabet State Marker ', '')),256,266);
          texture.needsUpdate = true;
          const diameter = Number(marker.userData.baseDiameter || 1);
          marker.scale.set(diameter * (selected ? 1.68 : 1.55), diameter * (selected ? 1.68 : 1.55), 1);
        });
      };
    let diagnosticFrameLastAt = 0;
    let diagnosticFrameAverageMs = 0;
    let diagnosticFrameMaxMs = 0;
    let diagnosticFrameSamples = 0;
    const getRenderDiagnostics = () => ({
      frameAverageMs: Number(diagnosticFrameAverageMs.toFixed(2)),
      frameMaxMs: Number(diagnosticFrameMaxMs.toFixed(2)),
      frameSamples: diagnosticFrameSamples
    });
      runtime.current = { ...(runtime.current || {}), scene, camera, activeCamera, renderer, orbit, activeOrbit, ikCamera, ikRenderer, ikOrbit, transform, selectable, createAlphabetStateMarker, setSelectedAlphabetStateMarker, syncViewportControls, removeAlphabetStateMarker, syncItems, addObject, attachRootToShape, configureIkSpring, captureRigStateFor, restoreRigState, getRenderDiagnostics, setPerformanceMode: (enabled: boolean) => { performanceModeActive = enabled; const pixelRatio = getNexusRenderPixelRatio(window.devicePixelRatio || 1, { native: Capacitor.isNativePlatform(), performanceMode: enabled }); renderer.setPixelRatio(pixelRatio); const renderHost = runtime.current?.riggingView && ikHost ? ikHost : host; renderer.setSize(Math.max(renderHost.clientWidth, 1), Math.max(renderHost.clientHeight, 1), false); renderer.shadowMap.enabled = !enabled; renderer.renderLists.dispose(); renderer.info.reset(); }, createManualRig, bindSelectedMeshToRig, createIKTarget, solveIK, mirrorSelectedBone, deleteSelectedBone, createPoleTarget, detectRiggedMeshes, detectCharacterBodyParts, bindAllCharacterMeshesToRig, normalizeSelectedSkinWeights, smoothSelectedSkinWeights, addUniversalBone, copySelectedBone, setRigParentTarget, attachSelectedToRigParent, detachSelectedRigObject, toggleSelectedBoneControlHandle, toggleSelectedBoneLock, toggleSelectedControlLock, refreshRigVisuals, toggleBoneDisplay, isBoneDisplayVisible, toggleSelectedRigDisplay, restoreRigGroup: (rig: THREE.Object3D) => { const bones: THREE.Bone[] = []; rig.traverse(node => { if ((node as THREE.Bone).isBone) { bones.push(node as THREE.Bone); ensureBoneJoint(node as THREE.Bone); } }); if (!bones.length || rigChains.some(entry => entry.bones[0] === bones[0])) return; const helper = new THREE.SkeletonHelper(bones[0]); helper.name = rig.name + ' Skeleton'; (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff); helper.visible = true; scene.add(helper); const owner = rig.parent && rig.parent !== scene ? rig.parent : selectable.find(object => String(object.userData.editorId || '') === String(rig.userData.rigOwnerId || '')) || null; rigChains.push({ bones, helper, target: null, pole: null, displayVisible: true, shapeRig: true, owner }); }, attachRigHandle: (handle: THREE.Object3D, rootId: string, kind: string) => { const chain = rigChains.find(entry => String(entry.bones[0]?.userData.editorId) === String(rootId)); if (!chain) return; if (kind === 'IK Target') chain.target = handle; if (kind === 'IK Pole') chain.pole = handle; }, restoreSkinnedMesh: (mesh: THREE.SkinnedMesh, bones: THREE.Bone[], savedSkeleton?: any) => { const inverses = Array.isArray(savedSkeleton?.boneInverses) && savedSkeleton.boneInverses.length === bones.length ? savedSkeleton.boneInverses.map((elements: number[]) => new THREE.Matrix4().fromArray(elements)) : undefined; const skeleton = new THREE.Skeleton(bones, inverses); if (!inverses) skeleton.calculateInverses(); const bindMatrix = Array.isArray(savedSkeleton?.bindMatrix) && savedSkeleton.bindMatrix.length === 16 ? new THREE.Matrix4().fromArray(savedSkeleton.bindMatrix) : mesh.matrixWorld.clone(); mesh.bind(skeleton, bindMatrix); if (savedSkeleton?.bindMode) mesh.bindMode = savedSkeleton.bindMode; const existingChain = rigChains.find(entry => entry.bones[0] === bones[0]); if (!existingChain) { const helper = new THREE.SkeletonHelper(bones[0]); helper.name = mesh.name + ' Skeleton'; (helper.material as THREE.LineBasicMaterial).color.set(0x55dfff); helper.visible = true; scene.add(helper); let owner: THREE.Object3D = mesh; while (owner.parent && owner.parent !== scene) owner = owner.parent; rigChains.push({ bones, helper, target: null, pole: null, displayVisible: true, owner }); } }, selectObject, removeObject, toggleVisibility, reparentObject, reorderObject, updateLightProperty, toggleLightEnabled, camBody, lightSources, addSceneLight, applyPreset, applySettings, toggleParticle, grid, subObjectHighlight, topologyOverlay, refreshTopologyOverlay, clearSubSelection: () => { activeSubSelection = null; }, addSubObjectLocks: (objectId: string, kind: 'Vertex' | 'Edge', ids: Array<number | [number, number]>) => subObjectLockStore.add(objectId, kind, ids), getSubObjectLocks: (objectId: string, kind: 'Vertex' | 'Edge') => subObjectLockStore.get(objectId, kind), clearSubObjectLocks: (objectId?: string, kind?: 'Vertex' | 'Edge') => { if (objectId == null) subObjectLockStore.clear(); else if (kind) subObjectLockStore.clear(objectId, kind); else subObjectLockStore.clearObject(objectId); }, clearAllSubObjectLocks: () => { subObjectLockStore.clear(); activeSubSelection = null; transform.detach(); transform.enabled = false; transform.getHelper().visible = false; while (subObjectHighlight.children.length) { const child = subObjectHighlight.children[0]; subObjectHighlight.remove(child); child.traverse((node: any) => { node.geometry?.dispose?.(); if (node.material?.dispose) node.material.dispose(); }); } }, getSubObjectLockSnapshot: () => subObjectLockStore.snapshot(), getActiveSubSelection: () => activeSubSelection, setActiveSubSelection: (selection: any) => { activeSubSelection = selection; }, restoreExtrudedFaceSelection: (mesh: THREE.Mesh, indices: number[], faceParts?: number[][], linkedIndices?: number[]) => { const position = mesh.geometry.getAttribute('position'); if (!position || indices.length < 3) return; const unique = new Map<string, THREE.Vector3>(); indices.forEach(index => { if (index < 0 || index >= position.count) return; const point = new THREE.Vector3().fromBufferAttribute(position, index); const key = [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(','); unique.set(key, point); }); const center = new THREE.Vector3(); unique.forEach(point => center.add(point)); center.multiplyScalar(1 / Math.max(unique.size, 1)); const a = new THREE.Vector3().fromBufferAttribute(position, indices[0]); const b = new THREE.Vector3().fromBufferAttribute(position, indices[1]); const c = new THREE.Vector3().fromBufferAttribute(position, indices[2]); const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); mesh.updateWorldMatrix(true, false); const worldPivot = mesh.localToWorld(center.clone()); const worldNormal = normal.transformDirection(mesh.matrixWorld); subObjectPivot.position.copy(worldPivot); subObjectPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal); subObjectPivot.scale.set(1, 1, 1); activeSubSelection = { mesh, indices: [...new Set(indices)], faceParts: faceParts?.map(part => [...part]), linkedIndices: linkedIndices ? [...new Set(linkedIndices)] : undefined, lastWorld: worldPivot.clone(), lastQuaternion: subObjectPivot.quaternion.clone(), lastScale: subObjectPivot.scale.clone() }; transform.attach(subObjectPivot); transform.setMode(modeRef.current); transform.setSpace(spaceRef.current); transform.enabled = true; transform.getHelper().visible = true; } };
    const frameLoop = () => {
      const diagnosticNow = performance.now();
      if (diagnosticFrameLastAt > 0) {
        const frameMs = diagnosticNow - diagnosticFrameLastAt;
        diagnosticFrameSamples += 1;
        diagnosticFrameAverageMs += (frameMs - diagnosticFrameAverageMs) / diagnosticFrameSamples;
        diagnosticFrameMaxMs = Math.max(diagnosticFrameMaxMs, frameMs);
      }
      diagnosticFrameLastAt = diagnosticNow;
      orbit.update();
      if (runtime.current?.riggingView && ikOrbit) ikOrbit.update();
      if (!runtime.current?.cameraView && !runtime.current?.animationView) {
        activeCamera.position.copy(camBody.position);
        activeCamera.quaternion.copy(camBody.quaternion);
      } else {
        activeOrbit.update();
      }
      const inCam = Boolean(runtime.current?.cameraView || runtime.current?.animationView);
      // Keep Manual Shape Rig connection lines synchronized with live bone transforms.
      // SkeletonHelper.update() is not automatic when bones move through TransformControls.
      if (activeIkSpring) {
        const now = performance.now();
        const dt = THREE.MathUtils.clamp((now - activeIkSpring.lastTime) / 1000, 0.001, 0.033);
        activeIkSpring.lastTime = now;
        const displacement = activeIkSpring.target.clone().sub(activeIkSpring.current);
        // User-adjustable spring response; disabling spring bypasses this loop entirely.
        const strength = 8 + ikSpringConfig.strength * 0.52;
        const followThroughFactor = 1 - ikSpringConfig.followThrough * 0.006;
        const damping = 4 + ikSpringConfig.damping * 0.18;
        const acceleration = displacement.multiplyScalar(strength * followThroughFactor).addScaledVector(activeIkSpring.velocity, -damping);
        activeIkSpring.velocity.addScaledVector(acceleration, dt);
        activeIkSpring.current.addScaledVector(activeIkSpring.velocity, dt);
        solveIK(activeIkSpring.chainLength, activeIkSpring.current);
        if (activeIkSpring.current.distanceToSquared(activeIkSpring.target) < 0.000004 && activeIkSpring.velocity.lengthSq() < 0.0004) {
          activeIkSpring.current.copy(activeIkSpring.target);
          solveIK(activeIkSpring.chainLength, activeIkSpring.current);
          activeIkSpring = null;
        }
      }
      syncControlHandleOwnerTransforms();
      if (rigChains.some(chain => chain.displayVisible !== false)) {
        scene.updateMatrixWorld(true);
        rigChains.forEach(chain => {
          if (chain.displayVisible !== false) {
            // Three.js SkeletonHelper refreshes its line geometry through its
            // updateMatrixWorld override; call that supported API after bones move.
            chain.helper.updateMatrixWorld(true);
          }
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
      if (!performanceModeActive && mirrorObject) {
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
    // Capture the selected object and every bone/control belonging to its rig.
    // Each rig element gets an independent editor-ID track for pose editing.
    const selectedRigRootId = String(obj.userData.rigRootBoneId || '');
    const selectedRigRoot = selectedRigRootId
      ? r.selectable.find((candidate: THREE.Object3D) => String(candidate.userData.editorId || '') === selectedRigRootId)
      : null;
    const ownerId = obj instanceof THREE.Bone
      ? String(obj.userData.rigOwnerId || '')
      : String(obj.userData.rigControlMarker ? obj.userData.controlOwnerObjectId || '' : selectedRigRoot?.userData.rigOwnerId || obj.userData.editorId || '');
    const targets = new Map<string, THREE.Object3D>();
    targets.set(id, obj);
    if (ownerId) {
      const owner = r.selectable.find((candidate: THREE.Object3D) => String(candidate.userData.editorId || '') === ownerId);
      const rigBoneIds = new Set<string>();
      if (owner) {
        targets.set(ownerId, owner);
        // Include both ordinary descendant bones and bones referenced by imported
        // SkinnedMesh skeletons (which are not always children of the selected mesh).
        owner.traverse((node: THREE.Object3D) => {
          if (node instanceof THREE.Bone) {
            if (!node.userData.editorId) node.userData.editorId = uid();
            node.userData.rigOwnerId = ownerId;
            const boneId = String(node.userData.editorId);
            rigBoneIds.add(boneId);
            targets.set(boneId, node);
          }
          if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
            ((node as THREE.SkinnedMesh).skeleton?.bones || []).forEach((bone: THREE.Bone) => {
              if (!bone.userData.editorId) bone.userData.editorId = uid();
              bone.userData.rigOwnerId = ownerId;
              const boneId = String(bone.userData.editorId);
              rigBoneIds.add(boneId);
              targets.set(boneId, bone);
            });
          }
        });
      }
      const rigBones = r.selectable.filter((candidate: THREE.Object3D) =>
        candidate instanceof THREE.Bone && String(candidate.userData.rigOwnerId || '') === ownerId
      );
      rigBones.forEach((bone: THREE.Object3D) => {
        if (bone.userData.editorId) {
          const boneId = String(bone.userData.editorId);
          rigBoneIds.add(boneId);
          targets.set(boneId, bone);
        }
      });
      r.selectable.forEach((candidate: THREE.Object3D) => {
        const isHandle = Boolean(candidate.userData.rigControlMarker) && String(candidate.userData.controlOwnerObjectId || '') === ownerId;
        const isIkTarget = Boolean(candidate.userData.rigRootBoneId) && rigBoneIds.has(String(candidate.userData.rigRootBoneId));
        if ((isHandle || isIkTarget) && candidate.userData.editorId) targets.set(String(candidate.userData.editorId), candidate);
      });
    }
    targets.forEach((target, targetId) => {
      next[targetId] = { ...(next[targetId] || {}), [frameRef.current]: snapshot(target) };
    });
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
      const selectedObject = runtime.current?.selectable.find((object: THREE.Object3D) => String(object.userData.editorId) === selectedRef.current);
      const editingSubObject = editModeRef.current !== 'Object' && Boolean(active);
      const isControlHandle = Boolean(selectedObject?.userData.rigControlMarker);
      const lockedBone = selectedObject instanceof THREE.Bone && isIkBoneLocked(selectedObject);
      const hardLocked = Boolean(selectedObject?.userData.objectManagerLocked) || (isControlHandle && Boolean(selectedObject?.userData.controlLocked));
      const canTransform = Boolean(selectedRef.current) && !hardLocked &&
        (editModeRef.current === 'Object' || editingSubObject || isControlHandle) &&
        (!lockedBone || (editModeRef.current === 'Object' && next === 'rotate'));
      if (canTransform && selectedObject && transform.object !== selectedObject) transform.attach(selectedObject);
      if (!canTransform && transform.object === selectedObject) transform.detach();
      transform.enabled = canTransform;
      transform.getHelper().visible = canTransform;
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
  const applyGeometryTool = (tool: 'Extrude' | 'Subdivide' | 'Smooth' | 'LoopCut' | 'FacesCut' | '', rawAmount: number, partOverride?: { mesh: THREE.Mesh; indices: number[]; faceParts?: number[][] }, rebuildExtrudeFromBase = false) => {
    if (!tool) return;
    if (tool !== 'Smooth') setSmoothSelectAllId('');
    const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selectedRef.current);
    const savedLoop = tool === 'LoopCut' ? loopCutContext.current : null;
    const savedExtrude = tool === 'Extrude' ? extrudeContext.current : null;
    const part = partOverride || (savedLoop && target instanceof THREE.Mesh && String(target.userData.editorId) === savedLoop.meshId ? { mesh: target, indices: savedLoop.indices } : null) || (savedExtrude && target instanceof THREE.Mesh && String(target.userData.editorId) === savedExtrude.meshId ? { mesh: target, indices: savedExtrude.indices, faceParts: savedExtrude.faceParts } : null) || runtime.current?.getActiveSubSelection?.() || ((tool === 'Subdivide' || tool === 'Smooth') && target instanceof THREE.Mesh ? { mesh: target, indices: Array.from({ length: target.geometry.getAttribute('position')?.count || 0 }, (_value, index) => index) } : null);
    if (!(target instanceof THREE.Mesh) || !part || part.mesh !== target) {
      setStatus('Select a vertex, edge, or face before using a geometry tool');
      return;
    }
    const currentVertexCount = target.geometry.getAttribute('position')?.count || 0;
    recordInteractionTrace('Geometry operation requested', {
      operation: tool,
      editMode: editModeRef.current,
      objectName: target.name || null,
      objectId: target.userData.editorId || null,
      selectionVertexCount: part.indices.length,
      selectedFaceCount: part.faceParts?.length || 0,
      geometryVertexCountBefore: currentVertexCount,
      triangleCountBefore: Math.floor((target.geometry.index?.count || currentVertexCount) / 3),
      indexedBefore: Boolean(target.geometry.index),
      transformMode: runtime.current?.transform?.getMode?.() || modeRef.current,
      transformAxis: runtime.current?.transform?.axis ?? null,
      axisSpace: spaceRef.current,
      objectPosition: target.position.toArray(),
      objectRotation: [target.rotation.x, target.rotation.y, target.rotation.z],
      objectScale: target.scale.toArray()
    });
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
    const beforeTopology = target.userData.nexusTopology ? JSON.parse(JSON.stringify(target.userData.nexusTopology)) : null;
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
      // Prefer the persistent face-loop model over inferring modeling faces from
      // render-triangle order. Each stored face carries its verified render-corner
      // mapping so UV/material seam copies remain attached to the correct quad.
      const storedTopology = target.userData.nexusTopology;
      const storedFaces = storedTopology?.version === 1 && Array.isArray(storedTopology.faces)
        ? storedTopology.faces : [];
      // Indexed primitive render indices are stored as expanded-stream offsets.
      // Expand before validating those offsets; this preserves the topology map
      // while keeping the original indexed mesh untouched in its history snapshot.
      if (storedFaces.length > 0 && geometry.index) {
        const indexedSource = geometry;
        geometry = indexedSource.toNonIndexed();
        indexedSource.dispose();
      }
      const positionCount = geometry.getAttribute('position')?.count || 0;
      if (storedFaces.length > 0 &&
          storedFaces.every((face: any) => Array.isArray(face.renderIndices) &&
            face.renderIndices.length === 4 &&
            face.renderIndices.every((index: number) => Number.isInteger(index) && index >= 0 && index < positionCount))) {
        sourceQuadCorners = storedFaces.map((face: any) => [...face.renderIndices]);
      }
      if (!sourceQuadCorners && geometry.index && target.userData.kind === 'Cube' && target.userData.nexusQuadGrid !== true) {
        const indexedSource = geometry;
        geometry = indexedSource.toNonIndexed();
        indexedSource.dispose();
        sourceQuadCorners = [];
        for (let base = 0; base < geometry.getAttribute('position').count; base += 6) {
          sourceQuadCorners.push([base, base + 1, base + 4, base + 2]);
        }
      } else if (!sourceQuadCorners) {
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
      } else if (editModeRef.current === 'Face' && faceSelectionToolRef.current === 'Edge' && selectedPoints.length >= 2) {
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
    const committedPosition = target.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    let committedTopology: ReturnType<typeof buildTopologyFromCanonicalQuadGeometry> = null;
    const priorTopology = beforeTopology?.version === 1 ? beforeTopology : null;
    const connectivityChanged = tool === 'Extrude' || tool === 'Subdivide' || tool === 'LoopCut' || tool === 'FacesCut';
    if (committedPosition && priorTopology && !connectivityChanged) {
      // Position-only operations (notably Smooth and face/component transforms)
      // must refresh coordinates on this object's existing face loops. Do not
      // discard topology merely because the legacy quad-grid marker is absent.
      committedTopology = updateTopologyPositionsFromRenderGeometry(
        priorTopology,
        committedPosition.array,
        target.geometry.index?.array || null
      );
    } else if (afterQuadGridState.enabled && committedPosition) {
      // Connectivity-changing operations publish a new verified render layout.
      committedTopology = target.geometry.index
        ? buildTopologyFromIndexedQuadGeometry(committedPosition.array, target.geometry.index.array)
        : buildTopologyFromCanonicalQuadGeometry(committedPosition.array);
    }
    if (committedTopology) target.userData.nexusTopology = committedTopology;
    else delete target.userData.nexusTopology;
    recordInteractionTrace('Persistent topology handoff', {
      operation: tool,
      enabled: Boolean(afterQuadGridState.enabled),
      stored: Boolean(committedTopology),
      faceCount: committedTopology?.faces?.length || 0,
      vertexCount: committedTopology?.vertices?.length || 0,
      layout: afterQuadGridState.layout,
    });
    recordInteractionTrace('Geometry operation committed', {
      operation: tool,
      editMode: editModeRef.current,
      objectName: target.name || null,
      objectId: target.userData.editorId || null,
      vertexCountBefore: before.getAttribute('position')?.count || 0,
      vertexCountAfter: committedPosition?.count || 0,
      triangleCountBefore: Math.floor((before.index?.count || before.getAttribute('position')?.count || 0) / 3),
      triangleCountAfter: Math.floor((target.geometry.index?.count || committedPosition?.count || 0) / 3),
      indexedBefore: Boolean(before.index),
      indexedAfter: Boolean(target.geometry.index),
      materialGroupCount: target.geometry.groups.length,
      quadGridVerified: Boolean(afterQuadGridState.enabled),
      boundsMin: target.geometry.boundingBox?.min.toArray() || null,
      boundsMax: target.geometry.boundingBox?.max.toArray() || null,
      axis: runtime.current?.transform?.axis ?? null,
      transformMode: runtime.current?.transform?.getMode?.() || modeRef.current,
      axisSpace: spaceRef.current
    });
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
          if (beforeTopology) target.userData.nexusTopology = JSON.parse(JSON.stringify(beforeTopology));
          else delete target.userData.nexusTopology;
          runtime.current?.refreshTopologyOverlay?.(target);
        },
        redo: () => {
          target.geometry.dispose(); target.geometry = afterSnapshot.clone();
          target.geometry.computeVertexNormals(); target.geometry.computeBoundingBox();
          target.userData.cutLoops = redoCutLoops.map(loop => loop.map(point => [...point]));
          restoreQuadGridState(afterQuadGridState);
          const redoPosition = target.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
          const redoTopology = redoPosition && priorTopology && !connectivityChanged
            ? updateTopologyPositionsFromRenderGeometry(priorTopology, redoPosition.array, target.geometry.index?.array || null)
            : afterQuadGridState.enabled && redoPosition
              ? target.geometry.index
                ? buildTopologyFromIndexedQuadGeometry(redoPosition.array, target.geometry.index.array)
                : buildTopologyFromCanonicalQuadGeometry(redoPosition.array)
              : null;
          if (redoTopology) target.userData.nexusTopology = redoTopology;
          else delete target.userData.nexusTopology;
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
      const isControlHandle = Boolean(mainSelection?.userData.rigControlMarker);
      r.transform.enabled = Boolean(selectedRef.current) && (editModeRef.current === 'Object' || isControlHandle);
      const helper = r.transform.getHelper?.();
      if (helper) helper.visible = Boolean(selectedRef.current) && r.transform.enabled;
      setRiggingView(false);
      setRigPanelOpen(false);
      setInspectorOpen(false);
      setPanel(true);
      setStatus('Main Viewport restored');
    }
  };

  const getSequenceRange = (stateId: string) => {
    let cursor = workStart;
    for (const state of sequenceStates) {
      const start = cursor; const end = start + Math.max(1, state.width) - 1;
      if (state.id === stateId) return { start, end };
      cursor = end + 1;
    }
    return { start: workStart, end: workEnd };
  };
  const getCustomRulerTicks = (rulerWidth: number) => {
    const toSeconds = (value: number, unit: 's' | 'm') => Math.max(0, Number.isFinite(value) ? value : 0) * (unit === 'm' ? 60 : 1);
    const displayUnit = customRulerStartUnit === customRulerEndUnit ? customRulerStartUnit : 's';
    const unitFactor = displayUnit === 'm' ? 60 : 1;
    const start = toSeconds(customRulerStart, customRulerStartUnit) / unitFactor;
    const end = toSeconds(customRulerEnd, customRulerEndUnit) / unitFactor;
    const span = Math.abs(end - start);
    if (span < 0.000001) {
      return [{ value: start, position: 0, label: String(Number(start.toFixed(2))) + displayUnit }];
    }
    const maxIntervals = Math.max(2, Math.floor(Math.max(96, rulerWidth) / 34));
    const rawStep = span / maxIntervals;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 0.000001))));
    const normalized = rawStep / magnitude;
    const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    const step = span <= 10 ? (span < 1 ? Math.pow(10, Math.floor(Math.log10(span)) - 1) : 1) : niceStep;
    const direction = end >= start ? 1 : -1;
    const values: number[] = [start];
    for (let value = start + step * direction; direction > 0 ? value < end - 0.000001 : value > end + 0.000001; value += step * direction) {
      values.push(Number(value.toFixed(6)));
      if (values.length >= 200) break;
    }
    if (Math.abs(values[values.length - 1] - end) > 0.000001) values.push(end);
    return values.map(value => ({
      value,
      position: Math.max(0, Math.min(100, ((value - start) / (end - start)) * 100)),
      label: String(Number(value.toFixed(2))) + displayUnit
    }));
  };
  const activeSequenceState = sequenceStates.find(state => state.id === selectedSequenceState) || null;
  const activeSequenceRange = activeSequenceState ? getSequenceRange(activeSequenceState.id) : { start: workStart, end: workEnd };
  const selectAlphabetState = (state: typeof sequenceStates[number]) => {
    // Letter tap only selects the Timeline State; it does not move the playhead or expand the ruler.
    setSelectedSequenceState(state.id);
    setPendingStateChoice('');
  };
  const deleteAlphabetState = () => {
    const index = sequenceStates.findIndex(state => state.id === selectedSequenceState);
    if (index < 0) return;
    const state = sequenceStates[index];
    const range = getSequenceRange(state.id);
    const nextKeys: Keyframes = JSON.parse(JSON.stringify(keysRef.current));
    Object.keys(nextKeys).forEach(objectId => {
      Object.keys(nextKeys[objectId]).forEach(value => {
        const at = Number(value);
        if (at >= range.start && at <= range.end) delete nextKeys[objectId][at];
      });
      if (!Object.keys(nextKeys[objectId]).length) delete nextKeys[objectId];
    });
    commitKeys(nextKeys);
    setTimelineMarkers(previous => previous.filter(marker => marker.frame < range.start || marker.frame > range.end));
    runtime.current?.removeAlphabetStateMarker?.(state.id);
    const remaining = sequenceStates.filter(entry => entry.id !== state.id);
    setSequenceStates(remaining);
    setSelectedSequenceState(remaining[Math.max(0, index - 1)]?.id || remaining[0]?.id || '');
    setSelected3DAlphabetMarkerId(current => current === state.id ? '' : current);
    setPendingStateChoice('');
    setSelectedKeyframe(current => current && current.frame >= range.start && current.frame <= range.end ? null : current);
    setStatus('State ' + state.label + ' and its keyframes deleted');
  };
  const addAlphabetState = (mode: 'continue' | 'independent' = 'independent') => {
    const previousEnd = sequenceStates.reduce((sum, state) => sum + Math.max(1, state.width), workStart);
    const index = sequenceStates.length;
    const labelFor = (n: number): string => { let value = n + 1, label = ''; while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); } return label; };
    const nextState = { id: 'state-' + (Date.now().toString(36)) + '-' + index, label: labelFor(index), width: Math.max(30, frameRate * 2), mode, objectId: selectedRef.current };
    setSequenceStates(prev => [...prev, nextState]);
    setSelectedSequenceState('');
    const nextEnd = previousEnd + nextState.width - 1;
    setWorkEnd(nextEnd); setTimelineDuration(nextEnd / Math.max(1, frameRate));
    setCurrentFrame(previousEnd);
    setStatus('State ' + nextState.label + ' created · tap its letter to open the ruler');
    return nextState.id;
  };
  useEffect(() => {
    sequenceStates.forEach((state, index) => {
      const startFrame = sequenceStates.slice(0, index).reduce((sum, entry) => sum + Math.max(1, entry.width), workStart);
      runtime.current?.createAlphabetStateMarker?.(state.label, state.id, state.objectId, startFrame);
    });
    runtime.current?.setSelectedAlphabetStateMarker?.(selected3DAlphabetMarkerId);
  }, [sequenceStates, selected3DAlphabetMarkerId]);

  const setAlphabetStateMode = (stateId: string, mode: 'continue' | 'independent') => {
    const range = getSequenceRange(stateId);
    if (mode === 'continue') {
      const nextKeys: Keyframes = JSON.parse(JSON.stringify(keysRef.current));
      Object.entries(nextKeys).forEach(([objectId, track]) => {
        const priorFrames = Object.keys(track).map(Number).filter(value => value < range.start).sort((a,b) => b-a);
        if (priorFrames.length) nextKeys[objectId] = { ...track, [range.start]: JSON.parse(JSON.stringify(track[priorFrames[0]])) };
      });
      commitKeys(nextKeys);
    }
    setSequenceStates(prev => prev.map(state => state.id === stateId ? { ...state, mode } : state));
    setPendingStateChoice('');
    setStatus('State ' + (sequenceStates.find(state => state.id === stateId)?.label || '') + ' · ' + (mode === 'continue' ? 'continue previous pose' : 'independent pose'));
  };
  const toggleAnimationWorkspace = () => {
    const r = runtime.current;
    if (!r) return;
    if (!animationMode && (r.riggingView || riggingView)) { setStatus('Exit IK Rigging before opening Animation'); return; }
    if (!animationMode && (r.cameraView || cameraView)) { setStatus('Exit CAM view before opening Animation'); return; }
    const opening = !animationMode;
    if (opening) {
      r.animationView = true;
      r.activeCamera.position.copy(r.camBody.position);
      r.activeCamera.quaternion.copy(r.camBody.quaternion);
      r.activeOrbit.target.copy(r.activeCamera.position).add(new THREE.Vector3(0, 0, -3).applyQuaternion(r.activeCamera.quaternion));
      r.transform.camera = r.activeCamera;
      setAnimationMode(true);
      setAnimOpen(false);
      
      setMenuOpen(false); setPanel(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false);
      setStatus('Animation workspace opened · User Camera view');
    } else {
      r.animationView = false;
      r.camBody.position.copy(r.activeCamera.position);
      r.camBody.quaternion.copy(r.activeCamera.quaternion);
      r.transform.camera = r.camera;
      setAnimationMode(false);
      setAnimOpen(false);
      setStatus('Animation workspace closed · playback continues in Main Viewport');
    }
    r.syncViewportControls?.();
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
      const selectedObject = r.selectable.find((object: THREE.Object3D) => String(object.userData.editorId) === selectedRef.current);
      r.transform.enabled = editModeRef.current === 'Object' || Boolean(selectedObject?.userData.rigControlMarker);
      r.transform.camera = next ? r.activeCamera : r.camera;
      r.transform.getHelper().visible = Boolean(selectedRef.current) && r.transform.enabled;
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
    const isNativeApp = Capacitor.isNativePlatform();
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setShowInstall(true);
    };
    if (!isNativeApp) window.addEventListener('beforeinstallprompt', onInstall);
    const alreadyStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const timer = !isNativeApp && !alreadyStandalone && !sessionStorage.getItem('nexus3d-install-dismissed')
      ? window.setTimeout(() => setShowInstall(true), 1800)
      : undefined;
    const fn = () => setFullscreen(Boolean(document.fullscreenElement));
    const orient = () => setPortrait(window.innerHeight > window.innerWidth);

    document.addEventListener('fullscreenchange', fn);
    window.addEventListener('orientationchange', orient);
    orient();
    return () => { if (timer) window.clearTimeout(timer); document.removeEventListener('fullscreenchange', fn); window.removeEventListener('orientationchange', orient); if (!isNativeApp) window.removeEventListener('beforeinstallprompt', onInstall); };
  }, []);

  const applyInterpolatedFrame = (atFrame: number) => {
    const r = runtime.current;
    if (!r) return;
    const selectableById = new Map<string, THREE.Object3D>();
    r.selectable.forEach((object: THREE.Object3D) => {
      const id = String(object.userData.editorId || '');
      if (id) selectableById.set(id, object);
    });
    Object.entries(keysRef.current).forEach(([id, track]) => {
      const obj = selectableById.get(id) || (() => {
        let found: THREE.Object3D | null = null;
        r.scene?.traverse((node: THREE.Object3D) => { if (!found && String(node.userData.editorId || '') === id) found = node; });
        return found;
      })();
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
    // Re-apply animated orange Bone Control Handles as IK targets after their
    // keyframed transforms are restored. TransformControls' objectChange event
    // does not fire during timeline playback, so the usual live-drag IK bridge
    // must be invoked explicitly here.
    r.selectable.filter((candidate: THREE.Object3D) => candidate.userData.rigControlMarker).forEach((marker: THREE.Object3D) => {
      const markerId = String(marker.userData.editorId || '');
      const markerTrack = keysRef.current[markerId];
      if (!markerTrack || !Object.keys(markerTrack).length || marker.userData.controlLocked) return;
      const ownerBoneId = String(marker.userData.controlOwnerBoneId || '');
      const ownerBone = selectableById.get(ownerBoneId);
      if (!(ownerBone instanceof THREE.Bone)) return;
      const ownerId = String(marker.userData.controlOwnerObjectId || ownerBone.userData.rigOwnerId || '');
      const rigBoneCount = r.selectable.filter((candidate: THREE.Object3D) =>
        candidate instanceof THREE.Bone && String(candidate.userData.rigOwnerId || '') === ownerId
      ).length;
      if (rigBoneCount < 2) return;
      r.solveIK?.(Math.max(1, rigBoneCount - 1), marker.getWorldPosition(new THREE.Vector3()), marker);
    });
    r.scene?.updateMatrixWorld(true);
  };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setFrame(current => {
        const nextFrame = current >= workEnd ? (loopPlayback ? workStart : workEnd) : Math.min(workEnd, current + Math.max(1, Math.round(frameRate / 30)));
        frameRef.current = nextFrame;
        applyInterpolatedFrame(nextFrame);
        if (animationMixerRef.current) animationMixerRef.current.mixer.update(1 / Math.max(1, frameRate));
        if (nextFrame === workEnd && !loopPlayback) setPlaying(false);
        return nextFrame;
      });
    }, Math.max(8, Math.round(1000 / frameRate)));
    return () => window.clearInterval(timer);
  }, [playing, frameRate, loopPlayback, interpolation, curveWeight, curveTension, curveTangent, workStart, workEnd]);

  useEffect(() => {
    if (!showGhostPreview || !selected) return;
    const scene = runtime.current?.scene as THREE.Scene | undefined;
    const source = runtime.current?.selectable?.find((o: THREE.Object3D) => o.userData.editorId === selected) as THREE.Object3D | undefined;
    const track = keysRef.current[selected] || {};
    if (!scene || !source) return;
    const frameKeys = Object.keys(track).map(Number).sort((a, b) => a - b);
    const previous = frameKeys.filter(value => value < frameRef.current).pop();
    const next = frameKeys.find(value => value > frameRef.current);
    const ghosts: THREE.Object3D[] = [];
    const createGhost = (at: number, label: string) => {
      const ghost = (source as any).isSkinnedMesh ? cloneSkeletonHierarchy(source) : source.clone(true);
      ghost.name = 'Nexus3D ' + label + ' Ghost';
      ghost.userData = { internalAnimationGhost: true };
      ghost.traverse((node: any) => {
        node.userData = { ...(node.userData || {}), internalAnimationGhost: true };
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          const clones = materials.map((material: THREE.Material) => {
            const copy = material.clone();
            (copy as any).transparent = true;
            (copy as any).opacity = 0.2;
            (copy as any).depthWrite = false;
            (copy as any).wireframe = true;
            return copy;
          });
          node.material = Array.isArray(node.material) ? clones : clones[0];
        }
        node.raycast = () => {};
      });
      applySnapshot(ghost, track[at]);
      const ghostParent = source.parent || scene;
      ghostParent.add(ghost);
      ghosts.push(ghost);
    };
    if (previous !== undefined) createGhost(previous, 'Previous');
    if (next !== undefined) createGhost(next, 'Next');
    return () => {
      ghosts.forEach(ghost => {
        (ghost.parent || scene).remove(ghost);
        ghost.traverse((node: any) => {
          const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
          materials.forEach((material: THREE.Material) => material.dispose());
        });
      });
    };
  }, [showGhostPreview, selected, keyframes, selectedKeyframe]);

  const setCurrentFrame = (nextFrame: number) => {
    const rawFrame = Math.max(workStart, Math.min(workEnd, Math.round(nextFrame)));
    const clamped = snapOn ? Math.round(rawFrame / 5) * 5 : rawFrame;
    frameRef.current = clamped;
    setFrame(clamped);
    applyInterpolatedFrame(clamped);
    if (animationMixerRef.current) {
      const action = animationMixerRef.current.action;
      const wasPaused = action.paused;
      action.paused = false;
      animationMixerRef.current.mixer.setTime(Math.max(0, clamped - workStart) / Math.max(1, frameRate));
      action.paused = wasPaused || !playing;
    }
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
  const moveSelectedKeyframe = (delta: number) => {
    if (!selectedKeyframe) { setStatus('Select a keyframe first'); return; }
    const { id, frame: sourceFrame } = selectedKeyframe;
    const destination = Math.max(workStart, Math.min(workEnd, sourceFrame + delta));
    if (destination === sourceFrame || keysRef.current[id]?.[destination]) { setStatus('Cannot move keyframe to an occupied frame'); return; }
    const next: Keyframes = JSON.parse(JSON.stringify(keysRef.current));
    const value = next[id]?.[sourceFrame];
    if (!value) return;
    delete next[id][sourceFrame];
    next[id][destination] = value;
    commitKeys(next);
    setSelectedKeyframe({ id, frame: destination });
    setCurrentFrame(destination);
    setStatus('Keyframe moved to F: ' + destination);
  };
  const updateSelectedKeyframeChannel = (value: number) => {
    if (!selectedKeyframe || !Number.isFinite(value)) { setStatus('Select a keyframe to edit its value'); return; }
    const { id, frame: at } = selectedKeyframe;
    const next: Keyframes = JSON.parse(JSON.stringify(keysRef.current));
    const data = next[id]?.[at];
    if (!data) return;
    const [group, axis] = selectedGraphChannel.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    data[group][index] = group === 'rotation' ? THREE.MathUtils.degToRad(value) : value;
    commitKeys(next);
    const obj = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === id);
    if (obj && at === frameRef.current) applySnapshot(obj, data);
    setStatus('Graph value updated · ' + selectedGraphChannel.toUpperCase());
  };
  const graphChannelParts = selectedGraphChannel.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
  const graphAxisIndex = graphChannelParts[1] === 'x' ? 0 : graphChannelParts[1] === 'y' ? 1 : 2;
  const graphEntries = Object.entries(keyframes[selected] || {}).map(([at, data]) => ({ frame: Number(at), value: graphChannelParts[0] === 'rotation' ? THREE.MathUtils.radToDeg(data.rotation[graphAxisIndex]) : data[graphChannelParts[0]][graphAxisIndex] })).sort((a,b) => a.frame - b.frame);
  const graphMin = graphEntries.length ? Math.min(...graphEntries.map(entry => entry.value)) : -1;
  const graphMax = graphEntries.length ? Math.max(...graphEntries.map(entry => entry.value)) : 1;
  const graphSpan = Math.max(0.001, graphMax - graphMin);
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
      let lightCount = 0, shadowCasterCount = 0, visibleMeshCount = 0, invisibleMeshCount = 0;
      if (scene) scene.traverse(object => {
        objects.push(object);
        const candidate = object as THREE.Light;
        if (candidate.isLight) {
          lightCount += 1;
          if (candidate.castShadow) shadowCasterCount += 1;
        }
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.visible) visibleMeshCount += 1;
          else invisibleMeshCount += 1;
        }
      });
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
      const frameDiagnostics = typeof rt?.getRenderDiagnostics === 'function' ? rt.getRenderDiagnostics() : null;
      add('Render Frame Timing', frameDiagnostics?.frameSamples ? 'PASS' : 'WARN', frameDiagnostics ? `Average frame interval: ${frameDiagnostics.frameAverageMs} ms; maximum observed interval: ${frameDiagnostics.frameMaxMs} ms; samples: ${frameDiagnostics.frameSamples}. This measures frame-loop intervals, not GPU-only render time.` : 'Frame timing sampler unavailable.');
      add('Light / Shadow Inventory', 'PASS', `${lightCount} light(s) in scene; ${shadowCasterCount} request shadow maps; visible meshes: ${visibleMeshCount}; invisible meshes: ${invisibleMeshCount}. Counts include all scene lights, including non-editor lights.`);
      add('Memory Leak Trend', 'WARN', rdsResourceBaselineRef.current && info ? (() => {
        const previous = rdsResourceBaselineRef.current!;
        const geometryDelta = (info.memory.geometries || 0) - previous.geometries;
        const textureDelta = (info.memory.textures || 0) - previous.textures;
        return `Since previous scan: geometries ${geometryDelta >= 0 ? '+' : ''}${geometryDelta}, textures ${textureDelta >= 0 ? '+' : ''}${textureDelta}. Growth alone is not proof of a leak.`;
      })() : 'Baseline recorded. Run another scan after repeated create/delete operations to compare resource counts.');
      if (info) rdsResourceBaselineRef.current = { geometries: info.memory.geometries || 0, textures: info.memory.textures || 0, time: Date.now() };
      add('Project / Asset Integrity', 'WARN', 'Live scene references were inspected. Saved .nexus archives and external asset contents are not opened or modified by this runtime scan.');
      add('Offline / Storage', navigator.onLine ? 'PASS' : 'PASS', `Network status: ${navigator.onLine ? 'online' : 'offline'}; localStorage: ${(() => { try { const k='__nexus_rds_probe__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return 'available'; } catch { return 'unavailable'; } })()}. Offline status does not imply a broken app.`);
      const gl = renderer?.getContext();
      const glVersion = gl?.getParameter(gl.VERSION) || 'unavailable';
      const maxTexture = gl?.getParameter(gl.MAX_TEXTURE_SIZE) || 'unavailable';
      const directionalShadowLights = objects.filter((object: any) => object.isDirectionalLight && object.castShadow);
      const directionalShadowSizes = directionalShadowLights.map((light: any) => `${light.name || 'DirectionalLight'}:${light.shadow?.mapSize?.width ?? 'unknown'}x${light.shadow?.mapSize?.height ?? 'unknown'}`);
      const glLimits = gl ? {
        fragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        vertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        textureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        vertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        combinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
        varyingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS)
      } : null;
      add('Directional Shadow Capacity', glLimits ? 'PASS' : 'WARN', `${directionalShadowLights.length} Directional Light(s) request independent shadow maps; map sizes: ${directionalShadowSizes.join(', ') || 'none'}; fragment texture units: ${glLimits?.textureImageUnits ?? 'unavailable'}; combined texture units: ${glLimits?.combinedTextureImageUnits ?? 'unavailable'}. These counts indicate potential sampler pressure, not an exact shader sampler total; material and environment textures also consume units.`);
      const contextLost = gl ? gl.isContextLost() : null;
      add('Device / WebGL Capability', gl ? (contextLost ? 'ERROR' : 'PASS') : 'WARN', `WebGL: ${glVersion}; context lost: ${contextLost ?? 'unavailable'}; max texture size: ${maxTexture}; fragment uniform vectors: ${glLimits?.fragmentUniformVectors ?? 'unavailable'}; vertex uniform vectors: ${glLimits?.vertexUniformVectors ?? 'unavailable'}; texture units: ${glLimits?.textureImageUnits ?? 'unavailable'}; vertex texture units: ${glLimits?.vertexTextureImageUnits ?? 'unavailable'}; combined texture units: ${glLimits?.combinedTextureImageUnits ?? 'unavailable'}; varying vectors: ${glLimits?.varyingVectors ?? 'unavailable'}; DPR: ${window.devicePixelRatio || 1}; heap: ${usedMB === null ? 'not exposed' : usedMB + ' MB'}.`);
      add('Module API Contract', ['addObject','syncItems','syncViewportControls','setPerformanceMode','createManualRig','solveIK'].every(key => typeof rt?.[key] === 'function') ? 'PASS' : 'WARN', 'Checks registered runtime entry points; this does not statically inspect every source-code call site.');
      add('Regression Safety', 'PASS', 'Read-only checks only. No transforms, hierarchy, bones, materials, animation, renderer settings or project files were changed.');
      const noticeSection = buildRdsNoticeSection(checks);
      const errors = checks.filter(item => item.status === 'ERROR').length;
      const warnings = checks.filter(item => item.status === 'WARN').length;
      const passed = checks.filter(item => item.status === 'PASS').length;
      const report = [
        'NEXUS3D RDS · FULL CORE DIAGNOSTIC REPORT',
        `Scan time: ${new Date().toLocaleString()}`,
        `Result: ${errors} error(s) · ${warnings} warning(s) · ${passed} passed`,
        `Scene objects: ${objects.length} · Lights: ${lightCount} · Shadow casters: ${shadowCasterCount} · JS heap: ${usedMB === null ? 'not exposed' : usedMB + ' MB'}`,
        '',
        ...checks.map(item => `[${item.status}] ${item.name}\n  ${item.detail}`),
        '',
        noticeSection,
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
  const runGeometryRitScan = () => {
    if (geometryRitBusy) return;
    setGeometryRitBusy(true);
    try {
      const scene = runtime.current?.scene as THREE.Scene | undefined;
      if (!scene) {
        const report = [
          'NEXUS3D GEOMETRY RIT · INDEPENDENT DIAGNOSTIC REPORT',
          'Diagnostic ID: GEOM-RIT-001',
          'RESULT: INSUFFICIENT EVIDENCE',
          'Reason: The live 3D scene is not available. No scan was performed.',
          'No scene or geometry data was changed.'
        ].join('\n');
        setGeometryRitReport(report);
        setGeometryRitSummary({ status: 'INSUFFICIENT EVIDENCE', meshes: 0, vertices: 0, triangles: 0, errors: 0, warnings: 0 });
        setStatus('Geometry RIT · scene unavailable; no scan performed');
        return;
      }
      const result = scanGeometryRit(scene);
      const report = formatGeometryRitReport(result);
      setGeometryRitReport(report);
      setGeometryRitSummary({ status: result.status, meshes: result.meshes, vertices: result.vertices, triangles: result.triangles, errors: result.errors, warnings: result.warnings });
      diagnosticSinkRef.current(result.status === 'FAIL' ? 'ERROR' : result.status === 'REVIEW' ? 'WARN' : 'INFO',
        'Geometry RIT', 'Independent geometry scan completed · ' + result.status, report);
      setStatus('Geometry RIT complete · ' + result.status + ' · read-only scan');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const report = 'NEXUS3D GEOMETRY RIT · SCAN FAILED\n' + message + '\nNo automatic repair or geometry mutation was attempted.';
      setGeometryRitReport(report);
      setGeometryRitSummary({ status: 'INSUFFICIENT EVIDENCE', meshes: 0, vertices: 0, triangles: 0, errors: 0, warnings: 0 });
      diagnosticSinkRef.current('ERROR', 'Geometry RIT', 'Independent geometry scan failed', message);
      setStatus('Geometry RIT failed · diagnostic captured');
    } finally {
      setGeometryRitBusy(false);
    }
  };
  const copyGeometryRitReport = () => {
    if (geometryRitSummary.status === 'NOT SCANNED') return;
    void copyDiagnosticText([{
      id: 'geometry-rit-001', time: new Date().toLocaleTimeString(),
      level: geometryRitSummary.status === 'FAIL' ? 'ERROR' : geometryRitSummary.status === 'REVIEW' ? 'WARN' : 'INFO',
      source: 'Geometry RIT', message: 'Independent Geometry RIT report · ' + geometryRitSummary.status,
      details: geometryRitReport
    }]);
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
  const runDfiToolScan = (tool: string) => {
    if (dfiToolBusy) return;
    setDfiToolBusy(tool);
    try {
      const rt = runtime.current;
      const scene = rt?.scene as THREE.Scene | undefined;
      const logs = [...diagnosticLogs, ...diagnosticQueueRef.current].slice(-400);
      const allText = (entry: DiagnosticEntry) => [entry.source, entry.message, entry.details || ''].join(' ').toLowerCase();
      const patterns: Record<string, RegExp> = {
        'Gizmo Control': /transform|gizmo|axis|dragging|objectchange/,
        'Face Tools': /face|extrude|face pull|faces cut/,
        'Edge Tools': /edge|loop cut|bevel/,
        'Vertex Tools': /vertex|vertices|merge|split/,
        'Extrude & Scale': /extrude|scale|face pull/,
        'Subdivide + Rotate': /subdivide|rotate|rotation/,
        'Post-Smooth': /smooth/,
        'Overlap Scan': /duplicate|overlap|intersect|coplanar|surface/
      };
      const matching = patterns[tool] ? logs.filter(entry => patterns[tool].test(allText(entry))) : [];
      const meshSummary = scene && ['Shape Core', 'Face Tools', 'Edge Tools', 'Vertex Tools', 'Extrude & Scale', 'Subdivide + Rotate', 'Post-Smooth', 'Overlap Scan'].includes(tool)
        ? scanMeshCore(scene) : null;
      const sections = [
        'NEXUS3D ADVANCED DFI · ' + tool.toUpperCase(),
        'Scan time: ' + new Date().toLocaleString(),
        'Status: ' + (tool === 'Gizmo Control' || patterns[tool] ? (matching.length ? 'RECORDED EVIDENCE AVAILABLE' : 'NOT RECORDED — perform the corresponding operation, then scan again') : 'SCANNED'),
        '',
        meshSummary ? formatMeshForensicReport(meshSummary) : 'Mesh topology scan not applicable to this tool.',
        '',
        'OPERATION / EVENT TRACE',
        ...(matching.length ? matching.slice(-120).map(entry => '[' + entry.time + '] [' + entry.level + '] [' + entry.source + '] ' + entry.message + (entry.details ? '\n' + entry.details : '')) : ['No matching operation event is currently captured. This is not evidence that the operation is defect-free.']),
        '',
        'SCOPE NOTE',
        'This button scans current read-only scene geometry and correlates captured runtime events. Historical before/after geometry snapshots are only available for operations explicitly instrumented in the current session.'
      ];
      const report = sections.join('\n');
      setDfiToolReports(previous => ({ ...previous, [tool]: report }));
      const level: DiagnosticEntry['level'] = meshSummary?.issues.some(issue => issue.severity === 'ERROR') ? 'ERROR' : meshSummary?.issues.some(issue => issue.severity === 'WARN') ? 'WARN' : 'INFO';
      diagnosticSinkRef.current(level, 'Advanced DFI · ' + tool, 'Tool scan completed', report);
      setStatus(tool + ' scan complete · ' + (matching.length ? matching.length + ' trace event(s)' : 'no operation trace captured'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const report = 'SCAN ERROR\n' + message + '\nNo geometry repair or mutation was attempted.';
      setDfiToolReports(previous => ({ ...previous, [tool]: report }));
      diagnosticSinkRef.current('ERROR', 'Advanced DFI · ' + tool, 'Tool scan failed safely', message);
      setStatus(tool + ' scan failed · diagnostic captured');
    } finally {
      setDfiToolBusy('');
    }
  };
  const dfiToolSections = [
    { id: '010', name: 'Shape Core' },
    { id: '020', name: 'Gizmo Control' },
    { id: '030', name: 'Face Tools' },
    { id: '040', name: 'Edge Tools' },
    { id: '050', name: 'Vertex Tools' },
    { id: '060', name: 'Extrude & Scale' },
    { id: '070', name: 'Subdivide + Rotate' },
    { id: '080', name: 'Post-Smooth' },
    { id: '090', name: 'Overlap Scan' }
  ];
  const buildDfiToolSummary = (name: string, report?: string) => {
    if (!report) return ['Status: NOT SCANNED', 'No category report has been generated yet. Run this tool to collect evidence.'];
    const lines = report.split('\\n').map(line => line.trim()).filter(Boolean);
    const selected = lines.filter(line =>
      /^(Status:|Scan time:|Mesh Core|Meshes:|Vertices:|Triangles:|Issues:|ERROR|WARN|INFO|Finding|Duplicate|Invalid|Degenerate|Non-manifold|Boundary|Coincident|Operation|No matching|No deterministic|SCOPE NOTE)/i.test(line) ||
      /\\b(CRASH|FATAL|CONFLICT|ERROR|BUG|DUPLICATE|NON_MANIFOLD|WARNING|SUSPECTED)\\b/i.test(line)
    );
    return [
      'Category: ' + name,
      'Summary generated: ' + new Date().toLocaleString(),
      ...selected.slice(0, 24),
      selected.length > 24 ? 'Additional matching evidence omitted from this summary; use COPY ALL REPORT for the complete record.' : '',
      'Note: Summary only. Original detailed evidence remains available in COPY ALL REPORT.'
    ].filter(Boolean);
  };
  const copyDfiText = async (value: string, successMessage: string, failureMessage: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement('textarea');
        field.value = value; field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select();
        const copied = document.execCommand('copy'); field.remove();
        if (!copied) throw new Error('Clipboard permission unavailable');
      }
      setStatus(successMessage);
    } catch {
      setStatus(failureMessage);
    }
  };
  const copyDfiToolSummary = (id: string, name: string) => {
    const summary = buildDfiToolSummary(name, dfiToolReports[name]).join('\\n');
    void copyDfiText(summary, 'Copied ID No.' + id + ' · ' + name + ' summary', 'COPY SUMMARY failed · allow clipboard permission and try again');
  };
  const buildSceneWorkflowSummary = () => {
    const queued = diagnosticQueueRef.current.slice();
    const logs = [...diagnosticLogs, ...queued].slice(-400);
    const traceLogs = logs.filter(entry => entry.source === 'Interaction Trace');
    const parsedTrace = traceLogs.map(entry => {
      let data: Record<string, any> = {};
      try { data = entry.details ? JSON.parse(entry.details) : {}; } catch { /* retain raw trace text below */ }
      return { entry, data };
    });
    const operationEvents = parsedTrace.filter(({ entry }) =>
      /Geometry operation requested|Geometry operation committed|Geometry tool requested|Face Pull|Subdivide|Faces Cut|Extrude|Gizmo transform sample|Transform gizmo drag (started|ended)|Scene Tree selection|Face tap accepted|Face locked/i.test(entry.message)
    );
    const objectNames = new Map<string, { count: number; events: string[] }>();
    for (const { entry, data } of parsedTrace) {
      const objectName = String(data.objectName || data.object || data.name || data.selectedObject || '');
      const objectId = String(data.objectId || data.selectedId || data.editorId || '');
      const label = objectName ? objectName + (objectId ? ' [' + objectId + ']' : '') : objectId ? 'Object [' + objectId + ']' : '';
      if (!label) continue;
      const current = objectNames.get(label) || { count: 0, events: [] };
      current.count += 1;
      if (current.events.length < 12 && !current.events.includes(entry.message)) current.events.push(entry.message);
      objectNames.set(label, current);
    }
    const eventCounts = new Map<string, number>();
    for (const { entry } of parsedTrace) eventCounts.set(entry.message, (eventCounts.get(entry.message) || 0) + 1);
    const runtimeScene = runtime.current?.scene as THREE.Scene | undefined;
    const meshScan = runtimeScene ? scanMeshCore(runtimeScene) : null;
    const currentObjects = (runtime.current?.selectable || []).map((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      const geometry = mesh.geometry instanceof THREE.BufferGeometry ? mesh.geometry : null;
      const position = geometry?.getAttribute('position');
      const triangleCount = geometry ? Math.floor((geometry.index?.count || position?.count || 0) / 3) : 0;
      return {
        name: object.name || object.type,
        id: object.userData.editorId || 'no-editor-id',
        kind: object.userData.kind || object.type,
        vertices: position?.count ?? null,
        triangles: geometry ? triangleCount : null,
        indexed: geometry ? Boolean(geometry.index) : null,
        position: object.position.toArray().map(value => Number(value.toFixed(4))),
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(value => Number(value.toFixed(4))),
        scale: object.scale.toArray().map(value => Number(value.toFixed(4)))
      };
    });
    const workflowLines = operationEvents.slice(-60).map(({ entry, data }) => {
      const detailKeys = [
        'operation','editMode','objectName','objectId','selectedId','axis','transformAxis','mode','transformMode','space','axisSpace',
        'selectionVertexCount','selectedFaceCount','geometryVertexCountBefore','vertexCountBefore','vertexCountAfter',
        'triangleCountBefore','triangleCountAfter','indexedBefore','indexedAfter','quadGridVerified','position','rotation','scale',
        'objectPosition','objectRotation','objectScale','pointerType','gesture','heldForMs'
      ];
      const evidence = detailKeys.filter(key => data[key] !== undefined && data[key] !== null)
        .map(key => key + '=' + (typeof data[key] === 'object' ? JSON.stringify(data[key]) : String(data[key])));
      return '[' + entry.time + '] ' + entry.message + (evidence.length ? ' · ' + evidence.join(' | ') : entry.details ? ' · ' + entry.details : '');
    });
    const severity = logs.filter(entry => entry.level !== 'INFO');
    const summary = [
      'NEXUS3D · 3D SCENE + SHAPE WORKFLOW SUMMARY',
      'Generated: ' + new Date().toLocaleString(),
      'Capture window: latest ' + logs.length + ' retained diagnostic event(s); ' + traceLogs.length + ' Interaction Trace event(s).',
      'Current scene objects: ' + currentObjects.length + ' · recorded workflow events: ' + operationEvents.length + ' · ERROR/WARN entries: ' + severity.length,
      '',
      '1. CURRENT 3D SCENE / SHAPE STATE',
      'Edit mode: ' + editModeRef.current + ' · Active tool: ' + (activeEditToolRef.current || 'none') + ' · Transform mode: ' + (runtime.current?.transform?.getMode?.() || modeRef.current) + ' · Axis space: ' + spaceRef.current,
      'Selected editor ID: ' + (selectedRef.current || 'none'),
      ...(currentObjects.length ? currentObjects.map(object => '- ' + object.name + ' [' + object.id + '] · ' + object.kind +
        (object.vertices !== null ? ' · vertices=' + object.vertices + ' · triangles=' + object.triangles + ' · indexed=' + object.indexed : '') +
        ' · position=' + JSON.stringify(object.position) + ' · rotation=' + JSON.stringify(object.rotation) + ' · scale=' + JSON.stringify(object.scale))
        : ['No selectable scene objects are currently available.']),
      '',
      '2. WORKFLOW COUNTS BY CAPTURED EVENT',
      ...(eventCounts.size ? Array.from(eventCounts.entries()).sort((a,b) => b[1]-a[1]).map(([name,count]) => '- ' + name + ': ' + count) : ['No Interaction Trace events captured in the retained window.']),
      '',
      '3. OBJECT / SHAPE ACTIVITY',
      ...(objectNames.size ? Array.from(objectNames.entries()).map(([name,value]) => '- ' + name + ' · ' + value.count + ' event(s) · ' + value.events.join(' → ')) : ['No object-specific names or IDs were present in captured trace data.']),
      '',
      '4. OPERATION WORKFLOW TIMELINE (latest 60 meaningful events)',
      ...(workflowLines.length ? workflowLines : ['No matching modeling, selection or gizmo workflow events were captured.']),
      '',
      '5. CURRENT MESH TOPOLOGY / INTEGRITY SCAN',
      ...(meshScan ? [formatMeshForensicReport(meshScan)] : ['Scene mesh scanner unavailable because the runtime scene is not ready.']),
      '',
      '6. ERROR / WARNING EVIDENCE',
      ...(severity.length ? severity.slice(-30).map(entry => '[' + entry.time + '] [' + entry.level + '] [' + entry.source + '] ' + entry.message + (entry.details ? ' · ' + entry.details : '')) : ['No ERROR or WARN entries in the retained diagnostic window.']),
      '',
      '7. CAPTURE LIMITATIONS',
      'This is a consolidated summary of events actually captured by Nexus3D. It includes the current scene snapshot and current mesh scan, but it cannot recreate geometry states from before an operation unless that operation recorded a before/after snapshot. Events outside the retained diagnostic window, cleared logs, uninstrumented gestures, and native Android crashes not surfaced to JavaScript may be absent.',
      'Use COPY ALL REPORT for every retained raw log, full stack/details, all individual tool reports, RDS reports and source-audit evidence.'
    ];
    return summary.join('\\n');
  };
  const copyAllDfiSummary = () => {
    const report = buildSceneWorkflowSummary();
    void copyDfiText(report, 'Copied complete 3D Scene + Shape workflow summary · one paste-ready report', 'COPY SUMMARY REPORT failed · allow clipboard permission and try again');
  };

  const copyAllDfiReport = async () => {
    const queued = diagnosticQueueRef.current.slice();
    const logs = [...diagnosticLogs, ...queued].slice(-400);
    const sections = [
      'NEXUS3D ADVANCED DFI · COPY ALL REPORT',
      'Generated: ' + new Date().toLocaleString(),
      '',
      'UNIFIED DEEP FORENSIC REPORT',
      dfiReport,
      '',
      'INDIVIDUAL TOOL REPORTS',
      ...['Shape Core','Gizmo Control','Face Tools','Edge Tools','Vertex Tools','Extrude & Scale','Subdivide + Rotate','Post-Smooth','Overlap Scan'].flatMap(name => ['', '===== ' + name.toUpperCase() + ' =====', dfiToolReports[name] || 'NOT SCANNED — no report exists yet; run this tool to collect evidence.']),
      '',
      'RDS FULL CORE REPORT',
      rdsScanReport,
      '',
      'RDS BUILD-TIME SOURCE AUDIT',
      rdsSourceAuditReport,
      '',
      'ALL CAPTURED RUNTIME DIAGNOSTICS',
      ...logs.map(entry => '[' + entry.time + '] [' + entry.level + '] [' + entry.source + '] ' + entry.message + (entry.details ? '\n' + entry.details : '')),
      '',
      'CLASSIFICATION RULE: ERROR/CONFLICT/BUG/CRASH labels are based on recorded evidence and source text; warnings and suspected causes are not automatically confirmed root causes.'
    ];
    const report = sections.join('\n');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(report);
      else {
        const field = document.createElement('textarea');
        field.value = report; field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select();
        const copied = document.execCommand('copy'); field.remove();
        if (!copied) throw new Error('Clipboard permission unavailable');
      }
      setStatus('Copied complete Advanced DFI report · ' + logs.length + ' runtime log(s)');
    } catch {
      setStatus('COPY ALL REPORT failed · allow clipboard permission and try again');
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
    const projectNodes = collectObjectOnlyProjectNodes(r?.selectable || []);
    projectNodes.filter((obj: THREE.Object3D) => obj.userData.rigControlMarker || ['Bone', 'Rig', 'IK Target', 'IK Pole'].includes(String(obj.userData.kind))).forEach((obj: THREE.Object3D) => { delete obj.userData.shapeId; delete obj.userData.shapeIdentityLabel; });
    projectNodes.filter((obj: THREE.Object3D) => isShapeProjectMesh(obj)).forEach((obj: THREE.Object3D) => {
      const identity = ensureShapeIdentity(obj, projectNodes, Number(r?.scene?.userData?.nexusNextShapeId) || 1);
      if (r?.scene) r.scene.userData.nexusNextShapeId = identity.nextId;
      obj.userData.shapeIdentityLabel = formatShapeIdentity(obj.name, identity.shapeId);
    });
    assignShapeOwnership(projectNodes);
    return {
      app: 'Nexus3D',
      version: 4,
      savedAt: new Date().toISOString(),
      nextShapeId: Number(r?.scene?.userData?.nexusNextShapeId) || 1,
      // Project payload keeps editable Shapes, rig data and scene lights; viewport cameras and transient UI state are excluded.
      keyframes: keysRef.current,
      objects: projectNodes.map((obj: THREE.Object3D) => ({
        editorId: obj.userData.editorId || null,
        shapeId: obj.userData.shapeId || null,
        ownerShapeId: obj.userData.ownerShapeId || obj.userData.shapeId || null,
        shapeIdentityLabel: obj.userData.shapeId ? formatShapeIdentity(obj.name, obj.userData.shapeId) : null,
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
          shadowRadius: (obj as any).shadow?.radius,
          targetPosition: obj instanceof THREE.SpotLight ? obj.target.position.toArray() : undefined
        } : undefined,
        geometry: obj instanceof THREE.Mesh ? {
          attributes: Object.fromEntries(Object.entries(obj.geometry.attributes).map(([key, attribute]: [string, any]) => [key, { itemSize: attribute.itemSize, normalized: attribute.normalized, array: Array.from(attribute.array as ArrayLike<number>) }])),
          index: obj.geometry.index ? Array.from(obj.geometry.index.array as ArrayLike<number>) : null,
          groups: obj.geometry.groups.map(group => ({ ...group }))
        } : undefined,
        material: obj instanceof THREE.Mesh ? (Array.isArray(obj.material) ? obj.material : [obj.material]).map((mat: any) => ({
          type: mat.type,
          name: mat.name || '',
          userData: (() => { try { return JSON.parse(JSON.stringify(mat.userData || {})); } catch { return {}; } })(),
          color: mat.color?.getHexString?.() || null,
          roughness: Number.isFinite(mat.roughness) ? mat.roughness : null,
          metalness: Number.isFinite(mat.metalness) ? mat.metalness : null,
          opacity: Number.isFinite(mat.opacity) ? mat.opacity : 1,
          transparent: Boolean(mat.transparent),
          emissive: mat.emissive?.getHexString?.() || null,
          emissiveIntensity: Number.isFinite(mat.emissiveIntensity) ? mat.emissiveIntensity : 0,
          clearcoat: Number.isFinite(mat.clearcoat) ? mat.clearcoat : 0,
          clearcoatRoughness: Number.isFinite(mat.clearcoatRoughness) ? mat.clearcoatRoughness : 0,
          transmission: Number.isFinite(mat.transmission) ? mat.transmission : 0,
          ior: Number.isFinite(mat.ior) ? mat.ior : 1.5,
          sheen: Number.isFinite(mat.sheen) ? mat.sheen : 0,
          sheenRoughness: Number.isFinite(mat.sheenRoughness) ? mat.sheenRoughness : 1,
          side: mat.side,
          wireframe: Boolean(mat.wireframe),
          vertexColors: Boolean(mat.vertexColors),
          flatShading: Boolean(mat.flatShading),
          shininess: Number.isFinite(mat.shininess) ? mat.shininess : null,
          specular: mat.specular?.getHexString?.() || null,
          reflectivity: Number.isFinite(mat.reflectivity) ? mat.reflectivity : null,
          refractionRatio: Number.isFinite(mat.refractionRatio) ? mat.refractionRatio : null,
          alphaTest: Number.isFinite(mat.alphaTest) ? mat.alphaTest : 0,
          depthWrite: mat.depthWrite !== false,
          depthTest: mat.depthTest !== false,
          textures: Object.fromEntries(['map','emissiveMap','normalMap','roughnessMap','metalnessMap','aoMap','alphaMap','bumpMap','displacementMap','lightMap','specularMap','clearcoatMap','clearcoatRoughnessMap','clearcoatNormalMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap','sheenRoughnessMap','transmissionMap','thicknessMap','specularIntensityMap','specularColorMap','gradientMap'].flatMap((slot: string) => {
            const texture = mat[slot];
            if (!texture?.image) return [];
            const image: any = texture.image;
            let dataUrl = typeof image.src === 'string' && image.src.startsWith('data:') ? image.src : null;
            if (!dataUrl) {
              const width = Number(image.width || image.videoWidth || image.naturalWidth || 0);
              const height = Number(image.height || image.videoHeight || image.naturalHeight || 0);
              if (!width || !height) throw new Error('Texture image is not ready for offline save: ' + slot);
              const canvas = document.createElement('canvas');
              canvas.width = width; canvas.height = height;
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Could not prepare texture image for offline save: ' + slot);
              context.drawImage(image, 0, 0, width, height);
              dataUrl = canvas.toDataURL('image/png');
            }
            return [[slot, { dataUrl, colorSpace: texture.colorSpace || '', mapping: texture.mapping, wrapS: texture.wrapS, wrapT: texture.wrapT, flipY: texture.flipY, repeat: texture.repeat?.toArray?.() || [1,1], offset: texture.offset?.toArray?.() || [0,0], center: texture.center?.toArray?.() || [0,0], rotation: texture.rotation || 0, magFilter: texture.magFilter, minFilter: texture.minFilter, anisotropy: texture.anisotropy, channel: texture.channel }]];
          }))
        })) : undefined,
        faceSelection: (() => {
          const active = r?.getActiveSubSelection?.();
          return active?.mesh === obj ? { indices: [...(active.indices || [])], faceParts: active.faceParts?.map((part: number[]) => [...part]) || [], linkedIndices: active.linkedIndices ? [...active.linkedIndices] : [] } : null;
        })(),
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
      })),
      animationSettings: { frameRate, timelineDuration, workStart, workEnd, loopPlayback, interpolation, customRulerStart, customRulerStartUnit, customRulerEnd, customRulerEndUnit },
      animationSequence: { states: sequenceStates, selectedState: selectedSequenceState, markers: timelineMarkers },
      animationClips: importedAnimationClips.map(entry => ({ objectEditorId: String(entry.object.userData.editorId || ''), clip: THREE.AnimationClip.toJSON(entry.clip) })),
      subObjectLocks: (r?.getSubObjectLockSnapshot?.() || []).flatMap((entry: any) => {
        const owner = projectNodes.find((obj: THREE.Object3D) => String(obj.userData.editorId) === String(entry.objectId));
        return owner?.userData?.shapeId ? [{ shapeId: owner.userData.shapeId, Vertex: [...(entry.Vertex || [])], Edge: [...(entry.Edge || [])] }] : [];
      })
    };
  };
  const saveProject = async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSavingProject(true);
    try {
      const data = getProjectData();
      const sceneObjects = Array.isArray(data.objects) ? data.objects : [];
      const meshCount = sceneObjects.filter((obj: any) => obj?.shapeId && obj.geometry?.attributes?.position?.array?.length).length;
      if (meshCount === 0) {
        setStatus('SAVE CANCELLED: walang 3D shape/mesh na nakuha sa current scene. Hindi gumawa ng empty project file.');
        return;
      }
      // Validate the exact payload before writing to disk so malformed geometry,
      // duplicate identities, or broken rig/hierarchy references cannot replace
      // a previously valid offline project.
      validateProjectIdentityData(sceneObjects, Number(data.version) || 0);
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
        // Stage the full JSON privately first. The Android picker request carries only
        // a small stagedId, avoiding large ActivityResult/Bundle payloads.
        const staged = await NexusProjectFiles.stageProject({ content: serialized });
        if (!staged?.stagedId || !Number.isFinite(staged.stagedBytes) || staged.stagedBytes <= 0) {
          throw new Error('SAVE FAILED: temporary project staging could not be verified');
        }
        const saved = await NexusProjectFiles.saveProject({ fileName, stagedId: staged.stagedId });
        try { localStorage.setItem('nexus3d-project-v1', serialized); } catch (storageError) {
          console.warn('Nexus3D local backup unavailable:', storageError);
        }
        const verifiedBytes = Number(saved.writtenBytes) || 0;
        const sizeLabel = verifiedBytes > 0 ? verifiedBytes.toLocaleString() + ' bytes' : 'size not reported';
        setStatus('PROJECT SAVED SUCCESSFULLY — ' + (saved.name || fileName) + ' · ' + meshCount + ' shape(s) · ' + sizeLabel);
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
    } finally {
      saveInFlightRef.current = false;
      setIsSavingProject(false);
    }
  };
  const loadProject = async () => {
    setStatus('Choose a .nexus project from Internal Storage');
    if (Capacitor.isNativePlatform()) {
      try {
        const selectedFile = await NexusProjectFiles.loadProject();
        if (typeof selectedFile.content !== 'string' || selectedFile.content.trim().length === 0) {
          throw new Error('Napiling project file ay walang laman (0 bytes). Walang binago sa current scene.');
        }
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
    reader.onload = async () => {
      try {
        const raw = String(reader.result || '');
        const data = JSON.parse(raw);
        const r = runtime.current;
        if (!r || !Array.isArray(data.objects)) {
          setStatus('Project file is invalid or contains no scene objects');
          return;
        }
        const savedMeshCount = data.objects.filter((saved: any) =>
          saved && !['Bone', 'Rig', 'IK Target', 'IK Pole'].includes(saved.kind) &&
          Array.isArray(saved.geometry?.attributes?.position?.array) && saved.geometry.attributes.position.array.length >= 9
        ).length;
        if (savedMeshCount === 0) {
          setStatus('LOAD STOPPED: walang 3D shapes sa file na ito. Posibleng empty/duplicate save file ang napili.');
          return;
        }
        validateProjectIdentityData(data.objects, Number(data.version) || 0);

        // Preload every embedded texture before mutating the active scene. A broken
        // image/data URL must fail during preflight, not halfway through restoration.
        const textureDataUrls = new Set<string>();
        data.objects.forEach((saved: any) => {
          const materials = Array.isArray(saved?.material) ? saved.material : [];
          materials.forEach((material: any) => {
            const textures = material?.textures && typeof material.textures === 'object' ? material.textures : {};
            Object.values(textures).forEach((textureData: any) => {
              if (textureData?.dataUrl) {
                if (typeof textureData.dataUrl !== 'string' || !textureData.dataUrl.startsWith('data:image/')) {
                  throw new Error('Project validation failed: invalid embedded texture data');
                }
                textureDataUrls.add(textureData.dataUrl);
              }
            });
          });
        });
        const preloadedTextures = new Map<string, THREE.Texture>();
        await Promise.all([...textureDataUrls].map(async dataUrl => {
          const texture = await new THREE.TextureLoader().loadAsync(dataUrl);
          if (!texture?.image) throw new Error('Project validation failed: embedded texture could not be decoded');
          preloadedTextures.set(dataUrl, texture);
        }));

        r.scene.userData.nexusNextShapeId = Math.max(Number(r.scene.userData.nexusNextShapeId) || 1, Number(data.nextShapeId) || 1);
        const restoredById = new Map<string, THREE.Object3D>();
        const restoredByName = new Map<string, THREE.Object3D>();
        const restoredNodeSet = new Set<THREE.Object3D>();
        const seenShapeIds = new Set<string>();
        for (const saved of data.objects) {
          if (!saved || !saved.geometry?.attributes?.position?.array || ['Bone', 'Rig', 'IK Target', 'IK Pole'].includes(saved.kind)) continue;
          if (data.version >= 4 && (typeof saved.shapeId !== 'string' || !/^No\.\d+$/.test(saved.shapeId))) throw new Error('Project validation failed: a Shape is missing its permanent Shape ID');
          if (saved.shapeId && seenShapeIds.has(saved.shapeId)) throw new Error('Project validation failed: duplicate Shape ID ' + saved.shapeId);
          if (saved.shapeId) seenShapeIds.add(saved.shapeId);
        }

        // First pass: resolve existing editor objects, or create missing scene objects.
        // This is the key difference from the old loader, which only updated objects
        // already present in the current scene.
        await Promise.all(data.objects.map(async (saved: any) => {
          if (!saved || typeof saved.name !== 'string') return;
          let obj = saved.shapeId
            ? r.selectable.find((candidate: THREE.Object3D) => candidate.userData.shapeId === saved.shapeId)
            : undefined;
          if (!obj && saved.editorId) obj = r.selectable.find((candidate: THREE.Object3D) => candidate.userData.editorId === saved.editorId);
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
            if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            const materialData = Array.isArray(saved.material) ? saved.material[0] : null;
            const material = createProjectMaterial(materialData || {});
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
          restoredNodeSet.add(obj);
          obj.name = saved.name;
          if (saved.editorData && typeof saved.editorData === 'object') {
            Object.entries(saved.editorData).forEach(([key, value]) => {
              if (key !== 'editorId') obj!.userData[key] = value;
            });
          }
          obj.userData.kind = saved.kind || obj.userData.kind || obj.type;
          if (saved.editorId) obj.userData.editorId = saved.editorId;
          if (saved.shapeId) {
            obj.userData.shapeId = saved.shapeId;
            obj.userData.shapeIdentityLabel = formatShapeIdentity(saved.name, saved.shapeId);
            const restoredNumber = Number(saved.shapeId.replace(/^No\./, ''));
            if (Number.isSafeInteger(restoredNumber)) {
              r.scene.userData.nexusNextShapeId = Math.max(Number(r.scene.userData.nexusNextShapeId) || 1, restoredNumber + 1);
            }
          }
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
            if (!restored.getAttribute('normal')) restored.computeVertexNormals();
            restored.computeBoundingBox();
            restored.computeBoundingSphere();
            obj.geometry.dispose();
            obj.geometry = restored;
            if (Array.isArray(saved.material) && saved.material.length) {
              const materials = saved.material.map((mat: any) => createProjectMaterial(mat));
              obj.material = materials.length === 1 ? materials[0] : materials;
              for (let materialIndex = 0; materialIndex < materials.length; materialIndex++) {
                const materialData = saved.material[materialIndex];
                const material = materials[materialIndex];
                const textureSlots = materialData?.textures && typeof materialData.textures === 'object' ? materialData.textures : {};
                for (const [slot, textureData] of Object.entries(textureSlots) as Array<[string, any]>) {
                  if (!textureData?.dataUrl || !['map','emissiveMap','normalMap','roughnessMap','metalnessMap','aoMap','alphaMap','bumpMap','displacementMap','lightMap','specularMap','clearcoatMap','clearcoatRoughnessMap','clearcoatNormalMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap','sheenRoughnessMap','transmissionMap','thicknessMap','specularIntensityMap','specularColorMap','gradientMap'].includes(slot)) continue;
                  const preloadedTexture = preloadedTextures.get(textureData.dataUrl);
                  if (!preloadedTexture) throw new Error('Project validation failed: embedded texture was not preloaded');
                  const texture = preloadedTexture.clone();
                  if (textureData.colorSpace) texture.colorSpace = textureData.colorSpace;
                  if (Number.isFinite(textureData.mapping)) texture.mapping = textureData.mapping;
                  if (Number.isFinite(textureData.wrapS)) texture.wrapS = textureData.wrapS;
                  if (Number.isFinite(textureData.wrapT)) texture.wrapT = textureData.wrapT;
                  if (typeof textureData.flipY === 'boolean') texture.flipY = textureData.flipY;
                  if (Array.isArray(textureData.repeat)) texture.repeat.fromArray(textureData.repeat);
                  if (Array.isArray(textureData.offset)) texture.offset.fromArray(textureData.offset);
                  if (Array.isArray(textureData.center)) texture.center.fromArray(textureData.center);
                  if (Number.isFinite(textureData.rotation)) texture.rotation = textureData.rotation;
                  if (Number.isFinite(textureData.magFilter)) texture.magFilter = textureData.magFilter;
                  if (Number.isFinite(textureData.minFilter)) texture.minFilter = textureData.minFilter;
                  if (Number.isFinite(textureData.anisotropy)) texture.anisotropy = textureData.anisotropy;
                  if (Number.isFinite(textureData.channel)) texture.channel = textureData.channel;
                  texture.needsUpdate = true;
                  (material as any)[slot] = texture;
                }
                material.needsUpdate = true;
              }
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
              // Prefer the exact saved persistent topology. For older project files
              // that only stored the quad-grid marker, rebuild from the known
              // canonical/indexed primitive layout rather than leaving stale metadata.
              const savedTopology = obj.userData.nexusTopology;
              if (savedTopology?.version === 1 && Array.isArray(savedTopology.faces)) {
                obj.userData.nexusTopology = savedTopology;
              } else if (saved.meshTopology.quadGrid === true) {
                const restoredPosition = obj.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
                const restoredTopology = restoredPosition
                  ? obj.geometry.index
                    ? buildTopologyFromIndexedQuadGeometry(restoredPosition.array, obj.geometry.index.array)
                    : buildTopologyFromCanonicalQuadGeometry(restoredPosition.array)
                  : null;
                if (restoredTopology) obj.userData.nexusTopology = restoredTopology;
                else delete obj.userData.nexusTopology;
              } else delete obj.userData.nexusTopology;
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
            if (obj instanceof THREE.SpotLight && Array.isArray(saved.light.targetPosition) && saved.light.targetPosition.length === 3) {
              obj.target.position.fromArray(saved.light.targetPosition);
              obj.target.updateMatrixWorld(true);
            }
          }
          if (obj instanceof THREE.Light && typeof saved.castShadow === 'boolean') {
            obj.castShadow = saved.castShadow;
          }
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = saved.castShadow !== false;
            obj.receiveShadow = saved.receiveShadow !== false;
          }
          if (saved.editorId) restoredById.set(saved.editorId, obj);
          restoredByName.set(saved.name, obj);
        }));

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

        assignShapeOwnership(r.selectable || []);

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


        r.scene.updateMatrixWorld(true);
        r.selectable.filter((obj: THREE.Object3D) => isShapeProjectMesh(obj)).forEach((obj: THREE.Object3D) => {
          const identity = ensureShapeIdentity(obj, r.selectable, Number(r.scene.userData.nexusNextShapeId) || 1);
          r.scene.userData.nexusNextShapeId = identity.nextId;
          obj.userData.shapeIdentityLabel = formatShapeIdentity(obj.name, identity.shapeId);
        });
        assignShapeOwnership(r.selectable || []);
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
        data.objects.forEach((saved: any) => {
          if (!saved?.faceSelection || !Array.isArray(saved.faceSelection.indices)) return;
          const mesh = saved.shapeId ? [...restoredNodeSet].find((candidate: THREE.Object3D) => candidate.userData.shapeId === saved.shapeId) : undefined;
          if (mesh instanceof THREE.Mesh && saved.faceSelection.indices.length >= 3) r.restoreExtrudedFaceSelection?.(mesh, saved.faceSelection.indices, saved.faceSelection.faceParts, saved.faceSelection.linkedIndices);
        });

        // Commit sub-object locks only after geometry, hierarchy, rigs, handles,
        // identity, selection, and face-selection restoration have completed.
        // A failure in any earlier stage therefore preserves the current scene's locks.
        r.clearSubObjectLocks?.();
        // Restore Vertex and Edge locks by permanent Shape ID, not transient editor IDs.
        (Array.isArray(data.subObjectLocks) ? data.subObjectLocks : []).forEach((savedLock: any) => {
          const mesh = [...restoredNodeSet].find((candidate: THREE.Object3D) => candidate.userData.shapeId === savedLock.shapeId);
          if (!(mesh instanceof THREE.Mesh)) return;
          if (Array.isArray(savedLock.Vertex) && savedLock.Vertex.length) r.addSubObjectLocks?.(String(mesh.userData.editorId), 'Vertex', savedLock.Vertex);
          if (Array.isArray(savedLock.Edge) && savedLock.Edge.length) r.addSubObjectLocks?.(String(mesh.userData.editorId), 'Edge', savedLock.Edge);
        });

        // Commit project-level UI state only after all scene restoration passes
        // have completed. Failed loads must not rename the active project or replace
        // its keyframe/undo state.
        if (data.projectName) setProjectName(String(data.projectName));
        if (data.animationSequence && typeof data.animationSequence === 'object') {
          const savedSequence = data.animationSequence;
          if (Array.isArray(savedSequence.states)) setSequenceStates(savedSequence.states.filter((state: any) => state && typeof state.id === 'string' && typeof state.label === 'string' && Number.isFinite(Number(state.width))).map((state: any) => ({ id: String(state.id), label: String(state.label), width: Math.max(1, Number(state.width)), mode: state.mode === 'continue' ? 'continue' : 'independent', objectId: typeof state.objectId === 'string' ? state.objectId : undefined })));
          if (typeof savedSequence.selectedState === 'string') setSelectedSequenceState(savedSequence.selectedState);
          if (Array.isArray(savedSequence.markers)) setTimelineMarkers(savedSequence.markers.filter((marker: any) => Number.isFinite(Number(marker.frame))).map((marker: any) => ({ id: String(marker.id || marker.frame), frame: Number(marker.frame), label: String(marker.label || 'Marker') })));
        }
        if (data.animationSettings && typeof data.animationSettings === 'object') {
          const settings = data.animationSettings;
          const restoredRate = Math.max(1, Math.min(60, Number(settings.frameRate) || 30));
          const restoredDuration = Math.max(1, Math.min(60, Number(settings.timelineDuration) || 10));
          setFrameRate(restoredRate); setTimelineDuration(restoredDuration);
          setCustomRulerStart(Math.max(0, Number.isFinite(Number(settings.customRulerStart)) ? Number(settings.customRulerStart) : 0));
          setCustomRulerStartUnit(settings.customRulerStartUnit === 'm' ? 'm' : 's');
          setCustomRulerEnd(Math.max(0, Number.isFinite(Number(settings.customRulerEnd)) ? Number(settings.customRulerEnd) : 0));
          setCustomRulerEndUnit(settings.customRulerEndUnit === 'm' ? 'm' : 's');
          setWorkStart(Math.max(0, Number(settings.workStart) || 0));
          setWorkEnd(Math.max(1, Number(settings.workEnd) || restoredRate * restoredDuration));
          setLoopPlayback(settings.loopPlayback !== false);
          if (typeof settings.interpolation === 'string') setInterpolation(settings.interpolation);
        }
        if (Array.isArray(data.animationClips)) {
          const clips = data.animationClips.flatMap((savedClip: any) => {
            const owner = restoredById.get(String(savedClip?.objectEditorId || ''));
            if (!owner || !savedClip?.clip) return [];
            try {
              const clip = THREE.AnimationClip.parse(savedClip.clip);
              return [{ id: String(owner.userData.editorId || owner.uuid) + ':' + clip.name, label: owner.name + ' · ' + (clip.name || 'Imported Clip'), object: owner, clip }];
            } catch (error) { console.warn('Animation clip restore skipped:', error); return []; }
          });
          setImportedAnimationClips(clips);
          setActiveAnimationClipId(clips[0]?.id || '');
        }
        if (data.keyframes && typeof data.keyframes === 'object') {
          const restoredKeys = data.keyframes as Keyframes;
          keysRef.current = restoredKeys;
          setKeyframes(restoredKeys);
          setUndoStack([]);
          setRedoStack([]);
          setActionUndoStack([]);
          setActionRedoStack([]);
        }

        // Destructive cleanup is the final commit step. Keep the previous scene's
        // objects available until hierarchy, rigs, skin bindings, handles, identity,
        // selection, and saved sub-object selection have all been restored.
        const staleNodes = collectObjectOnlyProjectNodes(r.selectable || []).filter((node: THREE.Object3D) => !restoredNodeSet.has(node));
        getObjectOnlyProjectRoots(staleNodes).forEach((node: THREE.Object3D) => r.removeObject(node, true));
        r.syncItems?.();
        if (firstRestored && r.selectable.includes(firstRestored)) r.selectObject?.(firstRestored);
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
    r.scene.userData.nexusNextShapeId = 1;
    r.clearSubObjectLocks?.();
    setUndoStack([]); setRedoStack([]); setActionUndoStack([]); setActionRedoStack([]);
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
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const objLoader = new OBJLoader(manager);
        if (materialFile) {
          const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
          const materials = new MTLLoader(manager).parse(await materialFile.text(), '');
          materials.preload();
          objLoader.setMaterials(materials);
        }
        object = objLoader.parse(await file.text());
      } else if (extension === 'gltf' || extension === 'glb' || extension === 'vrm') {
        const buffer = await file.arrayBuffer();
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader(manager);
        if (extension === 'vrm') {
          const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');
          loader.register(parser => new VRMLoaderPlugin(parser));
        }
        const gltf = await new Promise<any>((resolve, reject) => loader.parse(buffer, primaryDirectory, resolve, reject));
        object = gltf.scene;
        importedAnimations = gltf.animations || [];
        if (gltf.userData?.vrm) object.userData.nexusVRM = gltf.userData.vrm;
      } else if (extension === 'fbx') {
        const buffer = await file.arrayBuffer();
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
        object = new FBXLoader(manager).parse(buffer, primaryDirectory);
        importedAnimations = (object as any).animations || [];
      } else if (extension === 'dae') {
        const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
        const collada = new ColladaLoader(manager).parse(await file.text(), primaryDirectory);
        object = collada.scene;
        importedAnimations = collada.animations || [];
      } else if (extension === 'stl' || extension === 'ply') {
        const buffer = await file.arrayBuffer();
        let parsedGeometry: THREE.BufferGeometry;
        if (extension === 'stl') {
          const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
          parsedGeometry = new STLLoader(manager).parse(buffer);
        } else {
          const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
          parsedGeometry = new PLYLoader(manager).parse(buffer);
        }
        if (!parsedGeometry.getAttribute('normal')) parsedGeometry.computeVertexNormals();
        const hasColors = Boolean(parsedGeometry.getAttribute('color'));
        const material = new THREE.MeshStandardMaterial({ color: hasColors ? 0xffffff : 0xb8c5d6, roughness: 0.72, metalness: 0.08, vertexColors: hasColors });
        const mesh = new THREE.Mesh(parsedGeometry, material);
        mesh.name = file.name.replace(/\.(stl|ply)$/i, '') || 'Imported Geometry';
        object = new THREE.Group();
        object.add(mesh);
      } else if (extension === 'bvh') {
        const { BVHLoader } = await import('three/examples/jsm/loaders/BVHLoader.js');
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
        if (isShapeProjectMesh(node) && !node.userData.shapeId) {
          const identity = allocateShapeIdentity(importedNodes, Number(r.scene.userData.nexusNextShapeId) || 1);
          node.userData.shapeId = identity.shapeId;
          r.scene.userData.nexusNextShapeId = identity.nextId;
          node.userData.shapeIdentityLabel = formatShapeIdentity(node.name || object.name, identity.shapeId);
        }
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
      if (importedAnimations.length) {
        const entries = importedAnimations.map((clip, index) => ({
          id: String(object.userData.editorId || object.uuid) + ':' + index,
          label: object.name + ' · ' + (clip.name || 'Clip ' + (index + 1)),
          object,
          clip
        }));
        setImportedAnimationClips(previous => [...previous, ...entries]);
        setActiveAnimationClipId(current => current || entries[0].id);
      }
      importedNodes.forEach(node => { if (!r.selectable.includes(node)) r.selectable.push(node); });
      assignShapeOwnership(importedNodes);
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
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      const projectNodes = collectObjectOnlyProjectNodes(r.selectable || []);
      const projectNodeSet = new Set(projectNodes);
      const exportRoot = new THREE.Group();
      exportRoot.name = 'Nexus3D Object Project';
      getObjectOnlyProjectRoots(projectNodes).forEach((node: THREE.Object3D) => exportRoot.add(cloneSkeletonHierarchy(node)));
      exportRoot.traverse((node: any) => {
        const source = projectNodes.find((candidate: THREE.Object3D) => candidate.userData.editorId && candidate.userData.editorId === node.userData?.editorId);
        if (source?.userData?.editorId) node.name = node.name + '__NEXUS_EDITOR_ID_' + source.userData.editorId + (source.userData.shapeId ? '__NEXUS_ID_' + source.userData.shapeId : '');
      });
      const userDataSnapshots: Array<{ target: any; userData: any }> = [];
      exportRoot.traverse((node: any) => {
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
            exportRoot,
            result => {
              if (result instanceof ArrayBuffer) resolve(result);
              else reject(new Error('GLB exporter did not return a binary scene'));
            },
            error => reject(error instanceof Error ? error : new Error(String(error))),
            { binary: true, onlyVisible: false }
          );
        });
      } finally {
        userDataSnapshots.forEach(snapshot => { snapshot.target.userData = snapshot.userData; });
        exportRoot.clear();
      }
      const zip = new JSZip();
      const safeBase = (projectName.trim() || 'Nexus3D_Project').replace(/\.(nexus|zip)$/i, '').replace(/[^a-z0-9._-]/gi, '_');
      zip.file('Project.nexus', JSON.stringify({
        ...data,
        projectName: safeBase + '.nexus',
        savedObjectCount: data.objects.length,
        savedMeshCount: data.objects.filter((item: any) => item?.shapeId && item?.geometry?.attributes?.position?.array?.length).length
      }));
      zip.file('Scene/Scene.glb', glb);
      zip.file('Manifest.json', JSON.stringify({
        format: 'Nexus3D Portable Project',
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        projectFile: 'Project.nexus',
        sceneFile: 'Scene/Scene.glb',
        sceneBinaryIncludes: ['shape mesh geometry', 'shape hierarchy and transforms', 'materials and embedded texture images', 'supported skinning and skeleton data'],
        editorDataFileIncludes: ['per-shape permanent IDs and editor metadata', 'object-only snapshots', 'topology and IK rig data']
      }, null, 2));
      const base64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const fileName = safeBase.toLowerCase().endsWith('.zip') ? safeBase : safeBase + '.zip';
      if (Capacitor.isNativePlatform()) {
        const saved = await NexusProjectFiles.saveProjectArchive({ fileName, base64 });
        const verifiedBytes = Number(saved.writtenBytes) || 0;
        const sizeLabel = verifiedBytes > 0 ? verifiedBytes.toLocaleString() + ' bytes' : 'size not reported';
        setStatus('PROJECT ZIP EXPORTED SUCCESSFULLY — ' + (saved.name || fileName) + ' · ' + sizeLabel);
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
      validateProjectIdentityData(projectData.objects, Number(projectData.version) || 0);
      const expectedShapeIds = new Set<string>();
      const seenZipShapeIds = new Set<string>();
      const seenZipEditorIds = new Set<string>();
      projectData.objects.forEach((saved: any) => {
        if (!saved?.geometry?.attributes?.position?.array || ['Bone', 'Rig', 'IK Target', 'IK Pole'].includes(saved.kind)) return;
        if (projectData.version >= 4 && (typeof saved.shapeId !== 'string' || !/^No\.\d+$/.test(saved.shapeId))) throw new Error('ZIP validation failed: a Shape is missing its permanent Shape ID');
        if (saved.shapeId && seenZipShapeIds.has(saved.shapeId)) throw new Error('ZIP validation failed: duplicate Shape ID ' + saved.shapeId);
        if (saved.shapeId) { seenZipShapeIds.add(saved.shapeId); expectedShapeIds.add(saved.shapeId); }
      });
      projectData.objects.forEach((saved: any) => {
        if (!saved?.editorId) return;
        if (seenZipEditorIds.has(saved.editorId)) throw new Error('ZIP validation failed: duplicate editor object ID ' + saved.editorId);
        seenZipEditorIds.add(saved.editorId);
      });
      // Project ZIP import merges into the current scene; never duplicate stable IDs.
      const editorIdRemap = new Map<string, string>();
      // Reserve IDs across the complete scene graph, including hidden/non-selectable
      // bones and IK helpers, so merged imports cannot collide with attached objects.
      const existingSceneNodes: THREE.Object3D[] = [];
      r.scene.traverse((node: THREE.Object3D) => existingSceneNodes.push(node));
      const existingIdentityReservations = collectReservedIdentityIds(existingSceneNodes);
      const reservedEditorIds = existingIdentityReservations.editorIds;
      const reservedShapeIds = existingIdentityReservations.shapeIds;
      projectData.objects.forEach((saved: any) => {
        if (!saved?.editorId) return;
        const sourceId = String(saved.editorId);
        let targetId = sourceId;
        while (reservedEditorIds.has(targetId)) targetId = uid();
        reservedEditorIds.add(targetId);
        editorIdRemap.set(sourceId, targetId);
      });
      const shapeReservations = reserveImportedShapeIds(
        projectData.objects,
        reservedShapeIds,
        Math.max(
          Number(r.scene.userData.nexusNextShapeId) || 1,
          Number(projectData.nextShapeId) || 1,
          ...[...reservedShapeIds].map(id => Number(id.replace(/^No\./, '')) + 1).filter(Number.isSafeInteger),
          1
        )
      );
      const shapeIdRemap = shapeReservations.shapeIdRemap;
      const importNextShapeId = shapeReservations.nextShapeId;
      projectData.objects.forEach((saved: any) => {
        // Keep original IDs for matching the tagged GLB nodes before restoring remapped IDs.
        saved.__sourceEditorId = saved.editorId || null;
        saved.__sourceShapeId = saved.shapeId || null;
        // Remap every nested metadata reference, not only editorData, so custom
        // rig/attachment/topology references remain linked after a merge import.
        Object.keys(saved).forEach((key: string) => {
          if (['editorId', 'shapeId', 'ownerShapeId', 'parentEditorId', '__sourceEditorId', '__sourceShapeId'].includes(key)) return;
          saved[key] = remapImportedIdentityReferences(saved[key], editorIdRemap, shapeIdRemap);
        });
        if (saved.editorId) saved.editorId = editorIdRemap.get(String(saved.editorId)) || saved.editorId;
        if (saved.shapeId) saved.shapeId = shapeIdRemap.get(String(saved.shapeId)) || saved.shapeId;
        if (saved.ownerShapeId) saved.ownerShapeId = shapeIdRemap.get(String(saved.ownerShapeId)) || saved.ownerShapeId;
        if (saved.parentEditorId) saved.parentEditorId = editorIdRemap.get(String(saved.parentEditorId)) || saved.parentEditorId;
      });
      const remappedExpectedShapeIds = new Set<string>([...expectedShapeIds].map(id => shapeIdRemap.get(id) || id));
      const sceneBuffer = await sceneEntry.async('arraybuffer');
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => loader.parse(sceneBuffer, '', resolve, reject));
      const importedScene: THREE.Object3D = gltf.scene;
      importedScene.name = (projectData.projectName || file?.name || 'Nexus3D Imported Project').replace(/\.(nexus|zip)$/i, '');
      const savedByName = new Map<string, any[]>();
      const savedByShapeId = new Map<string, any>();
      const savedByEditorId = new Map<string, any>();
      projectData.objects.forEach((saved: any) => {
        if (saved?.__sourceShapeId) savedByShapeId.set(saved.__sourceShapeId, saved);
        if (saved?.__sourceEditorId) savedByEditorId.set(saved.__sourceEditorId, saved);
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
        const identityMatch = /__NEXUS_EDITOR_ID_(.+?)(?:__NEXUS_ID_(No\.\d+))?$/.exec(node.name);
        const editorIdMatch = identityMatch ? savedByEditorId.get(identityMatch[1]) : undefined;
        const shapeIdMatch = identityMatch?.[2] ? savedByShapeId.get(identityMatch[2]) : undefined;
        const matched = editorIdMatch || shapeIdMatch;
        if (matched) node.name = matched.name;
        const candidates = savedByName.get(node.name + '::' + kind) || savedByName.get(node.name + '::') || [];
        const saved = matched || candidates.shift();
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
          // GLB carries light appearance, but editor-only shadow flags and the
          // explicit SpotLight target must be restored from Project.nexus metadata.
          if (node.isDirectionalLight) configureDirectionalShadow(node);
          if (node.isLight && saved.light) {
            if (saved.light.color && node.color?.set) node.color.set('#' + saved.light.color);
            if (Number.isFinite(saved.light.intensity)) node.intensity = saved.light.intensity;
            if ((node.isPointLight || node.isSpotLight) && Number.isFinite(saved.light.distance)) node.distance = saved.light.distance;
            if ((node.isPointLight || node.isSpotLight) && Number.isFinite(saved.light.decay)) node.decay = saved.light.decay;
            if (node.isSpotLight && Number.isFinite(saved.light.angle)) node.angle = saved.light.angle;
            if (node.isHemisphereLight && saved.light.groundColor) node.groundColor.set('#' + saved.light.groundColor);
            if (node.shadow && Number.isFinite(saved.light.shadowBias)) node.shadow.bias = saved.light.shadowBias;
            if (node.shadow && Number.isFinite(saved.light.shadowRadius)) node.shadow.radius = saved.light.shadowRadius;
            if (node.isSpotLight && Array.isArray(saved.light.targetPosition) && saved.light.targetPosition.length === 3) {
              node.target.position.fromArray(saved.light.targetPosition);
              node.target.updateMatrixWorld(true);
            }
            if (typeof saved.castShadow === 'boolean') node.castShadow = saved.castShadow;
          }
          if (saved.shapeId) {
            node.userData.shapeId = saved.shapeId;
            node.userData.shapeIdentityLabel = formatShapeIdentity(saved.name || node.name, saved.shapeId);
            const restoredNumber = Number(saved.shapeId.replace(/^No\./, ''));
            if (Number.isSafeInteger(restoredNumber)) {
              r.scene.userData.nexusNextShapeId = Math.max(Number(r.scene.userData.nexusNextShapeId) || 1, restoredNumber + 1);
            }
          }
        } else {
          node.userData.editorId = node.userData.editorId || uid();
          node.userData.kind = kind;
        }
        importedNodes.push(node);
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
      });
      // GLTF's punctual-light extension does not represent every Three.js light type.
      // Recreate metadata-backed lights omitted from Scene.glb (notably Ambient/Hemisphere)
      // so ZIP import does not silently lose editable scene lighting.
      for (const saved of projectData.objects) {
        if (!saved?.light || !saved?.editorId || restoredById.has(saved.editorId)) continue;
        const lightType = String(saved.lightType || '').toLowerCase();
        let light: THREE.Light | null = null;
        const color = saved.light.color ? '#' + saved.light.color : '#ffffff';
        const intensity = Number.isFinite(saved.light.intensity) ? saved.light.intensity : 1;
        if (lightType === 'ambient' || saved.objectType === 'AmbientLight') {
          light = new THREE.AmbientLight(color, intensity);
        } else if (lightType === 'hemisphere' || saved.objectType === 'HemisphereLight') {
          light = new THREE.HemisphereLight(color, saved.light.groundColor ? '#' + saved.light.groundColor : '#444444', intensity);
        } else if (lightType === 'directional' || saved.objectType === 'DirectionalLight') {
          light = new THREE.DirectionalLight(color, intensity);
          configureDirectionalShadow(light);
        } else if (lightType === 'point' || saved.objectType === 'PointLight') {
          light = new THREE.PointLight(color, intensity, Number.isFinite(saved.light.distance) ? saved.light.distance : 0, Number.isFinite(saved.light.decay) ? saved.light.decay : 2);
        } else if (lightType === 'spot' || saved.objectType === 'SpotLight') {
          light = new THREE.SpotLight(color, intensity, Number.isFinite(saved.light.distance) ? saved.light.distance : 0, Number.isFinite(saved.light.angle) ? saved.light.angle : Math.PI / 3, 0, Number.isFinite(saved.light.decay) ? saved.light.decay : 2);
        }
        if (!light) continue;
        light.name = String(saved.name || 'Restored Light');
        light.userData = saved.editorData && typeof saved.editorData === 'object' ? JSON.parse(JSON.stringify(saved.editorData)) : {};
        light.userData.editorId = saved.editorId;
        light.userData.kind = 'Light';
        light.userData.lightType = saved.lightType || lightType;
        if (Array.isArray(saved.position)) light.position.fromArray(saved.position);
        if (Array.isArray(saved.rotation)) light.rotation.set(saved.rotation[0] || 0, saved.rotation[1] || 0, saved.rotation[2] || 0);
        if (Array.isArray(saved.scale)) light.scale.fromArray(saved.scale);
        light.visible = saved.visible !== false;
        light.castShadow = Boolean(saved.castShadow);
        if (light.shadow && Number.isFinite(saved.light.shadowBias)) light.shadow.bias = saved.light.shadowBias;
        if (light.shadow && Number.isFinite(saved.light.shadowRadius)) light.shadow.radius = saved.light.shadowRadius;
        if (light instanceof THREE.SpotLight && Array.isArray(saved.light.targetPosition) && saved.light.targetPosition.length === 3) {
          light.target.position.fromArray(saved.light.targetPosition);
          light.target.updateMatrixWorld(true);
          importedScene.add(light.target);
        }
        const helper = importedScene.getObjectByName(light.name + '_Helper');
        if (helper) {
          helper.userData.isLightHelper = true;
          light.add(helper);
        }
        importedScene.add(light);
        importedNodes.push(light);
        restoredById.set(saved.editorId, light);
      }
      // Restore the editor's full material settings and embedded texture slots
      // from Project.nexus; GLB alone does not represent every Three.js material map.
      for (const saved of projectData.objects) {
        if (!saved?.editorId || !Array.isArray(saved.material) || !saved.material.length) continue;
        const mesh = restoredById.get(saved.editorId);
        if (!(mesh instanceof THREE.Mesh)) continue;
        const materials = saved.material.map((materialData: any) => createProjectMaterial(materialData));
        for (let materialIndex = 0; materialIndex < materials.length; materialIndex++) {
          const materialData = saved.material[materialIndex];
          const material = materials[materialIndex];
          const textureSlots = materialData?.textures && typeof materialData.textures === 'object' ? materialData.textures : {};
          for (const [slot, textureData] of Object.entries(textureSlots) as Array<[string, any]>) {
            if (!textureData?.dataUrl || !['map','emissiveMap','normalMap','roughnessMap','metalnessMap','aoMap','alphaMap','bumpMap','displacementMap','lightMap','specularMap','clearcoatMap','clearcoatRoughnessMap','clearcoatNormalMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap','sheenRoughnessMap','transmissionMap','thicknessMap','specularIntensityMap','specularColorMap','gradientMap'].includes(slot)) continue;
            const texture = await new THREE.TextureLoader().loadAsync(textureData.dataUrl);
            if (textureData.colorSpace) texture.colorSpace = textureData.colorSpace;
            if (Number.isFinite(textureData.mapping)) texture.mapping = textureData.mapping;
            if (Number.isFinite(textureData.wrapS)) texture.wrapS = textureData.wrapS;
            if (Number.isFinite(textureData.wrapT)) texture.wrapT = textureData.wrapT;
            if (typeof textureData.flipY === 'boolean') texture.flipY = textureData.flipY;
            if (Array.isArray(textureData.repeat)) texture.repeat.fromArray(textureData.repeat);
            if (Array.isArray(textureData.offset)) texture.offset.fromArray(textureData.offset);
            if (Array.isArray(textureData.center)) texture.center.fromArray(textureData.center);
            if (Number.isFinite(textureData.rotation)) texture.rotation = textureData.rotation;
            if (Number.isFinite(textureData.magFilter)) texture.magFilter = textureData.magFilter;
            if (Number.isFinite(textureData.minFilter)) texture.minFilter = textureData.minFilter;
            if (Number.isFinite(textureData.anisotropy)) texture.anisotropy = textureData.anisotropy;
            if (Number.isFinite(textureData.channel)) texture.channel = textureData.channel;
            texture.needsUpdate = true;
            (material as any)[slot] = texture;
          }
          material.needsUpdate = true;
        }
        mesh.material = materials.length === 1 ? materials[0] : materials;
      }
      const restoredShapeIds = new Set(importedNodes.map(node => node.userData.shapeId).filter((id: any): id is string => typeof id === 'string'));
      const missingShapeIds = [...remappedExpectedShapeIds].filter(id => !restoredShapeIds.has(id));
      if (missingShapeIds.length) throw new Error('ZIP scene is missing Shape mesh data for ' + missingShapeIds.join(', '));
      r.scene.userData.nexusNextShapeId = Math.max(Number(r.scene.userData.nexusNextShapeId) || 1, importNextShapeId);
      r.scene.add(importedScene);
      importedNodes.forEach(node => { if (!r.selectable.includes(node)) r.selectable.push(node); });
      assignShapeOwnership(importedNodes);
      (Array.isArray(projectData.subObjectLocks) ? projectData.subObjectLocks : []).forEach((savedLock: any) => {
        const mesh = importedNodes.find(node => node.userData.shapeId === savedLock.shapeId);
        if (!(mesh instanceof THREE.Mesh)) return;
        if (Array.isArray(savedLock.Vertex) && savedLock.Vertex.length) r.addSubObjectLocks?.(String(mesh.userData.editorId), 'Vertex', savedLock.Vertex);
        if (Array.isArray(savedLock.Edge) && savedLock.Edge.length) r.addSubObjectLocks?.(String(mesh.userData.editorId), 'Edge', savedLock.Edge);
      });
      projectData.objects.forEach((saved: any) => {
        if (saved?.kind !== 'Rig') return;
        const rig = saved.editorId ? restoredById.get(saved.editorId) : undefined;
        if (rig) r.restoreRigGroup?.(rig);
      });
      projectData.objects.forEach((saved: any) => {
        if (!saved?.faceSelection || !Array.isArray(saved.faceSelection.indices)) return;
        const mesh = importedNodes.find(node => node.userData.shapeId === saved.shapeId);
        if (mesh instanceof THREE.Mesh && saved.faceSelection.indices.length >= 3) r.restoreExtrudedFaceSelection?.(mesh, saved.faceSelection.indices, saved.faceSelection.faceParts, saved.faceSelection.linkedIndices);
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



  return (
    <main className={'editor-shell' + (riggingView ? ' rigging-mode' : '') + (animationMode ? ' animation-mode' : '')}>


      <div className={'viewport ' + (pathTool ? 'path-tool-active' : '')} ref={hostRef} onPointerDown={e => { if (!pathTool || animationMode) return; const rect = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - rect.left) / rect.width - .5) * 20; const z = ((e.clientY - rect.top) / rect.height - .5) * -20; setMotionPathPoints(prev => [...prev, {x, y:0.05, z}]); }} onDragOver={e => { if (e.dataTransfer.types.includes('text/nexus3d-object')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={e => { const childId = e.dataTransfer.getData('text/nexus3d-object'); if (!childId) return; e.preventDefault(); const child = runtime.current?.selectable.find((o: THREE.Object3D) => o.userData.editorId === childId); if (child) runtime.current?.reparentObject(child); }} />
      <div ref={ikHostRef} className={'ik-dedicated-viewport ' + (riggingView ? 'active' : '')} aria-label="Dedicated IK Rigging 3D viewport" />
       {riggingView && <div className="ik-rig-actions" aria-label="Compact Manual IK tools">
         <button type="button" title="Create Root Bone" aria-label="Create Root Bone" onClick={() => runtime.current?.addUniversalBone?.('root')}><Plus size={13}/><span>ROOT</span></button>
         <button type="button" title="Create Child Bone" aria-label="Create Child Bone" onClick={() => runtime.current?.addUniversalBone?.('child')}><GitBranch size={13}/><span>CHILD</span></button>
         <button type="button" title="Attach Root to Shape" aria-label="Attach Root to Shape" onClick={() => runtime.current?.attachRootToShape?.()}><Link2 size={13}/><span>ROOT LINK</span></button>
         <button type="button" title="Set selected Bone as Object Parent" aria-label="Set selected Bone as Object Parent" onClick={() => runtime.current?.setRigParentTarget?.()}><Target size={13}/><span>PARENT</span></button>
         <button type="button" title="Attach selected Shape or Object to the chosen Bone" aria-label="Attach selected Shape or Object to the chosen Bone" onClick={() => runtime.current?.attachSelectedToRigParent?.()}><Link2 size={13}/><span>LINK</span></button>
         <button type="button" title="Detach selected Object from its Rig Parent" aria-label="Detach selected Object from its Rig Parent" onClick={() => runtime.current?.detachSelectedRigObject?.()}><Unlink size={13}/><span>DETACH</span></button>
          <button type="button" title="Open Character Rigging workflow" aria-label="Character Rigging Tools" className={characterRigPanelOpen ? 'active' : ''} aria-expanded={characterRigPanelOpen} onClick={() => setCharacterRigPanelOpen(value => !value)}><GitBranch size={13}/><span>CHAR RIG</span></button>
          <button type="button" title="Bind selected mesh to Rig using deforming skin weights" aria-label="Bind Mesh to Rig" onClick={() => runtime.current?.bindSelectedMeshToRig?.()}><Layers size={13}/><span>SKIN</span></button>
         <button type="button" title="Create Control Handle" aria-label="Create Control Handle" onClick={() => runtime.current?.toggleSelectedBoneControlHandle?.()}><Target size={13}/><span>HANDLE</span></button>
         <button type="button" title="Lock or Unlock Bone" aria-label="Lock or Unlock Bone" onClick={() => runtime.current?.toggleSelectedBoneLock?.()}><Lock size={13}/><span>LOCK</span></button>
         <button type="button" title="Detect Existing Rig" aria-label="Detect Existing Rig" onClick={() => runtime.current?.detectRiggedMeshes?.()}><ScanEye size={13}/><span>DETECT</span></button>
         <button type="button" title="Create IK Target" aria-label="Create IK Target" onClick={() => runtime.current?.createIKTarget?.()}><Target size={13}/><span>TARGET</span></button>
         <button type="button" title="Create IK Pole" aria-label="Create IK Pole" onClick={() => runtime.current?.createPoleTarget?.()}><Circle size={13}/><span>POLE</span></button>
         <button type="button" title="Solve Manual IK" aria-label="Solve Manual IK" onClick={() => runtime.current?.solveIK?.()}><Check size={13}/><span>SOLVE</span></button>
         <button type="button" title="Mirror Selected Bone" aria-label="Mirror Selected Bone" onClick={() => { if (runtime.current) { mirrorEnabledRef.current = true; runtime.current.mirrorSelectedBone?.(); } }}><GitMerge size={13}/><span>MIRROR</span></button>
         <button type="button" title="Show or Hide Bone Chain" aria-label="Show or Hide Bone Chain" onClick={() => runtime.current?.toggleSelectedRigDisplay?.()}><Eye size={13}/><span>SHOW</span></button>
         <button type="button" className={ikSpringPanelOpen ? 'active' : ''} title="Open optional Spring Effect settings" aria-label="Spring Effect settings" aria-expanded={ikSpringPanelOpen} onClick={() => setIkSpringPanelOpen(value => !value)}><Waves size={13}/><span>SPRING</span></button>
       </div>}
      
       {riggingView && characterRigPanelOpen && <section className="ik-character-rig-panel" aria-label="Character Rigging Tools">
         <div className="ik-character-rig-heading"><strong>CHARACTER RIGGING</strong><button type="button" onClick={() => setCharacterRigPanelOpen(false)} aria-label="Close Character Rigging Tools">×</button></div>
         <p>Workflow: select the complete Character Group, create one template, detect parts, review assignments, then bind.</p>
         <div className="ik-character-rig-grid">
           <button type="button" aria-label="Create Humanoid Rig Template" onClick={() => runtime.current?.createManualRig?.()}><GitBranch size={13}/><span>TEMPLATE</span></button>
           <button type="button" aria-label="Detect Character Body Parts" onClick={() => runtime.current?.detectCharacterBodyParts?.()}><ScanSearch size={13}/><span>DETECT PARTS</span></button>
           <button type="button" aria-label="Bind All Character Meshes" onClick={() => runtime.current?.bindAllCharacterMeshesToRig?.()}><Layers size={13}/><span>BIND ALL</span></button>
           <button type="button" onClick={() => runtime.current?.normalizeSelectedSkinWeights?.()}><SlidersHorizontal size={13}/><span>WEIGHT NORM</span></button>
           <button type="button" onClick={() => runtime.current?.smoothSelectedSkinWeights?.()}><Waves size={13}/><span>WEIGHT SMOOTH</span></button>
         </div>
       </section>}
      {riggingView && ikSpringPanelOpen && <section className="ik-spring-panel" aria-label="Manual IK Spring Effect settings">
        <div className="ik-spring-heading"><strong>SPRING EFFECT</strong><label><input type="checkbox" checked={ikSpringEnabled} onChange={event => { const enabled = event.target.checked; setIkSpringEnabled(enabled); runtime.current?.configureIkSpring?.({ enabled }); }}/><span>{ikSpringEnabled ? 'ON' : 'OFF'}</span></label></div>
        <p>OFF = direct IK movement · ON = adjustable follow-through</p>
        <label className="ik-spring-control"><span>STRENGTH <output>{ikSpringStrength}%</output></span><input aria-label="Spring Strength" type="range" min="0" max="100" value={ikSpringStrength} disabled={!ikSpringEnabled} onChange={event => { const value = Number(event.target.value); setIkSpringStrength(value); runtime.current?.configureIkSpring?.({ strength: value }); }}/></label>
        <label className="ik-spring-control"><span>DAMPING <output>{ikSpringDamping}%</output></span><input aria-label="Spring Damping" type="range" min="0" max="100" value={ikSpringDamping} disabled={!ikSpringEnabled} onChange={event => { const value = Number(event.target.value); setIkSpringDamping(value); runtime.current?.configureIkSpring?.({ damping: value }); }}/></label>
        <label className="ik-spring-control"><span>FOLLOW-THROUGH <output>{ikSpringFollowThrough}%</output></span><input aria-label="Spring Follow-through" type="range" min="0" max="100" value={ikSpringFollowThrough} disabled={!ikSpringEnabled} onChange={event => { const value = Number(event.target.value); setIkSpringFollowThrough(value); runtime.current?.configureIkSpring?.({ followThrough: value }); }}/></label>
        <button type="button" className="ik-spring-reset" onClick={() => { setIkSpringStrength(35); setIkSpringDamping(75); setIkSpringFollowThrough(40); runtime.current?.configureIkSpring?.({ strength: 35, damping: 75, followThrough: 40 }); }}>RESET SETTINGS</button>
      </section>}
      <div className={'camera-mode-hud ' + (cameraView ? 'cine-active' : '')} aria-live="polite"><span className="camera-mode-dot" />{animationMode ? 'ANIMATION · USER CAMERA VIEW' : cameraView ? 'CINE CAMERA VIEW' : riggingView ? 'IK RIGGING · FRONT PERSPECTIVE' : 'PERSPECTIVE MODE'}</div>
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
          {quickPanel === 'transform' && <><div className="quick-panel-note">Select an object in the scene tree, then choose a transform mode.</div><div className="quick-transform-row"><button type="button" className={mode === 'translate' ? 'active' : ''} onClick={() => runMode('translate')}><Move size={14}/>Move</button><button type="button" className={mode === 'rotate' ? 'active' : ''} onClick={() => runMode('rotate')}><Rotate3D size={14}/>Rotate</button><button type="button" className={mode === 'scale' ? 'active' : ''} onClick={() => runMode('scale')}><Scaling size={14}/>Scale</button></div><div className="quick-panel-note">The viewport gizmo follows the current selection.</div></>}
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
          <button type="button" className={"icon-btn rds-launch-btn " + (rdsPanelOpen ? "active" : "")} onClick={() => { setRdsPanelOpen(open => !open); setMenuOpen(false); setPanel(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); }} title="Open RDS Command Center" aria-label="Open RDS Command Center"><Activity size={16}/><span className="tiny-label">RDS</span></button>
          <div className="tool-divider" />
          <button className="icon-btn" onClick={undo} disabled={!actionUndoStack.length && !undoStack.length} title="Undo scene or timeline action"><Undo2 size={15} /></button>
          <button className="icon-btn" onClick={redo} disabled={!actionRedoStack.length && !redoStack.length} title="Redo scene or timeline action"><Redo2 size={15} /></button>
          <button className={'icon-btn ' + (shapeLibraryOpen ? 'active' : '')} onClick={() => { setShapeLibraryOpen(v => !v); setMenuOpen(false); setPanel(false); setQuickPanel(null); setInspectorOpen(false); setMeshToolsOpen(false); }} title="Open Shape Library" aria-label="Open Shape Library"><Box size={14} /></button>
          <button className={'icon-btn ' + (meshToolsOpen ? 'active' : '')} onClick={() => { const candidate = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected); if (!(candidate instanceof THREE.Mesh)) { setStatus('Select a mesh to enable Mesh Editing'); return; } const opening = !meshToolsOpen; setMeshToolsOpen(opening); setShapeLibraryOpen(false); setPanel(false); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); if (opening) { setEditMode('Object'); editModeRef.current = 'Object'; setEditTool(''); runtime.current?.clearSubSelection?.(); const tr = runtime.current?.transform; if (tr) { tr.detach(); tr.enabled = false; tr.getHelper().visible = false; } } else { const tr = runtime.current?.transform; if (tr) { tr.detach(); tr.attach(candidate); tr.setMode(mode); tr.setSpace(space); tr.enabled = true; tr.getHelper().visible = true; } } }} disabled={!selected || !(runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected) instanceof THREE.Mesh)} title="Toggle Mesh Editing" aria-label="Toggle Mesh Editing"><Scissors size={15}/></button>
          <button type="button" className={'icon-btn geometry-rit-toolbar-btn ' + (geometryRitOpen ? 'active' : '')} onClick={() => { if (!geometryRitOpen) { setGeometryRitReport('NOT SCANNED — open Geometry RIT and run Scan to create a current-scene report.'); setGeometryRitSummary({ status: 'NOT SCANNED', meshes: 0, vertices: 0, triangles: 0, errors: 0, warnings: 0 }); } setGeometryRitOpen(open => !open); setSkyboxOpen(false);  setMeshToolsOpen(false); setShapeLibraryOpen(false); setMenuOpen(false); setPanel(false); setQuickPanel(null); setInspectorOpen(false); }} title="Independent Geometry RIT Diagnostics" aria-label="Open Geometry RIT diagnostics"><ScanSearch size={15}/></button>
          <span className="toolbar-center-spacer" aria-hidden="true" />
          <button className="icon-btn render-toolbar-btn" onClick={exportRenderImage} title="Render Image (PNG)" aria-label="Render Image" disabled={cameraView}><Aperture size={15} /></button>
          
          <button className={'icon-btn render-toolbar-btn ' + (skyboxOpen ? 'active' : '')} id="btn-skybox" onClick={() => { setSkyboxOpen(v => !v); setSkyboxCategory('Time-of-Day Presets');  setMeshToolsOpen(false); setPanel(false); setMenuOpen(false); setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); }} title="Skybox & Environment" aria-label="Skybox"><Globe size={15} /></button>
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

      {rdsPanelOpen && !cameraView && !animationMode && <aside className="rds-command-center" role="dialog" aria-label="Nexus3D RDS Command Center" style={{ width: rdsPanelWidth, height: rdsPanelHeight }}>
        <div className="rds-command-header">
          <div className="rds-command-brand"><Activity size={17}/><div><strong>NEXUS3D RDS</strong><small>RUNTIME DIAGNOSTICS · FORENSIC CENTER</small></div></div>
          <div className="rds-command-header-actions"><span className="rds-live-indicator">LIVE</span><button type="button" onClick={() => setRdsPanelOpen(false)} aria-label="Close RDS Command Center"><X size={15}/></button></div>
        </div>
        <div className="rds-command-body">
          <nav className="rds-command-nav" aria-label="RDS tools">
            {[['Overview','LayoutDashboard'],['Runtime','Activity'],['LogCat','Activity'],['RIT Trace','ListTree'],['DFI Core','ScanEye'],['Mesh DFI','Box'],['Root Cause','GitBranch'],['Source Audit','Code2'],['Reports','FileText']].map(([name, icon]) => <button key={name} type="button" className={'rds-nav-item ' + (rdsActiveTool === name ? 'active' : '')} aria-current={rdsActiveTool === name ? 'page' : undefined} onClick={() => setRdsActiveTool(name)}>
              {name === 'Overview' ? <Layers size={21}/> : name === 'Runtime' ? <Activity size={21}/> : name === 'LogCat' ? <Activity size={21}/> : name === 'RIT Trace' ? <GitBranch size={21}/> : name === 'DFI Core' ? <ScanEye size={21}/> : name === 'Mesh DFI' ? <Box size={21}/> : name === 'Root Cause' ? <GitMerge size={21}/> : name === 'Source Audit' ? <Code2 size={21}/> : <FileJson size={21}/>}
              <span>{name}</span>
            </button>)}
          </nav>
          <main className="rds-command-content">
            <div className="rds-content-heading"><div><span className="rds-eyebrow">DIAGNOSTIC WORKSPACE</span><h2>{rdsActiveTool === 'Overview' ? 'System Overview' : rdsActiveTool}</h2></div><div className="rds-content-heading-actions"><span className="rds-session-chip">SESSION ACTIVE</span><button type="button" className="rds-tool-button rds-export-zip-button" onClick={() => void exportRdsToolZip(rdsActiveTool)} disabled={rdsExportBusy} title={'Download ' + rdsActiveTool + ' report ZIP'} aria-label={'Download ' + rdsActiveTool + ' report ZIP'}><Download size={15}/></button>{(rdsExportBusy || rdsExportPhase === 'done' || rdsExportPhase === 'failed') && <span className={'rds-export-progress ' + (rdsExportPhase === 'failed' ? 'failed' : rdsExportPhase === 'done' ? 'complete' : 'active')} role="status" aria-live="polite">{rdsExportPhase === 'failed' ? 'FAILED' : rdsExportPhase === 'done' ? 'SUCCESS' : rdsExportPhase === 'passed' ? 'PASSED' : rdsExportPhase === 'saving' || rdsExportPhase === 'verifying' ? 'VERIFYING' : 'SAVING ' + rdsExportProgress + '%'}</span>}</div></div>
            {rdsActiveTool === 'Overview' && <>
              <div className="rds-stat-grid">
                <div className="rds-stat-card"><Activity/><small>Runtime Logs</small><strong>{diagnosticLogs.length}</strong></div>
                <div className="rds-stat-card rds-stat-error"><ScanEye/><small>Errors</small><strong>{diagnosticLogs.filter(entry => entry.level === 'ERROR').length}</strong></div>
                <div className="rds-stat-card rds-stat-warning"><Gauge/><small>Warnings</small><strong>{diagnosticLogs.filter(entry => entry.level === 'WARN').length}</strong></div>
                <div className="rds-stat-card"><Box/><small>Scene Objects</small><strong>{items.length}</strong></div>
              </div>
              <section className="rds-info-card"><div className="rds-card-heading"><strong>Latest Diagnostic Results</strong><span>{rdsLastScanAt || 'Not scanned'}</span></div><div className="rds-result-line"><span>Full Core Scan</span><b>{rdsScanSummary.checks ? rdsScanSummary.checks + ' checks' : 'Awaiting scan'}</b></div><div className="rds-result-line"><span>DFI Investigation</span><b>{dfiSummary.findings ? dfiSummary.findings + ' finding(s)' : 'Awaiting analysis'}</b></div><div className="rds-result-line"><span>Interaction Trace</span><b>{diagnosticLogs.filter(entry => entry.source === 'Interaction Trace').length} events</b></div></section>
              <div className="rds-quick-actions"><button type="button" onClick={runRdsFullScan} disabled={rdsScanBusy}><ScanEye size={16}/>{rdsScanBusy ? 'Scanning…' : 'Full Scan'}</button><button type="button" onClick={() => void runDfiInvestigation()} disabled={dfiBusy}><Activity size={16}/>{dfiBusy ? 'Analyzing…' : 'Deep Analysis'}</button><button type="button" onClick={copyAllDfiReport}><Copy size={16}/>Copy All</button></div>
            </>}
            {rdsActiveTool === 'Runtime' && <><div className="rds-summary-strip"><span>{diagnosticLogs.length} captured</span><span>{diagnosticLogs.filter(entry => entry.level === 'ERROR').length} errors</span><span>{diagnosticLogs.filter(entry => entry.level === 'WARN').length} warnings</span></div><div className="rds-command-log-list">{visibleDiagnosticLogs.slice().reverse().map(entry => <article className={'diagnostic-entry diagnostic-' + entry.level.toLowerCase()} key={entry.id}><div><strong>{entry.level}</strong><time>{entry.time}</time></div><b>{entry.source}</b><p>{entry.message}</p>{entry.details && <pre>{entry.details}</pre>}</article>)}{!visibleDiagnosticLogs.length && <div className="diagnostic-empty">No runtime logs match the selected filter.</div>}</div><div className="rds-quick-actions"><button type="button" onClick={() => setDiagnosticFilter('ALL')} aria-label="Show all logs">All</button><button type="button" onClick={() => setDiagnosticFilter('ERROR')} aria-label="Show errors">Errors</button><button type="button" onClick={() => setDiagnosticFilter('WARN')} aria-label="Show warnings">Warnings</button><button type="button" onClick={() => setDiagnosticFilter('INFO')} aria-label="Show info logs">Info</button><button type="button" onClick={() => void copyDiagnosticText(visibleDiagnosticLogs)} aria-label="Copy filtered RDS logs"><Copy size={14}/>Copy</button><button type="button" onClick={() => void copyDiagnosticText(diagnosticLogs)} aria-label="Copy all RDS logs"><Copy size={14}/>Copy All</button><button type="button" onClick={clearDiagnosticLogs} aria-label="Clear all RDS logs"><Trash2 size={14}/>Clear</button></div></>}
            {rdsActiveTool === 'LogCat' && <>
              <div className="rds-summary-strip"><span>{getLogcatEntries().length} runtime events</span><span>{getLogcatEntries().filter(entry => entry.level === 'ERROR' || entry.level === 'FATAL').length} errors</span><span>{getLogcatEntries().filter(entry => entry.level === 'WARN').length} warnings</span><span>{logcatPaused ? 'PAUSED' : 'LIVE'}</span></div>
              <div className="rds-logcat-toolbar">
                <input aria-label="Search runtime logs" value={logcatSearch} onChange={event => setLogcatSearch(event.target.value)} placeholder="Search logs…" />
                <button type="button" className="rds-tool-button" onClick={logcatPaused ? resumeLogcat : pauseLogcat} title={logcatPaused ? 'Resume LogCat' : 'Pause LogCat'} aria-label={logcatPaused ? 'Resume LogCat' : 'Pause LogCat'}>{logcatPaused ? <Play size={14}/> : <Pause size={14}/>}</button>
                <button type="button" className="rds-tool-button" onClick={refreshLogcat} title="Refresh LogCat" aria-label="Refresh LogCat"><RefreshCw size={14}/></button>
                <button type="button" className="rds-tool-button" onClick={clearDiagnosticLogs} disabled={!getLogcatEntries().length} title="Clear LogCat only" aria-label="Clear LogCat"><Trash2 size={14}/></button>
                <button type="button" className="rds-tool-button" onClick={() => void copyDiagnosticText(visibleLogcatEntries)} title="Copy report" aria-label="Copy LogCat report"><Copy size={14}/></button>
              </div>
              <div className="rds-quick-actions">
                {(['ALL','VERBOSE','DEBUG','INFO','WARN','ERROR','FATAL'] as const).map(level => <button key={level} type="button" className={logcatLevel === level ? 'active' : ''} onClick={() => setLogcatLevel(level)}>{level === 'ALL' ? 'All' : level}</button>)}
              </div>
              <details className="rds-logcat-filters"><summary>Advanced filters</summary>
                <div><label>Source<input value={logcatSourceFilter} onChange={event => setLogcatSourceFilter(event.target.value)} placeholder="Component / source"/></label>
                <label>Component tag<input value={logcatTagFilter} onChange={event => setLogcatTagFilter(event.target.value)} placeholder="Tag"/></label>
                <label>Trace point<select value={logcatTracePointFilter} onChange={event => setLogcatTracePointFilter(event.target.value)}><option value="ALL">All trace points</option>{['MAIN_VIEWPORT','IK_VIEWPORT','SCENE_TREE','RENDER_RUNTIME','APP_EXCEPTION','USER_INTERACTION','RUNTIME_SYSTEM'].map(point => <option key={point} value={point}>{point}</option>)}</select></label>
                <label>Object ID<input value={logcatObjectFilter} onChange={event => setLogcatObjectFilter(event.target.value)} placeholder="Object ID"/></label>
                <label>Session ID<input value={logcatSessionFilter} onChange={event => setLogcatSessionFilter(event.target.value)} placeholder="Session ID"/></label>
                <label>From<input type="datetime-local" value={logcatFromFilter} onChange={event => setLogcatFromFilter(event.target.value)}/></label>
                <label>To<input type="datetime-local" value={logcatToFilter} onChange={event => setLogcatToFilter(event.target.value)}/></label>
                <label className="rds-logcat-regex"><input type="checkbox" checked={logcatRegex} onChange={event => setLogcatRegex(event.target.checked)}/> Regex search</label></div>
              </details>
              <div className="rds-command-log-list">{visibleLogcatEntries.slice().reverse().map(entry => <article className={'diagnostic-entry diagnostic-' + entry.level.toLowerCase()} key={entry.id}>
                <div><strong>{entry.level}</strong><time>{entry.timestampISO || entry.time}</time></div>
                <b>{entry.componentTag || entry.source}</b><small>{entry.tracePoint || 'UNKNOWN_TRACE_POINT'}{entry.objectId ? ' · ' + entry.objectId : ''}</small>
                <p>{entry.message}</p>{entry.details && <pre>{entry.details}</pre>}
              </article>)}{!visibleLogcatEntries.length && <div className="diagnostic-empty">No LogCat events match these filters.</div>}</div>
            </>}
            {rdsActiveTool === 'RIT Trace' && <>
              <div className="rds-summary-strip" aria-label="Realtime Interaction Trace"><span>Session {RUNTIME_SESSION_ID}</span><span>{getRitTraceEntries().length} events</span></div>
              <div className="rds-command-log-list">{getRitTraceEntries().slice().reverse().map(entry => <article className="diagnostic-entry diagnostic-info" key={entry.id}>
                <div><strong>{entry.origin || 'UNKNOWN'}</strong><time>{entry.time}</time></div><small className="rit-event-meta">{entry.sessionId === RUNTIME_SESSION_ID ? 'CURRENT SESSION' : entry.sessionId ? 'PREVIOUS SESSION' : 'LEGACY'} · SEQ {entry.sequence ?? '—'}</small>
                <p>{entry.message}</p>{entry.details && <pre>{entry.details}</pre>}
              </article>)}{!getRitTraceEntries().length && <div className="diagnostic-empty">No interaction events captured yet.</div>}</div>
              <div className="rds-quick-actions"><button type="button" onClick={() => clearInteractionTraceLogs()} disabled={!getRitTraceEntries().length} aria-label="Clear all RIT logs"><Trash2 size={14}/>Clear Trace</button><button type="button" onClick={() => void copyDiagnosticText(getRitTraceEntries())} aria-label="Copy all RIT logs"><Copy size={14}/>Copy Trace</button></div>
            </>}
            {rdsActiveTool === 'DFI Core' && <><div className="rds-summary-strip"><span>{dfiSummary.findings} findings</span><span>{dfiSummary.errors} errors</span><span>{dfiSummary.warnings} warnings</span></div><div className="rds-quick-actions"><button type="button" onClick={() => void runDfiInvestigation()} disabled={dfiBusy}><ScanEye size={15}/>{dfiBusy ? 'Investigating…' : 'Run Deep Analysis'}</button><button type="button" onClick={() => void copyDiagnosticText([{id:'dfi-report',time:new Date().toLocaleTimeString(),level:dfiSummary.errors?'ERROR':dfiSummary.warnings?'WARN':'INFO',source:'DFI Core',message:'Forensic investigation report',details:dfiReport}])}><Copy size={14}/>Copy Report</button></div><pre className="rds-command-report">{dfiReport}</pre></>}
            {rdsActiveTool === 'Mesh DFI' && <><div className="rds-quick-actions"><button type="button" onClick={() => runDfiToolScan('Shape Core')} disabled={Boolean(dfiToolBusy)}><Box size={15}/>{dfiToolBusy ? 'Scanning…' : 'Scan Mesh Integrity'}</button></div><pre className="rds-command-report">{dfiToolReports['Shape Core'] || 'Mesh integrity scan has not been run yet.'}</pre></>}
            {rdsActiveTool === 'Root Cause' && <><div className="rds-info-card"><strong>Evidence-based investigation</strong><p>Correlates captured runtime events, DFI findings and source audit evidence. A suspected cause is not confirmed until the first failing state transition is reproduced.</p></div><div className="rds-quick-actions"><button type="button" onClick={() => void runDfiInvestigation()} disabled={dfiBusy}><GitMerge size={15}/>{dfiBusy ? 'Investigating…' : 'Correlate Evidence'}</button></div><pre className="rds-command-report">{dfiReport}</pre></>}
            {rdsActiveTool === 'Source Audit' && <><div className="rds-quick-actions"><button type="button" onClick={() => void loadRdsSourceAudit()}><Code2 size={15}/>Load Source Audit</button></div><pre className="rds-command-report">{rdsSourceAuditReport}</pre></>}
            {rdsActiveTool === 'Reports' && <><div className="rds-quick-actions"><button type="button" onClick={copyAllDfiReport}><Copy size={15}/>Copy All Report</button><button type="button" onClick={copyAllDfiSummary}><ClipboardCopy size={15}/>Copy Scene Summary</button><button type="button" onClick={() => void copyDiagnosticText([{id:'rds-report',time:rdsLastScanAt || new Date().toLocaleTimeString(),level:rdsScanSummary.errors?'ERROR':rdsScanSummary.warnings?'WARN':'INFO',source:'RDS Full Core Scan',message:'Full scan report',details:rdsScanReport + '\n\n' + rdsSourceAuditReport}])}><FileText size={15}/>Copy RDS Report</button></div><pre className="rds-command-report">{rdsScanReport}{'\n\n'}{rdsSourceAuditReport}</pre></>}
          </main>
        </div>
        <button type="button" className="rds-resize-handle rds-resize-horizontal" aria-label="Resize RDS Panel width" title="Drag left or right to resize RDS Panel width" onPointerDown={event => beginRdsPanelResize(event, 'width')}><span/></button>
      </aside>}
      {rdsPanelOpen && !cameraView && !animationMode && <button type="button" className="rds-bottom-slider" aria-label="Resize RDS Panel height" title="Drag up to increase panel height and down to reduce it" style={{ left: window.innerWidth - (window.innerWidth <= 570 ? 5 : 9) - (rdsPanelWidth / 2), top: (window.innerWidth <= 570 ? 55 : 58) + rdsPanelHeight - 15 }} onPointerDown={event => beginRdsPanelResize(event, 'height')}><span/><span className="rds-bottom-slider-grip"/></button>}

      {geometryRitOpen && !cameraView && !animationMode && <aside className="geometry-rit-panel" role="dialog" aria-label="Independent Geometry RIT Results Report">
        <div className="geometry-rit-heading">
          <div><ScanSearch size={15}/><strong>GEOMETRY RIT</strong><small>INDEPENDENT DIAGNOSTIC</small></div>
          <button type="button" onClick={() => setGeometryRitOpen(false)} aria-label="Close Geometry RIT panel"><X size={14}/></button>
        </div>
        <div className="geometry-rit-summary">
          <span className={'geometry-rit-status status-' + geometryRitSummary.status.toLowerCase().replace(/\s+/g, '-')}>{geometryRitSummary.status}</span>
          <span>{geometryRitSummary.meshes} meshes</span>
          <span>{geometryRitSummary.triangles.toLocaleString()} triangles</span>
          <span>{geometryRitSummary.errors} errors · {geometryRitSummary.warnings} warnings</span>
        </div>
        <div className="geometry-rit-actions">
          <button type="button" onClick={runGeometryRitScan} disabled={geometryRitBusy}><ScanSearch size={13}/>{geometryRitBusy ? 'SCANNING…' : 'SCAN GEOMETRY'}</button>
          <button type="button" onClick={copyGeometryRitReport} disabled={geometryRitSummary.status === 'NOT SCANNED'}><ClipboardCopy size={13}/>COPY REPORT</button>
        </div>
        <pre className="geometry-rit-report">{geometryRitReport}</pre>
        <div className="geometry-rit-note">READ-ONLY · No automatic repair. REVIEW findings may include intentional hard edges. Perimeter deformation requires an operation-specific baseline before it can be confirmed.</div>
      </aside>}

      {skyboxOpen && !cameraView && !animationMode && <aside className="skybox-panel" aria-label="Skybox Environment Settings"><div className="skybox-heading"><strong><Globe size={13}/> SKYBOX / ENVIRONMENT</strong><button type="button" aria-label="Close Skybox panel" onClick={() => setSkyboxOpen(false)}><X size={13}/></button></div><nav className="skybox-categories" aria-label="Skybox categories">{[{name:'Time-of-Day Presets',icon:<Sun size={12}/>},{name:'Skybox Type',icon:<Globe size={12}/>},{name:'Atmosphere & Sun',icon:<Aperture size={12}/>},{name:'Clouds & Fog',icon:<CloudFog size={12}/>}].map(category => <button key={category.name} type="button" className={skyboxCategory === category.name ? 'active' : ''} onClick={() => setSkyboxCategory(skyboxCategory === category.name ? '' : category.name)}>{category.icon}<span>{category.name}</span></button>)}</nav>{skyboxCategory && <div className="skybox-body"><strong className="skybox-subtitle">{skyboxCategory}</strong>{skyboxCategory === 'Time-of-Day Presets' && <><div className="skybox-preset-grid">{['Morning','Noon','Afternoon','Night'].map(preset => <button type="button" key={preset} onClick={() => { runtime.current?.applyPreset(preset); setStatus(preset + ' environment preset applied to scene lighting and sky'); }}>{preset}</button>)}</div><p>Presets update sky color and available ambient/directional lights. Add lights from the LIGHTS dock for full lighting changes.</p></>}{skyboxCategory === 'Skybox Type' && <><label>Background Type<select value={skyboxType} onChange={e => { const type = e.target.value as typeof skyboxType; setSkyboxType(type); const scene = runtime.current?.scene; if (scene && type === 'Solid Color') scene.background = new THREE.Color(skyColorBottom); if (scene && type === 'Procedural Gradient') scene.background = new THREE.Color(skyColorTop); setStatus(type + ' selected'); }}><option>Procedural Gradient</option><option>Solid Color</option><option>HDRI Equirectangular</option></select></label><label>Sky Color<input type="color" value={skyColorTop} onChange={e => { setSkyColorTop(e.target.value); if (skyboxType !== 'HDRI Equirectangular' && runtime.current?.scene) runtime.current.scene.background = new THREE.Color(e.target.value); }}/></label><label>Horizon / Solid Color<input type="color" value={skyColorBottom} onChange={e => { setSkyColorBottom(e.target.value); if (skyboxType === 'Solid Color' && runtime.current?.scene) runtime.current.scene.background = new THREE.Color(e.target.value); }}/></label>{skyboxType === 'HDRI Equirectangular' && <label className="upload-control"><Upload size={12}/><span>Load HDR / RGBE Environment</span><input type="file" accept=".hdr,.rgbe" onChange={e => handleTextureUpload(e,true)}/></label>}<p>HDRI loads an equirectangular environment map; the color modes set the scene background.</p></>}{skyboxCategory === 'Atmosphere & Sun' && <><label>Sun Azimuth <output>{sunAzimuth}°</output><input type="range" min="0" max="360" value={sunAzimuth} onChange={e => { const value = Number(e.target.value); setSunAzimuth(value); runtime.current?.lightSources?.filter((light: any) => light.type === 'DirectionalLight' || light.type === 'SpotLight').forEach((light: any) => { light.object.position.x = Math.cos(THREE.MathUtils.degToRad(value)) * 10; light.object.position.z = Math.sin(THREE.MathUtils.degToRad(value)) * 10; }); }}/></label><label>Sun Elevation <output>{sunElevation}°</output><input type="range" min="-5" max="90" value={sunElevation} onChange={e => { const value = Number(e.target.value); setSunElevation(value); runtime.current?.lightSources?.filter((light: any) => light.type === 'DirectionalLight' || light.type === 'SpotLight').forEach((light: any) => { light.object.position.y = Math.sin(THREE.MathUtils.degToRad(value)) * 10; }); }}/></label><label>Light Intensity <output>{sunIntensity.toFixed(1)}</output><input type="range" min="0" max="8" step="0.1" value={sunIntensity} onChange={e => { const value = Number(e.target.value); setSunIntensity(value); runtime.current?.lightSources?.filter((light: any) => light.type === 'DirectionalLight' || light.type === 'SpotLight').forEach((light: any) => { light.object.intensity = value; }); }}/></label><label>Sky Tint<input type="color" value={skyColorTop} onChange={e => { setSkyColorTop(e.target.value); if (runtime.current?.scene && skyboxType !== 'HDRI Equirectangular') runtime.current.scene.background = new THREE.Color(e.target.value); }}/></label><p>Sun controls adjust existing directional and spot lights; create a light in LIGHTS to add a sun source.</p></>}{skyboxCategory === 'Clouds & Fog' && <><label>Cloud Density <output>{cloudDensity.toFixed(2)}</output><input type="range" min="0" max="1" step="0.01" value={cloudDensity} onChange={e => setCloudDensity(Number(e.target.value))}/></label><label>Fog Density <output>{Number(settings.fogDensity).toFixed(2)}</output><input type="range" min="0" max="1" step="0.01" value={Number(settings.fogDensity)} onChange={e => setEditorSetting('fogDensity', Number(e.target.value))}/></label><label>Fog Color<input type="color" value={String(settings.fogColor)} onChange={e => setEditorSetting('fogColor', e.target.value)}/></label><p>Fog density and tint affect the scene; cloud density is a stored environment preference and does not generate volumetric cloud geometry.</p></>}</div>}</aside>}
      
      {meshToolsOpen && selected && !cameraView && runtime.current?.selectable.some((o: THREE.Object3D) => String(o.userData.editorId) === selected && o instanceof THREE.Mesh) && <section className={'mesh-edit-panel nexus-modeling-workspace ' + (editMode === 'Face' ? 'face-edit-active' : '')} aria-label="Nexus3D Modeling Workspace" role="dialog"><div className="edit-workspace-heading"><div className="edit-workspace-brand"><span className="edit-workspace-mark">N</span><div><strong>MODELING WORKSPACE</strong><small>LIVE MESH EDITOR</small></div></div><span className="edit-workspace-live"><i/> LIVE</span></div><div className="edit-workspace-target"><span>ACTIVE OBJECT</span><strong>{runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected)?.name || 'Selected Mesh'}</strong><small>{editMode === 'Object' ? 'Object-level editing' : editMode + ' component editing'} · changes apply to viewport</small></div><div className="edit-workspace-section-label">EDIT MODE</div><div className="shape-edit-modes">{(['Object', 'Face'] as const).map(level => <button key={level} className={editMode === level ? 'active' : ''} onClick={() => { editModeRef.current = level; setEditMode(level); const tr = runtime.current?.transform; const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selectedRef.current); if (tr) { if (level === 'Object') { tr.detach(); if (target) tr.attach(target); tr.setMode(mode); tr.setSpace(space); tr.enabled = Boolean(target); tr.getHelper().visible = Boolean(target); } else { tr.detach(); tr.enabled = false; tr.getHelper().visible = false; } } if (level === 'Object') { runtime.current?.clearSubSelection?.(); const group = runtime.current?.subObjectHighlight as THREE.Group | undefined; if (group) { while (group.children.length) { const child = group.children[0]; group.remove(child); child.traverse((node: any) => { node.geometry?.dispose?.(); if (node.material?.dispose) node.material.dispose(); }); } } } else if (target instanceof THREE.Mesh) { runtime.current?.clearSubSelection?.(); runtime.current?.refreshTopologyOverlay?.(target); } if (level === 'Face') setFaceSelectionMode('Face'); setStatus(level === 'Object' ? 'Object transform enabled' : 'Face Mode · choose Face, Vertex, or Edge selection'); }} title={level + ' editing mode'}>{level === 'Face' ? <Layers size={13}/> : <Move size={13}/>}<span>{level}</span></button>)}</div>{editMode === 'Face' && <div className="face-selection-tools" role="group" aria-label="Face Mode selection tools"><div className="edit-workspace-section-label">FACE SELECTION</div><div className="shape-edit-modes face-selection-mode-buttons">{(['Face', 'Vertex', 'Edge'] as const).map(tool => <button key={tool} type="button" className={faceSelectionTool === tool ? 'active' : ''} onClick={() => { setFaceSelectionMode(tool); runtime.current?.clearSubSelection?.(); if (tool === 'Face') setStatus('Face Selection active · Face Lock and Dual Face Lock enabled'); else { runtime.current?.clearAllSubObjectLocks?.(); setStatus(tool + ' Selection active · drag to select visible ' + tool.toLowerCase() + ' components'); } }} title={tool + ' selection subtool'}>{tool === 'Face' ? <Layers size={13}/> : tool === 'Vertex' ? <Target size={13}/> : <GitBranch size={13}/>}<span>{tool}</span></button>)}</div>{(faceSelectionTool === 'Vertex' || faceSelectionTool === 'Edge') && <div className="shape-edit-actions" aria-label="Sub-object selection controls"><button type="button" onClick={() => { runtime.current?.clearAllSubObjectLocks?.(); setStatus('Clear Locks · all Vertex and Edge selections released'); recordInteractionTrace('Sub-object locks cleared', { objectId: selectedRef.current, selectionTool: faceSelectionToolRef.current }); }} title="Clear all locked Vertex and Edge selections"><X size={13}/><span>Clear Locks</span></button><small>Drag across the viewport to add visible {faceSelectionTool} selections</small></div>}</div>}{editMode === 'Face' && <><div className="edit-workspace-section-label edit-operations-label">FACE OPERATIONS</div><div className="shape-edit-actions" aria-label="Face editing actions"><button type="button" className={smoothSelectAllId === selected && Boolean(selected) ? 'active' : ''} disabled={!selected || !(runtime.current?.selectable.some((o: THREE.Object3D) => String(o.userData.editorId) === selected && o instanceof THREE.Mesh))} onClick={() => { const target = runtime.current?.selectable.find((o: THREE.Object3D) => String(o.userData.editorId) === selected); if (!(target instanceof THREE.Mesh)) { setSmoothSelectAllId(''); setStatus('Select a mesh Object before Select All'); return; } const count = target.geometry.getAttribute('position')?.count || 0; if (!count) { setSmoothSelectAllId(''); setStatus('Select All found no geometry vertices'); return; } runtime.current?.setActiveSubSelection?.({ mesh: target, indices: Array.from({ length: count }, (_value, index) => index) }); setSmoothSelectAllId(String(target.userData.editorId)); setStatus('Select All · entire shape geometry selected for Smooth'); recordInteractionTrace('Smooth Select All activated', { objectId: target.userData.editorId, objectName: target.name, vertexCount: count }); }} title="Select all geometry vertices for Smooth"><Check size={13}/><span>Select All</span></button>{(['Extrude', 'Subdivide', 'Smooth', 'Loop Cut', 'Faces Cut'] as const).map(tool => <button key={tool} disabled={(tool === 'Extrude' && (runtime.current?.getActiveSubSelection?.()?.faceParts?.length || 0) < 1) || (tool === 'Smooth' && smoothSelectAllId !== selected)} className={activeEditTool === (tool === 'Loop Cut' ? 'Cutting' : tool) ? 'active' : ''} onClick={() => { if (tool === 'Smooth' && smoothSelectAllId !== selected) { setStatus('Tap Select All before Smooth'); return; } if (tool === 'Faces Cut') {
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

      

      {!panel && !cameraView && !riggingView && <button className={'floating-menu-toggle ' + (menuOpen ? 'active' : '')} id="btn-menu-panel" onClick={() => { const opening = !menuOpen; setMenuOpen(opening); if (opening) { setQuickPanel(null); setInspectorOpen(false); setShapeLibraryOpen(false); setMeshToolsOpen(false); } }} title={menuOpen ? 'Close Menu Panel' : 'Open Menu Panel'}><span className="menu-glyph">☰</span><span>MENU</span></button>}

      {menuOpen && !panel && !cameraView && !riggingView && <aside className="menu-panel menu-mother-panel" style={{ "--nexus-panel-width": menuPanelWidth + "px", "--nexus-panel-height": menuPanelHeight + "px" } as React.CSSProperties}>
        <div className="panel-vertical-box menu-panel-vertical-box">
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
                          <div className="menu-info"><Info size={12}/><span>Session {RUNTIME_SESSION_ID} · started {RUNTIME_SESSION_STARTED_AT} · copied reports identify current, previous, and legacy events.</span></div>
                          <div className="diagnostic-actions rds-rit-actions rds-icon-actions" aria-label="RIT actions">
                            <button type="button" aria-label="Copy all RIT logs" title="Copy all RIT logs" onClick={() => void copyDiagnosticText([...diagnosticLogs.filter(entry => entry.source === 'Interaction Trace'), ...diagnosticQueueRef.current.filter(entry => entry.source === 'Interaction Trace')])} disabled={!diagnosticLogs.some(entry => entry.source === 'Interaction Trace') && !diagnosticQueueRef.current.some(entry => entry.source === 'Interaction Trace')}><ClipboardCopy size={15}/></button>
                            <button type="button" aria-label="Clear all RIT logs" title="Clear all RIT logs" onClick={clearInteractionTraceLogs} disabled={!diagnosticLogs.some(entry => entry.source === 'Interaction Trace') && !diagnosticQueueRef.current.some(entry => entry.source === 'Interaction Trace')}><Trash2 size={15}/></button>
                          </div>
                          <div className="diagnostic-log-list" role="log" aria-live="polite" aria-label="Nexus3D interaction trace">
                            {!diagnosticLogs.some(entry => entry.source === 'Interaction Trace') && <div className="diagnostic-empty">No interaction events captured yet. Tap the viewport, Scene Tree, or a modeling tool to begin tracing.</div>}
                            {diagnosticLogs.filter(entry => entry.source === 'Interaction Trace').slice(-120).reverse().map(entry => <article className={'diagnostic-entry diagnostic-' + entry.level.toLowerCase()} key={entry.id}>
                              <div><strong>{entry.level}</strong><time>{entry.time}</time></div>
                              <small className="rit-event-meta">{entry.sessionId === RUNTIME_SESSION_ID ? 'CURRENT' : entry.sessionId ? 'PREVIOUS' : 'LEGACY'} · {entry.origin || 'UNKNOWN ORIGIN'} · SEQ {entry.sequence ?? '—'}</small>
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
            <div className="menu-subtitle">ADVANCED FORENSIC TOOLS · READ-ONLY</div>
            <div className="diagnostic-actions dfi-tool-grid" aria-label="Advanced DFI clickable tools">
              {[
                ['Shape Core','box'],['Gizmo Control','move'],['Face Tools','scan-eye'],
                ['Edge Tools','git-branch'],['Vertex Tools','crosshair'],['Extrude & Scale','scaling'],
                ['Subdivide + Rotate','rotate-3d'],['Post-Smooth','waves'],['Overlap Scan','layers']
              ].map(([tool, icon]) => <button key={tool} type="button" className="dfi-tool-button" title={'Scan ' + tool} aria-label={'Scan ' + tool} onClick={() => runDfiToolScan(tool)} disabled={Boolean(dfiToolBusy)}>
                {tool === 'Shape Core' ? <Box size={14}/> : tool === 'Gizmo Control' ? <Move size={14}/> : tool === 'Face Tools' ? <ScanEye size={14}/> : tool === 'Edge Tools' ? <GitBranch size={14}/> : tool === 'Vertex Tools' ? <Target size={14}/> : tool === 'Extrude & Scale' ? <Scaling size={14}/> : tool === 'Subdivide + Rotate' ? <Rotate3D size={14}/> : tool === 'Post-Smooth' ? <Waves size={14}/> : <Layers size={14}/>}
                <span>{dfiToolBusy === tool ? 'SCANNING…' : tool}</span>
              </button>)}
            </div>
            <div className="diagnostic-actions dfi-actions dfi-report-copy-actions">
              <button type="button" onClick={copyAllDfiReport} title="Copy complete details: all Advanced DFI, RDS, tool and runtime evidence"><Copy size={13}/> COPY ALL REPORT</button>
              <button type="button" onClick={copyAllDfiSummary} title="Copy concise summary grouped by diagnostic ID"><ClipboardCopy size={13}/> COPY SUMMARY REPORT</button>
            </div>
            {dfiToolSections.map(section => {
              const tool = section.name;
              const report = dfiToolReports[tool] || 'NOT SCANNED — run this tool to collect evidence.';
              return <details className="dfi-tool-result" key={tool}>
              <summary><span className="dfi-result-title">ID No.{section.id} · {tool} · REPORT RESULTS</span><button type="button" className="dfi-summary-copy-icon" title={'Copy ID No.' + section.id + ' summary'} aria-label={'Copy ID No.' + section.id + ' summary'} onClick={event => { event.preventDefault(); event.stopPropagation(); copyDfiToolSummary(section.id, tool); }}><ClipboardCopy size={14}/></button></summary>
              <div className="core-optimizer-report dfi-report dfi-highlight-report">{report.split('\n').map((line, index) => {
                const tag = /\b(CRASH|FATAL)\b/i.test(line) ? 'crash' : /\b(CONFLICT)\b/i.test(line) ? 'conflict' : /\b(ERROR|BUG|DUPLICATE|NON_MANIFOLD)\b/i.test(line) ? 'error' : /\b(WARN|WARNING|SUSPECTED)\b/i.test(line) ? 'warning' : '';
                return <div key={index} className={tag ? 'dfi-report-line dfi-' + tag : 'dfi-report-line'}>{line || ' '}</div>;
              })}</div>
            </details>;
            })}

            <div className="diagnostic-summary"><span>{dfiSummary.findings} finding(s)</span><span>{dfiSummary.errors} error(s)</span><span>{dfiSummary.warnings} warning(s)</span></div>
            <div className="diagnostic-summary"><span>{dfiSummary.repeatedErrors} repeated signature(s)</span><span>{dfiSummary.invalidMeshes} integrity finding(s)</span></div>
            <div className="diagnostic-actions dfi-actions">
              <button type="button" onClick={() => void runDfiInvestigation()} disabled={dfiBusy}><ScanEye size={12}/> {dfiBusy ? 'INVESTIGATING…' : 'RUN DEEP ANALYSIS'}</button>
              <button type="button" onClick={() => void copyDiagnosticText([{ id: 'dfi-report', time: new Date().toLocaleTimeString(), level: dfiSummary.errors ? 'ERROR' : dfiSummary.warnings ? 'WARN' : 'INFO', source: 'DFI Core', message: 'Forensic investigation report', details: dfiReport }])} disabled={dfiReport.startsWith('No DFI investigation')}><ClipboardCopy size={12}/> COPY REPORT</button>
              <button type="button" onClick={() => { setDfiReport('No DFI investigation has been run yet.'); setDfiSummary({ findings: 0, errors: 0, warnings: 0, repeatedErrors: 0, invalidMeshes: 0 }); }}><RefreshCw size={12}/> RESET</button>
            </div>
            <div className="core-optimizer-report dfi-report dfi-highlight-report">{dfiReport.split('\n').map((line, index) => {
              const tag = /\b(CRASH|FATAL)\b/i.test(line) ? 'crash' : /\b(CONFLICT)\b/i.test(line) ? 'conflict' : /\b(ERROR|BUG|DUPLICATE|NON_MANIFOLD)\b/i.test(line) ? 'error' : /\b(WARN|WARNING|SUSPECTED)\b/i.test(line) ? 'warning' : '';
              return <div key={index} className={tag ? 'dfi-report-line dfi-' + tag : 'dfi-report-line'}>{line || ' '}</div>;
            })}</div>
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
              {saveAccordionOpen && <div className="project-save-inline"><label htmlFor="nexus-project-name">Project Name</label><input id="nexus-project-name" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Project.nexus" /><button className="menu-option save-inline-action" onClick={saveProject} disabled={isSavingProject}><Save size={12}/><span>{isSavingProject ? "[ SAVING... ]" : "[ SAVE ]"}</span></button></div>}
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
              {!Capacitor.isNativePlatform() && <button className="menu-option" onClick={() => { setShowInstall(true); setMenuOpen(false); }}><Download size={13} /><span>Install Nexus3D</span></button>}
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
        </div>
        <button type="button" className="panel-resize-handle panel-resize-handle-horizontal" aria-label="Resize Menu Panel width" title="Drag left or right to resize Menu Panel width" onPointerDown={event => beginPanelResize(event, 'menu', 'width')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12 7 8 M3 12 7 16 M3 12H21 M21 12 17 8 M21 12 17 16" /></svg></button>
        <button type="button" className="panel-resize-handle panel-resize-handle-vertical" aria-label="Resize Menu Panel height" title="Drag up or down to resize Menu Panel height" onPointerDown={event => beginPanelResize(event, 'menu', 'height')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 8 7 M12 3 16 7 M12 3V21 M12 21 8 17 M12 21 16 17" /></svg></button>
      </aside>}

      {panel && !cameraView && <aside className="hierarchy-panel scene-tree-mother-panel" style={{ "--nexus-panel-width": treePanelWidth + "px", "--nexus-panel-height": treePanelHeight + "px" } as React.CSSProperties}>
        <div className="panel-vertical-box scene-tree-vertical-box">
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
        </div>
        <button type="button" className="panel-resize-handle panel-resize-handle-horizontal" aria-label="Resize Scene Tree width" title="Drag left or right to resize Scene Tree width" onPointerDown={event => beginPanelResize(event, 'tree', 'width')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12 7 8 M3 12 7 16 M3 12H21 M21 12 17 8 M21 12 17 16" /></svg></button>
        <button type="button" className="panel-resize-handle panel-resize-handle-vertical" aria-label="Resize Scene Tree height" title="Drag up or down to resize Scene Tree height" onPointerDown={event => beginPanelResize(event, 'tree', 'height')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 8 7 M12 3 16 7 M12 3V21 M12 21 8 17 M12 21 16 17" /></svg></button>
      </aside>}





      <div className="right-rail">
        <button className={'rail-btn ' + (cameraView ? 'active' : '')} onClick={toggleCamera} title={cameraView ? 'Return to User View' : 'Directly view through MainCamera'}><Camera size={17} /><span>{cameraView ? 'USER' : 'CAM'}</span></button>
        
        <button className={'rail-btn rig-rail-btn ' + (riggingView ? 'active' : '')} onClick={toggleRiggingWorkspace} title={riggingView ? 'Return to User Workspace' : 'Switch to IK Rigging Workspace · Front Perspective'} aria-label="Rigging workspace"><GitBranch size={17}/><span>{riggingView ? 'USER' : 'RIG'}</span></button>
        <button className={'rail-btn animation-rail-btn ' + (animationMode ? 'active' : '')} onClick={toggleAnimationWorkspace} title="Open Animation Workspace" aria-label="Open Animation Workspace"><Film size={17}/><span>ANIM</span></button>
      </div>

      

      
      

      

      {animationMode && <>
        <div className="animation-panel-switcher" role="group" aria-label="Animation floating panels">
          <button type="button" className={animationDock==='scene'?'active':''} onClick={()=>setAnimationDock(value=>value==='scene'?null:'scene')} aria-label="Toggle Scene List" aria-expanded={animationDock==='scene'} title="Scene List"><Layers size={14}/></button>
          <button type="button" className={animationDock==='transform'?'active':''} onClick={()=>setAnimationDock(value=>value==='transform'?null:'transform')} aria-label="Toggle Transform Inspector" aria-expanded={animationDock==='transform'} title="Transform Inspector"><SlidersHorizontal size={14}/></button>
        </div>
        {animationDock==='scene' && <aside className="animation-scene-list animation-floating-panel" aria-label="Animation Scene List">
          <div className="animation-dock-heading"><strong><Layers size={12}/> SC LIST</strong><span>{items.length}</span><button type="button" onClick={()=>setAnimationDock(null)} aria-label="Close Scene List"><X size={12}/></button></div>
          <div className="animation-scene-items">{items.filter(item=>item.kind!=='IK Target'&&item.kind!=='IK Pole').map(item=><button type="button" key={item.id} className={selected===item.id?'active':''} onClick={()=>{setSelected(item.id);runtime.current?.selectObject?.(item.object);}} title={'Select '+item.name}>{item.name}</button>)}</div>
        </aside>}
        {animationDock==='transform' && <aside className="animation-transform-inspector animation-floating-panel" aria-label="Animation Transform Inspector">
          <div className="animation-dock-heading"><strong><SlidersHorizontal size={12}/> TRANSFORM</strong><button type="button" onClick={()=>setAnimationDock(null)} aria-label="Close Transform Inspector"><X size={12}/></button></div>
          {!selected && <div className="animation-dock-empty">Select an object.</div>}
          {(['position','rotation','scale'] as const).map(group=><div className="animation-transform-group" key={group}><strong>{group.toUpperCase()}</strong>{(['x','y','z'] as const).map(axis=>{const object=items.find(item=>item.id===selected)?.object;const value=object?(group==='position'?object.position[axis]:group==='rotation'?THREE.MathUtils.radToDeg(object.rotation[axis]):object.scale[axis]):0;const keyed=Boolean(keyframes[selected]?.[frame]);return <label key={axis}><span>{axis.toUpperCase()} <button type="button" className={keyed?'keyed':''} onClick={()=>captureRef.current()} disabled={!object} title={keyed?'Keyframe exists at current frame':'Add keyframe at current frame'}>{keyed?'◆':'◇'}</button></span><BufferedNumberInput ariaLabel={'Animation '+group+' '+axis.toUpperCase()} value={Number(value.toFixed(3))} disabled={!object} onCommit={next=>{if(!object||!Number.isFinite(next))return;if(group==='position')object.position[axis]=next;else if(group==='rotation')object.rotation[axis]=THREE.MathUtils.degToRad(next);else object.scale[axis]=next;object.updateMatrixWorld(true);setItems(prev=>[...prev]);if(autoKeyRef.current)captureRef.current();}}/></label>;})}</div>)}
        </aside>}
        <div className="animation-gizmo-tools animation-floating-gizmo" aria-label="Animation Gizmo tools"><button type="button" className={mode==='translate'?'active':''} onClick={()=>runMode('translate')} title="Move Gizmo"><Move size={13}/></button><button type="button" className={mode==='rotate'?'active':''} onClick={()=>runMode('rotate')} title="Rotate Gizmo"><Rotate3D size={13}/></button><button type="button" className={mode==='scale'?'active':''} onClick={()=>runMode('scale')} title="Scale Gizmo"><Scaling size={13}/></button><button type="button" onClick={setAxisSpace} title="Toggle World / Local axes"><Globe size={13}/><span>{space.toUpperCase()}</span></button></div>
      </>}
      {animationMode && <div className="animation-mode-controls" aria-label="Animation workspace controls"><button type="button" onClick={toggleAnimationWorkspace} title="Exit Animation and return to User View" aria-label="Exit Animation"><X size={16}/></button><button type="button" className={animOpen ? 'active' : ''} onClick={() => setAnimOpen(value => !value)} title={animOpen ? 'Hide Timeline' : 'Show Timeline'} aria-label="Toggle Animation Timeline"><Film size={15}/><span>TIME</span></button></div>}
      {animationMode && animOpen && <section className="timeline-panel" aria-label="Animation Timeline">
        <div className="timeline-heading"><strong><Film size={13}/> ANIMATION TIMELINE</strong><span>F {String(frame).padStart(3, '0')} · {(frame / Math.max(1, frameRate)).toFixed(2)}s</span><div className="timeline-heading-actions"><button type="button" onClick={() => setAnimOpen(false)} aria-label="Hide timeline"><X size={13}/></button></div></div>
         <div className="animation-state-layout">
           <aside className="timeline-playback-panel" aria-label="Playback controls">
             <div className="timeline-transport">
             <button type="button" title="Go to start" onClick={() => { setPlaying(false); setCurrentFrame(workStart); }}><Rewind size={13}/></button>
             <button type="button" title="Previous keyframe" onClick={() => { const frames = Object.keys(keyframes[selected] || {}).map(Number).filter(value => value < frame).sort((x,y) => y-x); if (frames.length) setCurrentFrame(frames[0]); }}><ChevronDown size={13}/></button>
             <button type="button" className="timeline-play" title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
             <button type="button" title="Stop" onClick={() => { setPlaying(false); setCurrentFrame(workStart); }}><span className="timeline-stop-square"/></button>
             <button type="button" title="Next keyframe" onClick={() => { const frames = Object.keys(keyframes[selected] || {}).map(Number).filter(value => value > frame).sort((x,y) => x-y); if (frames.length) setCurrentFrame(frames[0]); }}><ChevronRight size={13}/></button>
             
             </div>
           </aside>
           <div className="timeline-editor-stack">
             <div className="timeline-tools-panel" aria-label="Timeline tools">
               <div className="timeline-tool-row"><button type="button" className={timelineTool==='tracks'?'active':''} onClick={()=>setTimelineTool('tracks')}>OBJECT TRACKS</button><button type="button" className={timelineTool==='dope'?'active':''} onClick={()=>setTimelineTool('dope')}>DOPE SHEET</button><button type="button" className={"timeline-add-keyframe" + (selected && Object.prototype.hasOwnProperty.call(keyframes[selected] || {}, frame) ? " has-current-keyframe" : "")} onClick={()=>captureRef.current()} disabled={!selected} title="Add Keyframe at current frame" aria-label="Add Keyframe"><span aria-hidden="true">◆</span></button><button type="button" className={timelineTool==='graph'?'active':''} onClick={()=>setTimelineTool('graph')}>GRAPH</button><button type="button" onClick={undo} title="Undo last scene or keyframe edit">UNDO</button><button type="button" onClick={redo} title="Redo last scene or keyframe edit">REDO</button><button type="button" onClick={copyFrame} title="Copy all keyed object poses at current frame">COPY</button><button type="button" onClick={pasteFrame} title="Paste copied object poses at current frame" disabled={!copiedFrame}>PASTE</button><button type="button" onClick={()=>{setCurrentFrame(workStart);timelineScrollRef.current?.scrollTo({left:0,behavior:'smooth'});}} title="Fit the full timeline from its start">FIT</button><button type="button" className={showGhostPreview?'active':''} onClick={()=>setShowGhostPreview(v=>!v)} title="Show previous and next 3D poses">GHOST</button><button type="button" onClick={()=>{const label=window.prompt('Marker label','Marker');if(label?.trim())setTimelineMarkers(prev=>[...prev,{id:'marker-'+Date.now(),frame,label:label.trim()}]);}} title="Add a marker at the current frame">MARKER＋</button><button type="button" className={autoKey ? 'record-active timeline-record-toggle' : 'timeline-record-toggle'} title="Toggle Auto Key recording" aria-label="Toggle Auto Key recording" onClick={() => setAutoKey(value => !value)}><span className="record-dot"/> REC</button><label className="timeline-loop timeline-loop-toggle"><input type="checkbox" checked={loopPlayback} onChange={event => setLoopPlayback(event.target.checked)}/> LOOP</label><button type="button" className="timeline-delete-state" onClick={deleteAlphabetState} disabled={!activeSequenceState} title="Delete selected Alphabet State and all keyframes in its range" aria-label="Delete selected Alphabet State"><Trash2 size={13}/></button></div>
             </div>
             <section className="alphabet-state-panel" aria-label="Alphabet State Panel">
               <div className="timeline-custom-range-controls" aria-label="Custom Keyframe ruler time range">
                 <label className="timeline-custom-time"><span>◷ START</span><BufferedNumberInput ariaLabel="Custom ruler start time" value={customRulerStart} step={0.01} onCommit={value=>setCustomRulerStart(Math.max(0,value))}/><select aria-label="Custom ruler start unit" value={customRulerStartUnit} onChange={event=>setCustomRulerStartUnit(event.target.value as 's'|'m')}><option value="s">s</option><option value="m">m</option></select></label>
                 <label className="timeline-custom-time"><span>◷ END</span><BufferedNumberInput ariaLabel="Custom ruler end time" value={customRulerEnd} step={0.01} onCommit={value=>setCustomRulerEnd(Math.max(0,value))}/><select aria-label="Custom ruler end unit" value={customRulerEndUnit} onChange={event=>setCustomRulerEndUnit(event.target.value as 's'|'m')}><option value="s">s</option><option value="m">m</option></select></label>
               </div>
               <div className="alphabet-state-scroll" ref={timelineScrollRef} aria-label="Alphabet State sequence">
                 {sequenceStates.map(state => <div className="alphabet-state-item" key={state.id}>
                   <button type="button" className={"alphabet-state-handle " + (selectedSequenceState === state.id ? "active" : "")} title={"State " + state.label + " · tap to show ruler · drag right to expand, left to shrink"} onPointerDown={event=>beginSequenceRulerResize(event,state.id)} onPointerMove={moveSequenceRulerResize} onPointerUp={endSequenceRulerResize} onPointerCancel={endSequenceRulerResize} onClick={() => handleAlphabetStateHandleClick(state)}>{state.label}</button>
                   <div className={"alphabet-state-mini-ruler " + (selectedSequenceState === state.id ? "active" : "") + ((sequenceRulerDisplayWidths[state.id] || 96) > 96 ? " expanded" : " collapsed")} style={{width:(sequenceRulerDisplayWidths[state.id] || 96)+"px"}} aria-label={"State " + state.label + " keyframe timeline"}>
                     <span className="alphabet-state-frame-label">{Math.round(state.width)}f</span>
                     <div className="alphabet-state-ruler-scale" aria-label={"Frame ruler from "+getSequenceRange(state.id).start+" to "+getSequenceRange(state.id).end}>
                       <div className="alphabet-state-ruler-labels">{getCustomRulerTicks(sequenceRulerDisplayWidths[state.id] || 96).map((tick,index)=><span key={index} style={{left:tick.position+"%"}}>{tick.label}</span>)}</div>
                       <div className="alphabet-state-ruler-ticks" aria-hidden="true">
                         {Array.from({length:Math.max(2,Math.round(state.width)+1)},(_,index)=><i key={"minor-"+index} className={index%5===0?"medium":"minor"} style={{left:(index/Math.max(1,Math.round(state.width))*100)+"%"}}/>)}
                         {getCustomRulerTicks(sequenceRulerDisplayWidths[state.id] || 96).map((tick,index)=><i key={"major-"+index} className="major" style={{left:tick.position+"%"}}/>)}
                       </div>
                     </div>
                     <div className="alphabet-state-mini-markers" aria-label="Keyframe markers">
                       {Object.keys(keyframes[selected] || {}).map(value=>{const at=Number(value);const range=getSequenceRange(state.id);if(at<range.start||at>range.end)return null;return <button key={value} type="button" className={"alphabet-state-keyframe-marker "+(selectedKeyframe?.id===selected&&selectedKeyframe.frame===at?'selected-keyframe':'')} title={'Keyframe F'+at} aria-label={'Select keyframe at frame '+at} style={{left:(((at-range.start)/Math.max(1,range.end-range.start))*100)+'%',top:'50%'}} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setSelectedKeyframe({id:selected,frame:at});setCurrentFrame(at);}}><span>◆</span><small>{at}</small></button>;})}
                       {timelineMarkers.filter(marker=>{const range=getSequenceRange(state.id);return marker.frame>=range.start&&marker.frame<=range.end;}).map(marker=>{const range=getSequenceRange(state.id);return <button key={marker.id} type="button" className="alphabet-state-mini-event-marker" title={marker.label+" · "+marker.frame+"f"} style={{left:((marker.frame-range.start)/Math.max(1,range.end-range.start)*100)+"%"}} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setCurrentFrame(marker.frame);}}>▼</button>;})}
                     </div>
                     <input className="alphabet-state-scrubber" aria-label={"State " + state.label + " frame slider"} type="range" min={getSequenceRange(state.id).start} max={Math.max(getSequenceRange(state.id).start+1,getSequenceRange(state.id).end)} value={Math.max(getSequenceRange(state.id).start,Math.min(frame,getSequenceRange(state.id).end))} onChange={event=>setCurrentFrame(Number(event.target.value))}/>
                     
                   </div>
                 </div>)}
                 <button type="button" className="alphabet-state-add" onClick={() => { const id = addAlphabetState('independent'); setPendingStateChoice(id); }} aria-label="Add State">＋<small>STATE</small></button>
               </div>
               {pendingStateChoice && <div className="alphabet-state-choice"><span>START POSE</span><button type="button" onClick={() => setAlphabetStateMode(pendingStateChoice,'continue')}>CONTINUE</button><button type="button" onClick={() => setAlphabetStateMode(pendingStateChoice,'independent')}>INDEPENDENT</button></div>}
             {timelineTool !== 'tracks' && <div className="alphabet-state-tools-detail timeline-floating-tool-panel" aria-label="Selected State keyframe tools">
                 {timelineTool==='tracks' ? null : timelineTool==='dope' ? <div className="timeline-dope-sheet"><div className="timeline-dope-actions"><span>{selectedKeyframe ? 'SELECTED · '+(items.find(item=>item.id===selectedKeyframe.id)?.name||'Object')+' · F'+selectedKeyframe.frame : 'Select a diamond to edit its keyframe'}</span><button type="button" onClick={()=>moveSelectedKeyframe(-1)} disabled={!selectedKeyframe}>−1 FRAME</button><button type="button" onClick={()=>moveSelectedKeyframe(1)} disabled={!selectedKeyframe}>＋1 FRAME</button><button type="button" onClick={deleteFrame} disabled={!selectedKeyframe}>DELETE</button></div>{totalKeys===0 && <div className="timeline-tool-empty">NO KEYFRAMES YET · Select an object and tap ◆ Add Keyframe to create a keyframe.</div>}</div> : <div className="timeline-graph-editor"><div className="timeline-graph-toolbar"><label>CHANNEL <select aria-label="Graph channel" value={selectedGraphChannel} onChange={event=>setSelectedGraphChannel(event.target.value as typeof selectedGraphChannel)}><option value="position.x">POSITION X</option><option value="position.y">POSITION Y</option><option value="position.z">POSITION Z</option><option value="rotation.x">ROTATION X</option><option value="rotation.y">ROTATION Y</option><option value="rotation.z">ROTATION Z</option><option value="scale.x">SCALE X</option><option value="scale.y">SCALE Y</option><option value="scale.z">SCALE Z</option></select></label><label>KEY VALUE <BufferedNumberInput ariaLabel="Selected graph key value" value={selectedKeyframe && keyframes[selectedKeyframe.id]?.[selectedKeyframe.frame] ? (selectedGraphChannel.startsWith('rotation.') ? THREE.MathUtils.radToDeg((keyframes[selectedKeyframe.id][selectedKeyframe.frame] as any)[selectedGraphChannel.split('.')[0]][selectedGraphChannel.endsWith('.x')?0:selectedGraphChannel.endsWith('.y')?1:2]) : (keyframes[selectedKeyframe.id][selectedKeyframe.frame] as any)[selectedGraphChannel.split('.')[0]][selectedGraphChannel.endsWith('.x')?0:selectedGraphChannel.endsWith('.y')?1:2]) : 0} disabled={!selectedKeyframe} onCommit={updateSelectedKeyframeChannel}/></label><button type="button" onClick={()=>moveSelectedKeyframe(-1)} disabled={!selectedKeyframe}>◀ FRAME</button><button type="button" onClick={()=>moveSelectedKeyframe(1)} disabled={!selectedKeyframe}>FRAME ▶</button></div><div className="timeline-graph-plot" role="img" aria-label={selected+' '+selectedGraphChannel+' keyframe curve'}>{graphEntries.length===0 ? <div className="timeline-graph-empty">NO CURVE DATA · Add at least two keyframes for {selectedGraphChannel.toUpperCase()}.</div> : <svg viewBox="0 0 300 76" preserveAspectRatio="none"><line x1="0" y1="38" x2="300" y2="38" className="timeline-graph-zero"/><polyline className="timeline-graph-line" points={graphEntries.map(entry=>{const x=(entry.frame-activeSequenceRange.start)/Math.max(1,activeSequenceRange.end-activeSequenceRange.start)*300;const y=68-((entry.value-graphMin)/graphSpan)*58;return x.toFixed(1)+','+y.toFixed(1);}).join(' ')}/>{graphEntries.map(entry=><circle key={entry.frame} className={selectedKeyframe?.id===selected&&selectedKeyframe.frame===entry.frame?'timeline-graph-point active':'timeline-graph-point'} cx={(entry.frame-activeSequenceRange.start)/Math.max(1,activeSequenceRange.end-activeSequenceRange.start)*300} cy={68-((entry.value-graphMin)/graphSpan)*58} r="3"/>)}</svg>}</div><div className="timeline-curve-controls"><label>CURVE WEIGHT <input type="range" min="0" max="100" value={curveWeight} onChange={event=>setCurveWeight(Number(event.target.value))}/><span>{curveWeight}</span></label><label>CURVE TENSION <input type="range" min="0" max="100" value={curveTension} onChange={event=>setCurveTension(Number(event.target.value))}/><span>{curveTension}</span></label><label>CURVE TANGENT <input type="range" min="0" max="100" value={curveTangent} onChange={event=>setCurveTangent(Number(event.target.value))}/><span>{curveTangent}</span></label><p>Interpolation: {interpolation}. Select a keyframe, choose a channel, then edit its value or curve response.</p></div></div>}
                 {showGhostPreview && <div className="timeline-tool-empty">GHOST PREVIEW · 3D previous / next pose silhouettes are visible in the viewport.</div>}
                 {importedAnimationClips.length > 0 && <label className="timeline-clip-select">CLIP <select aria-label="Imported animation clip" value={activeAnimationClipId} onChange={event => setActiveAnimationClipId(event.target.value)}><option value="">TRANSFORM ONLY</option>{importedAnimationClips.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>}
                 <div className="timeline-settings"><label>DURATION <input type="number" min={1} value={timelineDuration} onChange={event => setTimelineDuration(Math.max(1, Number(event.target.value) || 1))}/> SEC</label><label>FPS <input type="range" min={1} max={60} value={frameRate} onChange={event => setFrameRate(Number(event.target.value))}/><span>{frameRate} · {Math.round(1000 / Math.max(1, frameRate))}ms/frame</span></label><label>INTERPOLATION <select value={interpolation} onChange={event => setInterpolation(event.target.value)}><option>Linear</option><option>Ease In</option><option>Ease Out</option><option>Ease In-Out</option><option>Bounce</option><option>Anticipation</option><option>Spring Damping</option></select></label><button type="button" title="Delete selected keyframe" onClick={deleteFrame}><Trash2 size={13}/></button></div>
             </div>}
             </section>
           </div>
         </div>
      </section>}
      {!cameraView && !animationMode && <div className={'bottom-bar action-dock ' + (animOpen ? 'timeline-open' : '')} aria-label="Object actions"><button onClick={duplicate} disabled={!selected || items.some(item => item.id === selected && item.kind === 'Camera')} title="Duplicate selected object" aria-label="Duplicate selected object"><Copy size={17}/></button><button className="delete-btn" onClick={deleteSelected} disabled={!selected || items.some(item => item.id === selected && item.kind === 'Camera')} title="Delete selected object" aria-label="Delete selected object"><Trash2 size={17}/></button></div>}

      

      {showInstall && !Capacitor.isNativePlatform() && !portrait && !window.matchMedia('(display-mode: standalone)').matches && <div className="install-backdrop"><section className="install-card" role="dialog" aria-modal="true" aria-labelledby="install-title"><div className="install-icon"><Download size={19} /></div><button className="install-close" aria-label="Later" onClick={() => { setShowInstall(false); sessionStorage.setItem('nexus3d-install-dismissed', '1'); }}><X size={14} /></button><small>NEXUS3D / APP INSTALLER</small><h2 id="install-title">Install Nexus3D App / APK for fullscreen desktop-like experience?</h2><p>Install the web app for a cleaner standalone workspace. Android APK is not generated by this web install prompt.</p><div className="install-actions"><button className="install-later" onClick={() => { setShowInstall(false); sessionStorage.setItem('nexus3d-install-dismissed', '1'); }}>Later</button><button className="install-now" onClick={async () => { if (installPrompt && typeof installPrompt.prompt === 'function') { await installPrompt.prompt(); const choice = await installPrompt.userChoice; setStatus(choice?.outcome === 'accepted' ? 'Install accepted' : 'Install dismissed'); setInstallPrompt(null); setShowInstall(false); } else { setStatus('Use your browser menu: Install app / Add to Home screen'); setShowInstall(false); } }}><Download size={13} /> Install</button></div></section></div>}
      {portrait && <div className="rotate-overlay"><div className="rotate-card"><div className="rotate-icon"><Rotate3D size={35} /></div><strong>Please rotate your device to Landscape Mode to use Nexus3D</strong><p>Nexus3D is optimized for a widescreen workspace.</p><div className="rotate-phone"><span /></div></div></div>}
    </main>
  );
}
