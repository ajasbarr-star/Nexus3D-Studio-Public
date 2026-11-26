let nextSceneIdentity = 1;
let nextSnapshotId = 1;
const SCENE_IDENTITIES = new WeakMap();

function getSceneIdentity(scene) {
  if (!scene || (typeof scene !== 'object' && typeof scene !== 'function')) return 'UNAVAILABLE';
  if (scene.uuid) return String(scene.uuid);
  if (!SCENE_IDENTITIES.has(scene)) SCENE_IDENTITIES.set(scene, 'scene-' + nextSceneIdentity++);
  return SCENE_IDENTITIES.get(scene);
}

const TEXTURE_SLOT_NAMES = [
  'map','alphaMap','aoMap','bumpMap','normalMap','displacementMap','emissiveMap',
  'envMap','lightMap','metalnessMap','roughnessMap','clearcoatMap','clearcoatNormalMap',
  'clearcoatRoughnessMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap',
  'sheenRoughnessMap','specularMap','specularColorMap','specularIntensityMap',
  'transmissionMap','thicknessMap','gradientMap'
];

function allSceneObjects(scene) {
  const objects = [];
  if (!scene) return objects;
  if (typeof scene.traverse === 'function') scene.traverse(object => objects.push(object));
  else if (typeof scene.traverseVisible === 'function') scene.traverseVisible(object => objects.push(object));
  return objects;
}

function isEffectivelyVisible(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent || null;
  }
  return true;
}

function getMaterialList(objects) {
  const materials = new Map();
  for (const object of objects) {
    if (!object?.isMesh || !object.material) continue;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      const key = material.uuid || material.id || material;
      if (!materials.has(key)) materials.set(key, { material, meshes: [] });
      materials.get(key).meshes.push(object.name || object.type || 'Mesh');
    }
  }
  return [...materials.values()];
}

function inspectMaterial(entry) {
  const { material, meshes } = entry;
  const bindings = [];
  const add = (slot, texture) => {
    if (texture?.isTexture) bindings.push({ slot, texture: texture.name || texture.uuid || 'Unnamed texture', uuid: texture.uuid || '' });
  };
  for (const slot of TEXTURE_SLOT_NAMES) add(slot, material[slot]);
  for (const [uniformName, uniform] of Object.entries(material.uniforms || {})) {
    const value = uniform && typeof uniform === 'object' && 'value' in uniform ? uniform.value : uniform;
    if (Array.isArray(value)) value.forEach((texture, index) => add('uniform:' + uniformName + '[' + index + ']', texture));
    else add('uniform:' + uniformName, value);
  }
  return {
    name: material.name || material.type || 'Unnamed material',
    type: material.type || 'Unknown',
    meshes: [...new Set(meshes)],
    bindings,
    samplerSlots: bindings.length,
    customShader: Boolean(material.isShaderMaterial || material.isRawShaderMaterial)
  };
}

function readLimit(gl, key) {
  try { return gl?.getParameter?.(gl[key]) ?? null; } catch { return null; }
}

export function collectWebGLDiagnostics({ renderer, scene, shaderErrors = [] } = {}) {
  const gl = renderer?.getContext?.() || null;
  const objects = allSceneObjects(scene);
  const visible = objects.filter(isEffectivelyVisible);
  const materialEntries = getMaterialList(visible).map(inspectMaterial);
  const lights = objects.filter(object => object?.isLight);
  const shadowLights = lights.filter(light => light.castShadow);
  const visibleShadowLights = shadowLights.filter(isEffectivelyVisible);
  const hiddenShadowLights = shadowLights.filter(light => !isEffectivelyVisible(light));
  const textureBindings = materialEntries.flatMap(material => material.bindings);
  const uniqueTextures = new Set(textureBindings.map(binding => binding.uuid || binding.texture));
  const render = renderer?.info?.render || {};
  const memory = renderer?.info?.memory || {};
  const directionalShadowLights = shadowLights.filter(light => light.isDirectionalLight || light.type === 'DirectionalLight');
  const capturedAt = new Date().toISOString();
  return {
    snapshotId: nextSnapshotId++,
    capturedAt,
    sceneIdentity: getSceneIdentity(scene),
    webgl: {
      version: gl ? readLimit(gl, 'VERSION') : null,
      renderer: gl ? readLimit(gl, 'RENDERER') : null,
      vendor: gl ? readLimit(gl, 'VENDOR') : null,
      contextLost: gl ? Boolean(gl.isContextLost?.()) : null,
      maxTextureSize: readLimit(gl, 'MAX_TEXTURE_SIZE'),
      fragmentTextureUnits: readLimit(gl, 'MAX_TEXTURE_IMAGE_UNITS'),
      vertexTextureUnits: readLimit(gl, 'MAX_VERTEX_TEXTURE_IMAGE_UNITS'),
      combinedTextureUnits: readLimit(gl, 'MAX_COMBINED_TEXTURE_IMAGE_UNITS'),
      fragmentUniformVectors: readLimit(gl, 'MAX_FRAGMENT_UNIFORM_VECTORS'),
      vertexUniformVectors: readLimit(gl, 'MAX_VERTEX_UNIFORM_VECTORS')
    },
    scene: {
      identity: getSceneIdentity(scene),
      name: scene?.name || 'Unnamed Scene',
      uuid: scene?.uuid || null,
      totalObjects: objects.length,
      visibleObjects: visible.length,
      hiddenObjects: objects.length - visible.length,
      visibleMeshes: visible.filter(object => object?.isMesh).length,
      totalLights: lights.length,
      visibleLights: lights.filter(isEffectivelyVisible).length,
      hiddenLights: lights.filter(light => !isEffectivelyVisible(light)).length
    },
    shadows: {
      enabled: Boolean(renderer?.shadowMap?.enabled),
      autoUpdate: renderer?.shadowMap?.autoUpdate ?? null,
      shadowCastingLights: shadowLights.length,
      directionalShadowCastingLights: directionalShadowLights.length,
      directionalMaps: directionalShadowLights.map(light => ({
        name: light.name || light.type || 'Unnamed Directional Light',
        editorId: light.userData?.editorId || null,
        uuid: light.uuid || null,
        width: light.shadow?.mapSize?.width ?? null,
        height: light.shadow?.mapSize?.height ?? null,
        visible: isEffectivelyVisible(light)
      })),
      visibleShadowCastingLights: visibleShadowLights.length,
      hiddenShadowCastingLights: hiddenShadowLights.length,
      byType: shadowLights.reduce((counts, light) => {
        const type = light.type || (light.isDirectionalLight ? 'DirectionalLight' : light.isPointLight ? 'PointLight' : light.isSpotLight ? 'SpotLight' : 'OtherLight');
        counts[type] = (counts[type] || 0) + 1;
        return counts;
      }, {}),
      maps: shadowLights.map(light => ({
        name: light.name || light.type || 'Unnamed light',
        type: light.type || 'Unknown',
        width: light.shadow?.mapSize?.width ?? null,
        height: light.shadow?.mapSize?.height ?? null,
        mapAllocated: Boolean(light.shadow?.map),
        visible: isEffectivelyVisible(light)
      }))
    },
    materials: {
      uniqueMaterials: materialEntries.length,
      materialTextureSlots: textureBindings.length,
      uniqueTextures: uniqueTextures.size,
      customShaderMaterials: materialEntries.filter(material => material.customShader).length,
      estimatedSamplerSlotsByMaterial: materialEntries,
      note: 'Texture-slot inventory is measured from material properties and custom uniforms. It is not the final linked shader active-uniform count.'
    },
    render: {
      drawCalls: Number.isFinite(render.calls) ? render.calls : null,
      triangles: Number.isFinite(render.triangles) ? render.triangles : null,
      geometries: Number.isFinite(memory.geometries) ? memory.geometries : null,
      textures: Number.isFinite(memory.textures) ? memory.textures : null
    },
    shaderErrors: [...shaderErrors]
  };
}

export function formatWebGLDiagnostics(snapshot = {}) {
  const webgl = snapshot.webgl || {};
  const scene = snapshot.scene || {};
  const materials = snapshot.materials || {};
  const render = snapshot.render || {};
  return [
    'NEXUS3D RDS · WEBGL / SHADER DIAGNOSTICS',
    'Snapshot: ' + (snapshot.snapshotId ?? 'UNAVAILABLE') + ' · Captured: ' + (snapshot.capturedAt || 'NOT CAPTURED'),
    'Scene identity: ' + (snapshot.sceneIdentity || scene.identity || 'UNAVAILABLE'),
    '',
    'DEVICE / WEBGL LIMITS',
    'Version: ' + (webgl.version || 'UNAVAILABLE'),
    'Renderer: ' + (webgl.renderer || 'UNAVAILABLE'),
    'Vendor: ' + (webgl.vendor || 'UNAVAILABLE'),
    'Context lost: ' + (webgl.contextLost === null || webgl.contextLost === undefined ? 'UNKNOWN' : webgl.contextLost),
    'Max texture size: ' + (webgl.maxTextureSize ?? 'UNAVAILABLE'),
    'Fragment texture units: ' + (webgl.fragmentTextureUnits ?? 'UNAVAILABLE'),
    'Vertex texture units: ' + (webgl.vertexTextureUnits ?? 'UNAVAILABLE'),
    'Combined texture units: ' + (webgl.combinedTextureUnits ?? 'UNAVAILABLE'),
    'Fragment uniform vectors: ' + (webgl.fragmentUniformVectors ?? 'UNAVAILABLE'),
    'Vertex uniform vectors: ' + (webgl.vertexUniformVectors ?? 'UNAVAILABLE'),
    '',
    'SCENE / MATERIAL INVENTORY',
    'Visible objects: ' + (scene.visibleObjects ?? 0),
    'Visible meshes: ' + (scene.visibleMeshes ?? 0),
    'Unique materials: ' + (materials.uniqueMaterials ?? 0),
    'Material texture slots: ' + (materials.materialTextureSlots ?? 0),
    'Unique texture objects: ' + (materials.uniqueTextures ?? 0),
    'Custom shader materials: ' + (materials.customShaderMaterials ?? 0),
    materials.note || '',
    '',
    'SHADER ERRORS CAPTURED: ' + (snapshot.shaderErrors || []).length,
    ...(snapshot.shaderErrors || []).map((error, index) => {
      const context = error.context || {};
      const contextShadows = context.shadows || {};
      const contextWebgl = context.webgl || {};
      return '[' + (index + 1) + '] ' + (error.message || 'Shader program error') + (error.category ? ' · ' + error.category : '') +
        (error.details ? '\\n' + error.details : '') +
        (error.context ? '\\n  Event scene: ' + (context.sceneIdentity || 'UNAVAILABLE') + ' · snapshot ' + (context.snapshotId ?? 'UNAVAILABLE') +
          ' · directional shadow casters: ' + (contextShadows.directionalShadowCastingLights ?? 'UNAVAILABLE') +
          ' · fragment units: ' + (contextWebgl.fragmentTextureUnits ?? 'UNAVAILABLE') : '');
    }),
    '',
    'LAST RENDERER INFO SNAPSHOT',
    'Draw calls: ' + (render.drawCalls ?? 'UNAVAILABLE'),
    'Triangles: ' + (render.triangles ?? 'UNAVAILABLE'),
    'Geometries: ' + (render.geometries ?? 'UNAVAILABLE'),
    'Textures: ' + (render.textures ?? 'UNAVAILABLE'),
    '',
    'LIMITATION: Three.js exposes scene shadow-caster inventory publicly, but not the exact number of shadow-map render passes completed in each frame. See Shadow Map Analysis for the measured inventory and this limitation.'
  ].join('\n');
}

export function formatShadowMapAnalysis(snapshot = {}) {
  const shadows = snapshot.shadows || {};
  const counts = Object.entries(shadows.byType || {}).map(([type, count]) => type + ': ' + count);
  const maps = shadows.maps || [];
  return [
    'NEXUS3D RDS · SHADOW MAP ANALYSIS',
    'Snapshot: ' + (snapshot.snapshotId ?? 'UNAVAILABLE') + ' · Captured: ' + (snapshot.capturedAt || 'NOT CAPTURED'),
    'Scene identity: ' + (snapshot.sceneIdentity || snapshot.scene?.identity || 'UNAVAILABLE'),
    'Renderer shadow maps enabled: ' + Boolean(shadows.enabled),
    'Automatic shadow updates: ' + (shadows.autoUpdate ?? 'UNKNOWN'),
    'Shadow-casting lights (entire scene): ' + (shadows.shadowCastingLights ?? 0),
    'Visible shadow-casting lights: ' + (shadows.visibleShadowCastingLights ?? shadows.shadowCastingLights ?? 0),
    'Hidden shadow-casting lights: ' + (shadows.hiddenShadowCastingLights ?? 0),
    'Shadow-caster counts (entire scene): ' + (counts.join(', ') || 'None'),
    'Directional shadow casters: ' + (shadows.directionalShadowCastingLights ?? 0),
    'Directional map sizes: ' + ((shadows.directionalMaps || []).map(map => map.name + ':' + (map.width ?? '?') + 'x' + (map.height ?? '?')).join(', ') || 'None'),
    'Device fragment texture-unit limit: ' + (snapshot.webgl?.fragmentTextureUnits ?? 'UNAVAILABLE'),
    'Device combined texture-unit limit: ' + (snapshot.webgl?.combinedTextureUnits ?? 'UNAVAILABLE'),
    'Capacity interpretation: directional shadow casters are a potential sampler-pressure indicator, not the final linked shader sampler count.',
    '',
    'SHADOW MAP INVENTORY',
    ...(maps.length ? maps.map((map, index) => (index + 1) + '. ' + map.name + ' [' + map.type + '] · ' + (map.width ?? '?') + 'x' + (map.height ?? '?') + ' · allocated: ' + map.mapAllocated + ' · visible: ' + (map.visible ?? 'UNKNOWN')) : ['No shadow-casting lights were found in the scene.']),
    '',
    'PER-FRAME RENDER COUNT: NOT EXPOSED',
    'The current Three.js WebGLRenderer public API does not expose a per-frame counter for completed shadow-map passes. The count above is the scene shadow-caster inventory, not a claim that every listed map rendered in the last frame.',
    'No shadow, light, renderer, or scene settings were changed.'
  ].join('\n');
}

export function formatMaterialTextureAnalysis(snapshot = {}) {
  const materials = snapshot.materials || {};
  const entries = materials.estimatedSamplerSlotsByMaterial || [];
  return [
    'NEXUS3D RDS · MATERIAL & TEXTURE ANALYSIS',
    'Captured: ' + (snapshot.capturedAt || 'NOT CAPTURED'),
    'Unique materials: ' + (materials.uniqueMaterials ?? 0),
    'Material texture slots: ' + (materials.materialTextureSlots ?? 0),
    'Unique texture objects: ' + (materials.uniqueTextures ?? 0),
    'Custom shader materials: ' + (materials.customShaderMaterials ?? 0),
    '',
    'MATERIAL BREAKDOWN',
    ...(entries.length ? entries.map(material => material.name + ' [' + material.type + '] · ' + material.samplerSlots + ' texture slot(s) · meshes: ' + material.meshes.join(', ') + (material.bindings.length ? '\\n  ' + material.bindings.map(binding => binding.slot + ' → ' + binding.texture).join(', ') : '')) : ['No visible mesh materials were found.']),
    '',
    'SAMPLER OVERFLOW CHECK',
    'Device fragment texture-unit limit: ' + (snapshot.webgl?.fragmentTextureUnits ?? 'UNAVAILABLE'),
    'This inventory is a material-slot estimate. The final active sampler count must be read from the linked shader program; it is not inferred from the total scene texture count.',
    'No material, texture, or shader was changed.'
  ].join('\n');
}

export function attachShaderErrorCapture(renderer, onError, { getContext } = {}) {
  if (!renderer?.debug || typeof onError !== 'function') throw new Error('WebGL renderer debug hook is unavailable');
  const debug = renderer.debug;
  const previous = debug.onShaderError;
  const handler = (gl, program, vertexShader, fragmentShader) => {
    try { previous?.(gl, program, vertexShader, fragmentShader); } catch { /* preserve diagnostic capture */ }
    const parts = [];
    try { const value = gl?.getProgramInfoLog?.(program); if (value) parts.push('Program: ' + value); } catch {}
    try { const value = gl?.getShaderInfoLog?.(vertexShader); if (value) parts.push('Vertex shader: ' + value); } catch {}
    try { const value = gl?.getShaderInfoLog?.(fragmentShader); if (value) parts.push('Fragment shader: ' + value); } catch {}
    const details = parts.join('\n');
    const samplerOverflow = /sampler location|component exceeds max allowed|sampler|texture image unit|too many/i.test(details);
    const message = /sampler location or component exceeds max allowed/i.test(details)
      ? 'Shader link error · sampler location/component limit exceeded'
      : samplerOverflow ? 'Shader link/compile error · possible sampler or texture-unit overflow' : 'WebGL shader compile/link error';
    let context = null;
    try { context = typeof getContext === 'function' ? getContext() : null; } catch (error) {
      context = { contextCaptureError: error instanceof Error ? error.message : String(error) };
    }
    onError({ message, category: samplerOverflow ? 'SAMPLER_LIMIT' : 'SHADER_COMPILE_OR_LINK', details, timestamp: new Date().toISOString(), context });
  };
  debug.onShaderError = handler;
  return () => {
    if (debug.onShaderError === handler) debug.onShaderError = previous;
  };
}


// Opt-in wrapper around Three.js WebGLShadowMap.render(). This measures renderer
// shadow-map update cycles, not individual per-light GPU passes.
export function attachShadowRenderCapture(renderer, { now = () => performance.now(), maxSamples = 1200 } = {}) {
  const shadowMap = renderer?.shadowMap;
  if (!shadowMap || typeof shadowMap.render !== 'function') throw new Error('Three.js shadowMap.render hook is unavailable in this renderer');
  const previous = shadowMap.render;
  const samples = [];
  let pendingCycles = 0, pendingRenderMs = 0, totalCycles = 0, totalRenderMs = 0;
  let totalFrames = 0, totalFrameMs = 0, framesWithTiming = 0;
  let minCycles = null, maxCycles = null, maxRenderMs = null, stopped = false;
  const wrapped = function (...args) {
    const started = now();
    pendingCycles += 1;
    totalCycles += 1;
    try { return previous.apply(this, args); }
    finally {
      const elapsed = Math.max(0, now() - started);
      pendingRenderMs += elapsed;
      totalRenderMs += elapsed;
    }
  };
  shadowMap.render = wrapped;
  const recordFrame = frameMs => {
    if (stopped) return;
    const measuredFrameMs = Number.isFinite(frameMs) ? Math.max(0, frameMs) : null;
    totalFrames += 1;
    if (measuredFrameMs !== null) {
      totalFrameMs += measuredFrameMs;
      framesWithTiming += 1;
    }
    minCycles = minCycles === null ? pendingCycles : Math.min(minCycles, pendingCycles);
    maxCycles = maxCycles === null ? pendingCycles : Math.max(maxCycles, pendingCycles);
    maxRenderMs = maxRenderMs === null ? pendingRenderMs : Math.max(maxRenderMs, pendingRenderMs);
    samples.push({ frameMs: measuredFrameMs, updateCycles: pendingCycles, shadowRenderMs: pendingRenderMs });
    if (samples.length > maxSamples) samples.shift();
    pendingCycles = 0;
    pendingRenderMs = 0;
  };
  const getSnapshot = () => {
    if (pendingCycles || pendingRenderMs) recordFrame(null);
    const averageFrameMs = framesWithTiming ? totalFrameMs / framesWithTiming : null;
    return {
      capturedAt: new Date().toISOString(),
      instrumentation: 'renderer.shadowMap.render wrapper',
      measurement: 'Shadow-map update cycles entered per recorded renderer frame; not per-light GPU passes.',
      totalUpdateCycles: totalCycles,
      totalShadowRenderMs: Number(totalRenderMs.toFixed(3)),
      frames: totalFrames,
      measuredFrames: totalFrames,
      storedSamples: samples.length,
      averageUpdateCyclesPerFrame: totalFrames ? totalCycles / totalFrames : null,
      minUpdateCyclesPerFrame: minCycles,
      maxUpdateCyclesPerFrame: maxCycles,
      averageShadowRenderMsPerFrame: totalFrames ? totalRenderMs / totalFrames : null,
      maxShadowRenderMsPerFrame: maxRenderMs,
      averageFrameMs,
      estimatedFpsFromFrameTime: averageFrameMs > 0 ? 1000 / averageFrameMs : null,
      samples: samples.map(sample => ({ ...sample }))
    };
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (shadowMap.render === wrapped) shadowMap.render = previous;
  };
  return { recordFrame, getSnapshot, stop };
}

export function formatShadowRenderCapture(snapshot = {}) {
  const fmt = value => Number.isFinite(value) ? Number(value).toFixed(2) : 'UNAVAILABLE';
  return [
    'NEXUS3D RDS · ACTUAL SHADOW RENDER CAPTURE',
    'Captured: ' + (snapshot.capturedAt || 'NOT CAPTURED'),
    'Instrumentation: ' + (snapshot.instrumentation || 'UNAVAILABLE'),
    'Total shadow-map update cycles: ' + (snapshot.totalUpdateCycles ?? 'UNAVAILABLE'),
    'Measured frames: ' + (snapshot.measuredFrames ?? snapshot.frames ?? 0),
    'Stored samples: ' + (snapshot.storedSamples ?? snapshot.frames ?? 0),
    'Average update cycles per frame: ' + fmt(snapshot.averageUpdateCyclesPerFrame),
    'Minimum update cycles per frame: ' + fmt(snapshot.minUpdateCyclesPerFrame),
    'Maximum update cycles per frame: ' + fmt(snapshot.maxUpdateCyclesPerFrame),
    'Average shadow-map render time per frame (ms): ' + fmt(snapshot.averageShadowRenderMsPerFrame),
    'Maximum shadow-map render time per frame (ms): ' + fmt(snapshot.maxShadowRenderMsPerFrame),
    'Average frame time (ms): ' + fmt(snapshot.averageFrameMs),
    'Estimated FPS from average frame time: ' + fmt(snapshot.estimatedFpsFromFrameTime),
    '',
    'LIMITATION: Each count is one invocation of Three.js WebGLShadowMap.render(). It is an update-cycle count, not a count of individual lights or completed per-light GPU shadow passes. Frame time includes the whole editor frame and is correlated, not attributed solely to shadows.',
    'No scene, light, shadow, material, or renderer settings were changed.'
  ].join('\n');
}
