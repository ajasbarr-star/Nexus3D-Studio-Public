const TEXTURE_SLOT_NAMES = [
  'map','alphaMap','aoMap','bumpMap','normalMap','displacementMap','emissiveMap',
  'envMap','lightMap','metalnessMap','roughnessMap','clearcoatMap','clearcoatNormalMap',
  'clearcoatRoughnessMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap',
  'sheenRoughnessMap','specularMap','specularColorMap','specularIntensityMap',
  'transmissionMap','thicknessMap','gradientMap'
];

function visibleObjects(scene) {
  const objects = [];
  if (!scene || typeof scene.traverseVisible !== 'function') return objects;
  scene.traverseVisible(object => objects.push(object));
  return objects;
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
  const objects = visibleObjects(scene);
  const materialEntries = getMaterialList(objects).map(inspectMaterial);
  const lights = objects.filter(object => object?.isLight);
  const shadowLights = lights.filter(light => light.castShadow);
  const textureBindings = materialEntries.flatMap(material => material.bindings);
  const uniqueTextures = new Set(textureBindings.map(binding => binding.uuid || binding.texture));
  const render = renderer?.info?.render || {};
  const memory = renderer?.info?.memory || {};
  return {
    capturedAt: new Date().toISOString(),
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
      visibleObjects: objects.length,
      visibleMeshes: objects.filter(object => object?.isMesh).length,
      visibleLights: lights.length
    },
    shadows: {
      enabled: Boolean(renderer?.shadowMap?.enabled),
      autoUpdate: renderer?.shadowMap?.autoUpdate ?? null,
      shadowCastingLights: shadowLights.length,
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
        mapAllocated: Boolean(light.shadow?.map)
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
    'Captured: ' + (snapshot.capturedAt || 'NOT CAPTURED'),
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
    ...(snapshot.shaderErrors || []).map((error, index) => '[' + (index + 1) + '] ' + (error.message || 'Shader program error') + (error.details ? '\\n' + error.details : '')),
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
    'Captured: ' + (snapshot.capturedAt || 'NOT CAPTURED'),
    'Renderer shadow maps enabled: ' + Boolean(shadows.enabled),
    'Automatic shadow updates: ' + (shadows.autoUpdate ?? 'UNKNOWN'),
    'Visible shadow-casting lights: ' + (shadows.shadowCastingLights ?? 0),
    'Shadow-caster counts: ' + (counts.join(', ') || 'None'),
    '',
    'SHADOW MAP INVENTORY',
    ...(maps.length ? maps.map((map, index) => (index + 1) + '. ' + map.name + ' [' + map.type + '] · ' + (map.width ?? '?') + 'x' + (map.height ?? '?') + ' · allocated: ' + map.mapAllocated) : ['No visible shadow-casting lights were found.']),
    '',
    'PER-FRAME RENDER COUNT: NOT EXPOSED',
    'The current Three.js WebGLRenderer public API does not expose a per-frame counter for completed shadow-map passes. The count above is the visible shadow-casting light inventory, not a claim that every listed map rendered in the last frame.',
    'No shadow, light, renderer, or scene settings were changed.'
  ].join('\\n');
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
  ].join('\\n');
}

export function attachShaderErrorCapture(renderer, onError) {
  if (!renderer?.debug || typeof onError !== 'function') throw new Error('WebGL renderer debug hook is unavailable');
  const debug = renderer.debug;
  const previous = debug.onShaderError;
  const handler = (gl, program, vertexShader, fragmentShader) => {
    try { previous?.(gl, program, vertexShader, fragmentShader); } catch { /* preserve diagnostic capture */ }
    const parts = [];
    try { const value = gl?.getProgramInfoLog?.(program); if (value) parts.push('Program: ' + value); } catch {}
    try { const value = gl?.getShaderInfoLog?.(vertexShader); if (value) parts.push('Vertex shader: ' + value); } catch {}
    try { const value = gl?.getShaderInfoLog?.(fragmentShader); if (value) parts.push('Fragment shader: ' + value); } catch {}
    const details = parts.join('\\n');
    const message = /sampler|texture image unit|too many/i.test(details) ? 'Shader link/compile error · possible sampler or texture-unit overflow' : 'WebGL shader compile/link error';
    onError({ message, details, timestamp: new Date().toISOString() });
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
  let pendingCycles = 0, pendingRenderMs = 0, totalCycles = 0, totalRenderMs = 0, stopped = false;
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
    samples.push({ frameMs: Number.isFinite(frameMs) ? Math.max(0, frameMs) : null, updateCycles: pendingCycles, shadowRenderMs: pendingRenderMs });
    if (samples.length > maxSamples) samples.shift();
    pendingCycles = 0;
    pendingRenderMs = 0;
  };
  const getSnapshot = () => {
    if (pendingCycles || pendingRenderMs) recordFrame(null);
    const validFrames = samples.filter(sample => sample.frameMs !== null);
    const cycles = samples.map(sample => sample.updateCycles);
    const renderTimes = samples.map(sample => sample.shadowRenderMs);
    const frameTimes = validFrames.map(sample => sample.frameMs);
    const sum = values => values.reduce((total, value) => total + value, 0);
    const avg = values => values.length ? sum(values) / values.length : null;
    return {
      capturedAt: new Date().toISOString(),
      instrumentation: 'renderer.shadowMap.render wrapper',
      measurement: 'Shadow-map update cycles entered per renderer frame; not per-light GPU passes.',
      totalUpdateCycles: totalCycles,
      totalShadowRenderMs: Number(totalRenderMs.toFixed(3)),
      frames: samples.length,
      averageUpdateCyclesPerFrame: avg(cycles),
      minUpdateCyclesPerFrame: cycles.length ? Math.min(...cycles) : null,
      maxUpdateCyclesPerFrame: cycles.length ? Math.max(...cycles) : null,
      averageShadowRenderMsPerFrame: avg(renderTimes),
      maxShadowRenderMsPerFrame: renderTimes.length ? Math.max(...renderTimes) : null,
      averageFrameMs: avg(frameTimes),
      estimatedFpsFromFrameTime: avg(frameTimes) > 0 ? 1000 / avg(frameTimes) : null,
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
    'Measured frames: ' + (snapshot.frames ?? 0),
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
  ].join('\\n');
}
