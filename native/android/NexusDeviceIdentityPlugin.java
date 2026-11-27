package com.nexus3d.studio.test;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.ContentResolver;
import android.net.Uri;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Installation identity owned by Android. Existing identity state is never silently replaced. */
@CapacitorPlugin(name = "NexusDeviceIdentity")
public class NexusDeviceIdentityPlugin extends Plugin {
    private static final String PREFS = "nexus3d_device_identity";
    private static final String KEY_ALIAS = "nexus3d_device_identity_key_v1";
    private static final String ID = "installation_id";
    private static final String SECRET_IV = "credential_iv";
    private static final String SECRET_CIPHER = "credential_cipher";
    private static final String OUTBOX = "rds_ipc_outbox_v1";
    private static final String NEXT_SEQUENCE = "rds_ipc_next_sequence_v1";
    private static final int MAX_QUEUE = 2000;
    private static final int MAX_BATCH = 20;
    private static final int MAX_PAYLOAD_BYTES = 120 * 1024;

    @PluginMethod
    public void getOrCreateIdentity(PluginCall call) {
        try {
            String legacyId = call.getString("legacyDeviceId", "");
            Identity identity = loadOrCreate(getContext(), legacyId);
            JSObject result = new JSObject();
            result.put("deviceId", identity.installationId);
            result.put("registered", preferences().getBoolean("registered", false));
            result.put("cloudConsent", preferences().getBoolean("cloud_diagnostics_consent", false));
            call.resolve(result);
        } catch (Exception error) {
            android.util.Log.e("NexusDeviceIdentity", "Identity continuity check failed; refusing to generate a replacement.", error);
            call.reject("Existing Nexus3D installation identity is incomplete or unreadable. No replacement ID was created.", error);
        }
    }


    /** Accepts only newly captured RDS events. The durable queue is separate from RDS report stores. */
    @PluginMethod
    public synchronized void enqueueRdsEvents(PluginCall call) {
        try {
            String deviceId = call.getString("deviceId", "");
            if (!isUuid(deviceId)) throw new IllegalArgumentException("Canonical installation UUID is required.");
            String eventsJson = call.getString("eventsJson", "[]");
            JSONArray incoming = new JSONArray(eventsJson);
            SharedPreferences prefs = preferences();
            JSONArray queue = new JSONArray(prefs.getString(OUTBOX, "[]"));
            Set<String> known = new HashSet<>();
            for (int i = 0; i < queue.length(); i++) known.add(queue.getJSONObject(i).optString("eventId"));
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject source = incoming.getJSONObject(i);
                JSONObject event = toBridgeEvent(source, deviceId, prefs);
                if (!known.add(event.getString("eventId"))) continue;
                if (queue.length() >= MAX_QUEUE) throw new IllegalStateException("Diagnostics IPC outbox is full; unsent events were retained and new events were not accepted.");
                queue.put(event);
            }
            if (!prefs.edit().putString(OUTBOX, queue.toString()).commit()) {
                throw new IllegalStateException("Unable to persist Diagnostics IPC outbox.");
            }
            int accepted = incoming.length();
            int acknowledged = flushOutbox();
            JSObject result = new JSObject();
            result.put("accepted", accepted);
            result.put("acknowledged", acknowledged);
            result.put("pending", Math.max(0, queue.length() - acknowledged));
            call.resolve(result);
        } catch (Exception error) {
            android.util.Log.w("NexusDeviceIdentity", "RDS IPC events remain pending or were rejected.", error);
            call.reject("Unable to enqueue or deliver RDS diagnostics events.", error);
        }
    }

    @PluginMethod
    public synchronized void flushRdsOutbox(PluginCall call) {
        try {
            int acknowledged = flushOutbox();
            JSObject result = new JSObject();
            result.put("acknowledged", acknowledged);
            result.put("pending", new JSONArray(preferences().getString(OUTBOX, "[]")).length());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Diagnostics IPC outbox flush failed; pending events were retained.", error);
        }
    }

    private JSONObject toBridgeEvent(JSONObject source, String deviceId, SharedPreferences prefs) throws Exception {
        long sequence = prefs.getLong(NEXT_SEQUENCE, 1L);
        if (!prefs.edit().putLong(NEXT_SEQUENCE, sequence + 1L).commit()) throw new IllegalStateException("Unable to persist IPC sequence.");
        String tool = source.optString("tool", "RDS");
        String sourceName = tool.equalsIgnoreCase("LogCat") ? "RDS_LOGCAT"
                : tool.equalsIgnoreCase("RIT Trace") ? "RIT_TRACE" : "RUNTIME";
        String level = source.optString("level", "INFO").toUpperCase(java.util.Locale.ROOT);
        if (!level.matches("VERBOSE|DEBUG|INFO|WARN|ERROR|FATAL")) level = "INFO";
        String title = source.optString("event", source.optString("message", "RDS event"));
        String details = source.optJSONObject("details") != null
                ? source.optJSONObject("details").toString() : source.optString("details", "");
        JSONObject event = new JSONObject();
        event.put("eventId", UUID.randomUUID().toString());
        event.put("deviceId", deviceId);
        event.put("sequence", sequence);
        event.put("schemaVersion", 1);
        event.put("source", sourceName);
        event.put("severity", level);
        event.put("title", title.length() > 240 ? title.substring(0, 240) : title);
        event.put("details", details.length() > 2400 ? details.substring(0, 2400) : details);
        event.put("sessionId", source.optString("sessionId", "UNASSIGNED_SESSION"));
        event.put("timestampEpochMs", source.optLong("timestampEpochMs", System.currentTimeMillis()));
        return event;
    }

    private int flushOutbox() throws Exception {
        SharedPreferences prefs = preferences();
        JSONArray queue = new JSONArray(prefs.getString(OUTBOX, "[]"));
        int totalAcknowledged = 0;
        while (queue.length() > 0) {
            JSONArray batch = new JSONArray();
            int end = Math.min(queue.length(), MAX_BATCH);
            for (int i = 0; i < end; i++) {
                JSONObject candidate = queue.getJSONObject(i);
                JSONArray trial = new JSONArray(batch.toString());
                trial.put(candidate);
                if (trial.toString().getBytes(StandardCharsets.UTF_8).length > MAX_PAYLOAD_BYTES) break;
                batch.put(candidate);
            }
            if (batch.length() == 0) break;
            Bundle extras = new Bundle();
            extras.putString("eventsJson", batch.toString());
            Bundle response = null;
            String[] authorities = new String[] {
                    "content://com.nexus3d.diagnostics.bridge",
                    "content://com.nexus3d.diagnostics.debug.bridge"
            };
            for (String authority : authorities) {
                try {
                    response = getContext().getContentResolver().call(Uri.parse(authority), "ingestBatch", null, extras);
                    if (response != null && response.getBoolean("ok", false)) break;
                    response = null;
                } catch (Exception unavailable) { response = null; }
            }
            if (response == null) break;
            JSONArray ack = response.getParcelableArrayList("acknowledgedEventIds") == null
                    ? new JSONArray() : new JSONArray(response.getString("acknowledgedEventIds", "[]"));
            Set<String> acknowledgedIds = new HashSet<>();
            for (int i = 0; i < ack.length(); i++) acknowledgedIds.add(ack.optString(i));
            if (acknowledgedIds.isEmpty()) break;
            JSONArray remaining = new JSONArray();
            int removed = 0;
            for (int i = 0; i < queue.length(); i++) {
                JSONObject item = queue.getJSONObject(i);
                if (acknowledgedIds.contains(item.optString("eventId"))) removed++;
                else remaining.put(item);
            }
            if (removed == 0) break;
            if (!prefs.edit().putString(OUTBOX, remaining.toString()).commit()) throw new IllegalStateException("Unable to persist IPC acknowledgments.");
            totalAcknowledged += removed;
            queue = remaining;
        }
        return totalAcknowledged;
    }

    private boolean isUuid(String value) {
        return value != null && value.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    }

    private Identity loadOrCreate(Context context, String legacyId) throws Exception {
        SharedPreferences prefs = preferences();
        String installationId = prefs.getString(ID, null);
        String iv = prefs.getString(SECRET_IV, null);
        String encrypted = prefs.getString(SECRET_CIPHER, null);
        boolean hasAnyIdentityState = installationId != null || iv != null || encrypted != null;

        if (hasAnyIdentityState) {
            if (installationId == null || iv == null || encrypted == null) {
                throw new IllegalStateException("Partial installation identity state detected.");
            }
            String credential = decryptCredential(prefs);
            if (credential == null || credential.length() != 64) {
                throw new IllegalStateException("Stored installation credential is invalid.");
            }
            return new Identity(installationId, credential);
        }

        String migratedId = parseLegacyUuid(legacyId);
        installationId = migratedId != null ? migratedId : UUID.randomUUID().toString();
        byte[] secret = new byte[32];
        new SecureRandom().nextBytes(secret);
        String credential = toHex(secret);
        encryptCredential(prefs, credential);
        boolean saved = prefs.edit().putString(ID, installationId).putBoolean("registered", false).commit();
        if (!saved) throw new IllegalStateException("Unable to persist installation identity.");
        return new Identity(installationId, credential);
    }

    private String parseLegacyUuid(String value) {
        if (value == null || !value.matches("(?i)^N3D-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")) return null;
        return value.substring(4).toLowerCase(java.util.Locale.ROOT);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            SecretKey existing = (SecretKey) store.getKey(KEY_ALIAS, null);
            if (existing == null) throw new IllegalStateException("Android Keystore identity key is unavailable.");
            return existing;
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    private void encryptCredential(SharedPreferences prefs, String credential) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(credential.getBytes(StandardCharsets.UTF_8));
        boolean saved = prefs.edit()
                .putString(SECRET_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString(SECRET_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .commit();
        if (!saved) throw new IllegalStateException("Unable to persist encrypted installation credential.");
    }

    private String decryptCredential(SharedPreferences prefs) throws Exception {
        String iv = prefs.getString(SECRET_IV, null);
        String encrypted = prefs.getString(SECRET_CIPHER, null);
        if (iv == null || encrypted == null) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }

    private static final class Identity {
        final String installationId;
        final String credential;
        Identity(String id, String secret) { installationId = id; credential = secret; }
    }
}
