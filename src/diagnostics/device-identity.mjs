const DEVICE_ID_KEY = 'nexus3d_installation_device_id_v1';

function validId(value) {
  return typeof value === 'string' && /^N3D-[a-f0-9-]{20,64}$/i.test(value);
}

export function getOrCreateDeviceId(storage, createUuid = () =>
  (globalThis.crypto?.randomUUID?.() || [
    Date.now().toString(16),
    Math.random().toString(16).slice(2),
    Math.random().toString(16).slice(2)
  ].join('-'))) {
  if (!storage?.getItem || !storage?.setItem) return 'UNKNOWN_DEVICE_ID';
  try {
    const existing = storage.getItem(DEVICE_ID_KEY);
    if (validId(existing)) return existing;
    const id = 'N3D-' + String(createUuid()).replace(/[^a-f0-9-]/gi, '').toLowerCase();
    storage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'UNKNOWN_DEVICE_ID';
  }
}

export { DEVICE_ID_KEY };
