package com.nexus3d.studio.test;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.ContentResolver;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
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
    private static final String CONSENT = "cloud_diagnostics_consent";
    private static final String REGISTERED = "registered";
    private static final String SUPABASE_URL = "https://rupftghvjmalntjoesnv.supabase.co";
    private static final String SUPABASE_KEY = "sb_publishable_t3-BF5smZ21bzc59TVrYIw_4MHGG3Dq";
    private final java.util.concurrent.ExecutorService registrationExecutor = Executors.newSingleThreadExecutor();
    private static final ScheduledExecutorService PRESENCE_EXECUTOR = Executors.newSingleThreadScheduledExecutor();
    private static final Object PRESENCE_LOCK = new Object();
    private static ScheduledFuture<?> presenceTask;
    private static volatile boolean appForeground = false;

    @PluginMethod
    public void getOrCreateIdentity(PluginCall call) {
        try {
            String legacyId = call.getString("legacyDeviceId", "");
            Identity identity = loadOrCreate(getContext(), legacyId);
            JSObject result = new JSObject();
            result.put("deviceId", identity.installationId);
            boolean consent = preferences().getBoolean(CONSENT, false);
            result.put("registered", preferences().getBoolean(REGISTERED, false));
            result.put("cloudConsent", consent);
            call.resolve(result);
            if (consent && !preferences().getBoolean(REGISTERED, false)) {
                registrationExecutor.execute(() -> registerWithBackend(identity));
            }
        } catch (Exception error) {
            android.util.Log.e("NexusDeviceIdentity", "Identity continuity check failed; refusing to generate a replacement.", error);
            call.reject("Existing Nexus3D installation identity is incomplete or unreadable. No replacement ID was created.", error);
        }
    }


    /**
     * Cloud enrollment is strictly opt-in. The installation UUID and credential
     * remain native-only; no request is sent until the user taps Allow.
     */
    @PluginMethod
    public void requestCloudConsent(PluginCall call) {
        SharedPreferences prefs = preferences();
        if (prefs.getBoolean("consent_decided", false)) {
            boolean enabled = prefs.getBoolean(CONSENT, false);
            if (enabled && !prefs.getBoolean(REGISTERED, false)) {
                try {
                    Identity identity = loadOrCreate(getContext(), "");
                    registrationExecutor.execute(() -> registerWithBackend(identity));
                } catch (Exception error) {
                    android.util.Log.w("NexusDeviceIdentity", "Registration retry deferred.", error);
                }
            }
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            result.put("alreadyDecided", true);
            call.resolve(result);
            return;
        }
        getActivity().runOnUiThread(() -> new android.app.AlertDialog.Builder(getActivity())
            .setTitle("Nexus3D Device Diagnostics")
            .setMessage("Allow Nexus3D Editor to register a random installation ID with Nexus3D Diagnostics and share limited technical details: device manufacturer/model, Android version, Editor app version/build, foreground/background presence and last-active timestamps? No project files, scene content, contacts, GPS, IMEI or personal account data are collected. Registration is separate from your Diagnostics account login.")
            .setPositiveButton("Allow", (dialog, which) -> {
                prefs.edit().putBoolean(CONSENT, true).putBoolean("consent_decided", true).commit();
                try {
                    Identity identity = loadOrCreate(getContext(), "");
                    registrationExecutor.execute(() -> registerWithBackend(identity));
                } catch (Exception error) {
                    android.util.Log.w("NexusDeviceIdentity", "Registration deferred.", error);
                }
                JSObject result = new JSObject();
                result.put("enabled", true);
                result.put("alreadyDecided", false);
                call.resolve(result);
            })
            .setNegativeButton("Not now", (dialog, which) -> {
                prefs.edit().putBoolean(CONSENT, false).putBoolean("consent_decided", true).commit();
                JSObject result = new JSObject();
                result.put("enabled", false);
                result.put("alreadyDecided", false);
                call.resolve(result);
            })
            .setCancelable(false)
            .show());
    }

    private void registerWithBackend(Identity identity) {
        if (!preferences().getBoolean(CONSENT, false)) return;
        HttpURLConnection connection = null;
        try {
            Context context = getContext().getApplicationContext();
            android.content.pm.PackageInfo packageInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long versionCode = android.os.Build.VERSION.SDK_INT >= 28
                    ? packageInfo.getLongVersionCode() : packageInfo.versionCode;
            JSONObject body = new JSONObject();
            body.put("installationId", identity.installationId);
            body.put("deviceCode", identity.credential);
            body.put("appVersion", packageInfo.versionName == null ? "unknown" : packageInfo.versionName);
            body.put("buildNumber", versionCode);
            body.put("versionCode", versionCode);
            JSONObject deviceInfo = new JSONObject();
            deviceInfo.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
            deviceInfo.put("model", Build.MODEL == null ? "" : Build.MODEL);
            deviceInfo.put("androidVersion", Build.VERSION.RELEASE == null ? "" : Build.VERSION.RELEASE);
            body.put("deviceInfo", deviceInfo);

            URL endpoint = new URL(SUPABASE_URL + "/functions/v1/auto-register-device");
            connection = (HttpURLConnection) endpoint.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("apikey", SUPABASE_KEY);
            connection.setRequestProperty("Authorization", "Bearer " + SUPABASE_KEY);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            StringBuilder responseText = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) responseText.append(line);
                }
            }
            if (status >= 200 && status < 300) {
                JSONObject response = new JSONObject(responseText.toString());
                String returnedId = response.optString("deviceId", "").toLowerCase(java.util.Locale.ROOT);
                if (!identity.installationId.equalsIgnoreCase(returnedId)
                        || !response.optBoolean("registered", false)
                        || !"active".equalsIgnoreCase(response.optString("status", ""))) {
                    throw new IllegalStateException("Registration response did not confirm the canonical ACTIVE installation.");
                }
                if (!preferences().edit().putBoolean(REGISTERED, true).commit()) {
                    throw new IllegalStateException("Unable to persist registration state.");
                }
                if (appForeground) onAppForegroundChanged(context, true);
            } else {
                android.util.Log.w("NexusDeviceIdentity", "Automatic registration deferred: HTTP " + status);
            }
        } catch (Exception error) {
            android.util.Log.w("NexusDeviceIdentity", "Automatic registration deferred; canonical identity retained.", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Presence is sent only after consent and confirmed ACTIVE registration. */
    public static void onAppForegroundChanged(Context suppliedContext, boolean foreground) {
        Context context = suppliedContext.getApplicationContext();
        synchronized (PRESENCE_LOCK) {
            appForeground = foreground;
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.getBoolean(CONSENT, false) || !prefs.getBoolean(REGISTERED, false)) return;
            if (foreground) {
                if (presenceTask != null && !presenceTask.isCancelled() && !presenceTask.isDone()) return;
                presenceTask = PRESENCE_EXECUTOR.scheduleAtFixedRate(
                    () -> sendPresence(context, "online"), 0, 45, TimeUnit.SECONDS
                );
            } else {
                if (presenceTask != null) {
                    presenceTask.cancel(false);
                    presenceTask = null;
                }
                PRESENCE_EXECUTOR.execute(() -> sendPresence(context, "offline"));
            }
        }
    }

    private static void sendPresence(Context context, String state) {
        HttpURLConnection connection = null;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.getBoolean(CONSENT, false) || !prefs.getBoolean(REGISTERED, false)) return;
            String installationId = prefs.getString(ID, null);
            String iv = prefs.getString(SECRET_IV, null);
            String encrypted = prefs.getString(SECRET_CIPHER, null);
            if (installationId == null || iv == null || encrypted == null) return;

            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
            if (key == null) return;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key,
                new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String credential = new String(
                cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)),
                StandardCharsets.UTF_8
            );
            if (credential.length() != 64) return;

            JSONObject body = new JSONObject();
            body.put("installationId", installationId);
            body.put("deviceCode", credential);
            body.put("state", state);

            // Send live installed-app and device metadata with every authenticated
            // presence update so upgrades and device changes refresh the same record.
            android.content.pm.PackageInfo packageInfo =
                context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long versionCode = android.os.Build.VERSION.SDK_INT >= 28
                ? packageInfo.getLongVersionCode() : packageInfo.versionCode;
            body.put("appVersion", packageInfo.versionName == null ? "unknown" : packageInfo.versionName);
            body.put("buildNumber", versionCode);
            body.put("versionCode", versionCode);
            JSONObject deviceInfo = new JSONObject();
            deviceInfo.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
            deviceInfo.put("model", Build.MODEL == null ? "" : Build.MODEL);
            deviceInfo.put("androidVersion", Build.VERSION.RELEASE == null ? "" : Build.VERSION.RELEASE);
            body.put("deviceInfo", deviceInfo);
            URL endpoint = new URL(SUPABASE_URL + "/functions/v1/device-presence");
            connection = (HttpURLConnection) endpoint.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("apikey", SUPABASE_KEY);
            connection.setRequestProperty("Authorization", "Bearer " + SUPABASE_KEY);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                android.util.Log.w("NexusDeviceIdentity", "Presence update deferred: HTTP " + status);
            }
        } catch (Exception error) {
            android.util.Log.w("NexusDeviceIdentity", "Presence update deferred; no identity was changed.", error);
        } finally {
            if (connection != null) connection.disconnect();
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
            int pending = new JSONArray(prefs.getString(OUTBOX, "[]")).length();
            JSObject result = new JSObject();
            result.put("accepted", accepted);
            result.put("acknowledged", acknowledged);
            result.put("pending", pending);
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
            java.util.ArrayList<String> ack = response.getStringArrayList("acknowledgedEventIds");
            Set<String> acknowledgedIds = new HashSet<>();
            if (ack != null) acknowledgedIds.addAll(ack);
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
