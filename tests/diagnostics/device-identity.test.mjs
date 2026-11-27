import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_ID_KEY, getOrCreateDeviceId } from '../../src/diagnostics/device-identity.mjs';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    values,
  };
}

test('installation device ID is generated once and reused across app version updates', () => {
  const storage = memoryStorage();
  const first = getOrCreateDeviceId(storage, () => 'abcdef01-2345-6789-abcd-ef0123456789');
  const afterUpdate = getOrCreateDeviceId(storage, () => 'ffffffff-ffff-ffff-ffff-ffffffffffff');
  assert.equal(first, 'N3D-abcdef01-2345-6789-abcd-ef0123456789');
  assert.equal(afterUpdate, first);
  assert.equal(storage.values.get(DEVICE_ID_KEY), first);
});

test('invalid stored identifiers are replaced and storage failures are explicit', () => {
  const storage = memoryStorage({ [DEVICE_ID_KEY]: 'old-invalid' });
  assert.equal(getOrCreateDeviceId(storage, () => '12345678-1234-1234-1234-123456789abc'),
    'N3D-12345678-1234-1234-1234-123456789abc');
  assert.equal(getOrCreateDeviceId(null), 'UNKNOWN_DEVICE_ID');
});
