package com.nexus3d.studio.test;

import android.content.Context;
import android.app.ActivityManager;
import android.os.Environment;
import android.os.StatFs;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES20;
import java.io.File;
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
    private static final String CLOUD_OUTBOX = "rds_cloud_outbox_v1";
    private static final String NEXT_SEQUENCE = "rds_ipc_next_sequence_v1";
    private static final int MAX_QUEUE = 2000;
    private static final int MAX_OUTBOX_BYTES = 10 * 1024 * 1024;
    private static final int MAX_CLOUD_OUTBOX_BYTES = 10 * 1024 * 1024;
    private static final int MAX_BATCH = 20;
    private static final int MAX_PAYLOAD_BYTES = 120 * 1024;
    private static final int MAX_CLOUD_PAYLOAD_BYTES = 240 * 1024;
    private static final Object CLOUD_FLUSH_LOCK = new Object();
    private static final java.util.concurrent.atomic.AtomicBoolean CLOUD_FLUSH_SCHEDULED = new java.util.concurrent.atomic.AtomicBoolean(false);
    private static final String CONSENT = "cloud_diagnostics_consent";
    private static final String CONSENT_VERSION_KEY = "cloud_diagnostics_consent_version";
    private static final int CURRENT_CONSENT_VERSION = 3;
    private static final String REGISTERED = "registered";
    private static final String APP_VERSION = "editor_app_version";
    private static final String APP_BUILD_NUMBER = "editor_app_build_number";
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
            cacheAppVersionMetadata(getContext().getApplicationContext());
            Identity identity = loadOrCreate(getContext(), legacyId);
            JSObject result = new JSObject();
            result.put("deviceId", identity.installationId);
            boolean consent = hasCurrentConsent(preferences());
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
        if (prefs.getBoolean("consent_decided", false) && !prefs.getBoolean(CONSENT, false)) {
            prefs.edit().putInt(CONSENT_VERSION_KEY, CURRENT_CONSENT_VERSION).commit();
            JSObject result = new JSObject();
            result.put("enabled", false);
            result.put("alreadyDecided", true);
            call.resolve(result);
            return;
        }
        if (prefs.getBoolean("consent_decided", false) && prefs.getInt(CONSENT_VERSION_KEY, 0) >= CURRENT_CONSENT_VERSION) {
            boolean enabled = prefs.getBoolean(CONSENT, false);
            if (enabled) {
                try {
                    Identity identity = loadOrCreate(getContext(), "");
                    if (!prefs.getBoolean(REGISTERED, false)) {
                        registrationExecutor.execute(() -> registerWithBackend(identity));
                    } else {
                        scheduleCloudOutboxFlush();
                        if (appForeground) onAppForegroundChanged(getContext().getApplicationContext(), true);
                    }
                } catch (Exception error) {
                    android.util.Log.w("NexusDeviceIdentity", "Registration or cloud sync retry deferred.", error);
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
            .setMessage("Allow Nexus3D Editor to register a random installation ID with Nexus3D Diagnostics and share technical details: device manufacturer/model, CPU and GPU identifiers, Android version, total RAM, data-partition storage capacity, Editor app version/build, foreground/background presence and last-active timestamps, plus RDS diagnostic events. RDS events may include tool and control labels, interaction metadata, object names or IDs, scene hierarchy references, and camera/runtime performance measurements when you enable Run Analysis. Project files, mesh geometry, textures, saved scenes, contacts, GPS, IMEI and personal account data are not uploaded by this diagnostics event sync. Registration is separate from your Diagnostics account login.")
            .setPositiveButton("Allow", (dialog, which) -> {
                prefs.edit().putBoolean(CONSENT, true).putBoolean("consent_decided", true).putInt(CONSENT_VERSION_KEY, CURRENT_CONSENT_VERSION).commit();
                try {
                    Identity identity = loadOrCreate(getContext(), "");
                    if (!prefs.getBoolean(REGISTERED, false)) {
                        registrationExecutor.execute(() -> registerWithBackend(identity));
                    } else {
                        scheduleCloudOutboxFlush();
                        if (appForeground) onAppForegroundChanged(getContext().getApplicationContext(), true);
                    }
                } catch (Exception error) {
                    android.util.Log.w("NexusDeviceIdentity", "Registration or cloud sync deferred.", error);
                }
                JSObject result = new JSObject();
                result.put("enabled", true);
                result.put("alreadyDecided", false);
                call.resolve(result);
            })
            .setNegativeButton("Not now", (dialog, which) -> {
                prefs.edit().putBoolean(CONSENT, false).putBoolean("consent_decided", true).putInt(CONSENT_VERSION_KEY, CURRENT_CONSENT_VERSION).commit();
                JSObject result = new JSObject();
                result.put("enabled", false);
                result.put("alreadyDecided", false);
                call.resolve(result);
            })
            .setCancelable(false)
            .show());
    }

    private void registerWithBackend(Identity identity) {
        if (!hasCurrentConsent(preferences())) return;
        HttpURLConnection connection = null;
        try {
            Context context = getContext().getApplicationContext();
            android.content.pm.PackageInfo packageInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long versionCode = android.os.Build.VERSION.SDK_INT >= 28
                    ? packageInfo.getLongVersionCode() : packageInfo.versionCode;
            cacheAppVersionMetadata(context);
            JSONObject body = new JSONObject();
            body.put("installationId", identity.installationId);
            body.put("deviceCode", identity.credential);
            body.put("appVersion", packageInfo.versionName == null ? "unknown" : packageInfo.versionName);
            body.put("buildNumber", versionCode);
            body.put("versionCode", versionCode);
            body.put("deviceInfo", collectDeviceInfo(context));

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
                flushCloudOutbox(context, identity.credential);
            } else {
                android.util.Log.w("NexusDeviceIdentity", "Automatic registration deferred: HTTP " + status);
            }
        } catch (Exception error) {
            android.util.Log.w("NexusDeviceIdentity", "Automatic registration deferred; canonical identity retained.", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void cacheAppVersionMetadata(Context context) {
        try {
            android.content.pm.PackageInfo packageInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long versionCode = android.os.Build.VERSION.SDK_INT >= 28
                    ? packageInfo.getLongVersionCode() : packageInfo.versionCode;
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString(APP_VERSION, packageInfo.versionName == null ? "unknown" : packageInfo.versionName)
                    .putLong(APP_BUILD_NUMBER, versionCode)
                    .apply();
        } catch (Exception error) {
            android.util.Log.w("NexusDeviceIdentity", "Unable to refresh Editor version metadata.", error);
        }
    }

    private static boolean hasCurrentConsent(SharedPreferences prefs) {
        return prefs.getBoolean(CONSENT, false)
                && prefs.getInt(CONSENT_VERSION_KEY, 0) >= CURRENT_CONSENT_VERSION;
    }

    private static JSONObject collectDeviceInfo(Context context) {
        JSONObject info = new JSONObject();
        try { info.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER); } catch (Exception ignored) {}
        try { info.put("model", Build.MODEL == null ? "" : Build.MODEL); } catch (Exception ignored) {}
        try { info.put("androidVersion", Build.VERSION.RELEASE == null ? "" : Build.VERSION.RELEASE); } catch (Exception ignored) {}
        try {
            String cpu = "";
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(new java.io.FileInputStream("/proc/cpuinfo"), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String lower = line.toLowerCase(java.util.Locale.ROOT);
                    if (lower.startsWith("hardware") || lower.startsWith("model name") || lower.startsWith("processor")) {
                        int colon = line.indexOf(':');
                        if (colon >= 0 && line.substring(colon + 1).trim().length() > 2) { cpu = line.substring(colon + 1).trim(); if (lower.startsWith("hardware") || lower.startsWith("model name")) break; }
                    }
                }
            } catch (Exception ignored) {}
            if (cpu.isEmpty()) cpu = Build.HARDWARE + " (" + (Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown ABI") + ")";
            info.put("cpu", cpu);
        } catch (Exception ignored) {}
        try {
            String gpu = "";
            EGLDisplay display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
            int[] version = new int[2];
            if (display != EGL14.EGL_NO_DISPLAY && EGL14.eglInitialize(display, version, 0, version, 1)) {
                int[] configAttrs = {EGL14.EGL_RENDERABLE_TYPE, 4, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT, EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_NONE};
                EGLConfig[] configs = new EGLConfig[1]; int[] count = new int[1];
                if (EGL14.eglChooseConfig(display, configAttrs, 0, configs, 0, 1, count, 0) && count[0] > 0) {
                    int[] contextAttrs = {0x3098, 2, EGL14.EGL_NONE};
                    EGLContext glContext = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, contextAttrs, 0);
                    int[] surfaceAttrs = {EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE};
                    EGLSurface surface = EGL14.eglCreatePbufferSurface(display, configs[0], surfaceAttrs, 0);
                    if (glContext != EGL14.EGL_NO_CONTEXT && surface != EGL14.EGL_NO_SURFACE && EGL14.eglMakeCurrent(display, surface, surface, glContext)) {
                        String renderer = GLES20.glGetString(GLES20.GL_RENDERER);
                        if (renderer != null) gpu = renderer;
                    }
                    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
                    if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface);
                    if (glContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, glContext);
                }
                EGL14.eglTerminate(display);
            }
            info.put("gpu", gpu);
        } catch (Exception error) { try { info.put("gpu", "Unavailable"); } catch (Exception ignored) {} }
        try {
            ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (manager != null) { manager.getMemoryInfo(memory); info.put("ramBytes", memory.totalMem); }
        } catch (Exception ignored) {}
        try {
            StatFs storage = new StatFs(Environment.getDataDirectory().getAbsolutePath());
            info.put("romBytes", storage.getTotalBytes());
        } catch (Exception ignored) {}
        return info;
    }

    /** Presence is sent only after consent and confirmed ACTIVE registration. */
    public static void onAppForegroundChanged(Context suppliedContext, boolean foreground) {
        Context context = suppliedContext.getApplicationContext();
        synchronized (PRESENCE_LOCK) {
            appForeground = foreground;
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!hasCurrentConsent(prefs) || !prefs.getBoolean(REGISTERED, false)) return;
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
            if (!hasCurrentConsent(prefs) || !prefs.getBoolean(REGISTERED, false)) return;
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
            prefs.edit().putString(APP_VERSION, packageInfo.versionName == null ? "unknown" : packageInfo.versionName)
                .putLong(APP_BUILD_NUMBER, versionCode).apply();
            body.put("appVersion", packageInfo.versionName == null ? "unknown" : packageInfo.versionName);
            body.put("buildNumber", versionCode);
            body.put("versionCode", versionCode);
            body.put("deviceInfo", collectDeviceInfo(context));
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
            } else {
                flushCloudOutbox(context, credential);
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

            boolean cloudConsent = hasCurrentConsent(prefs);
            JSONArray cloudQueue = new JSONArray(prefs.getString(CLOUD_OUTBOX, "[]"));
            Set<String> knownCloud = new HashSet<>();
            for (int i = 0; i < cloudQueue.length(); i++) knownCloud.add(cloudQueue.getJSONObject(i).optString("eventId"));
            boolean cloudQueueFull = false;

            for (int i = 0; i < incoming.length(); i++) {
                JSONObject source = incoming.getJSONObject(i);
                JSONObject event = toBridgeEvent(source, deviceId, prefs);
                String eventId = event.getString("eventId");
                if (known.add(eventId)) {
                    if (queue.length() >= MAX_QUEUE) throw new IllegalStateException("Diagnostics IPC outbox is full; unsent events were retained and new events were not accepted.");
                    JSONArray trialQueue = new JSONArray(queue.toString());
                    trialQueue.put(event);
                    if (trialQueue.toString().getBytes(StandardCharsets.UTF_8).length > MAX_OUTBOX_BYTES) {
                        throw new IllegalStateException("Diagnostics IPC outbox reached its byte limit; unsent events were retained.");
                    }
                    queue.put(event);
                }
                if (cloudConsent && knownCloud.add(eventId)) {
                    if (cloudQueue.length() >= MAX_QUEUE) {
                        cloudQueueFull = true;
                    } else {
                        JSONArray trialCloudQueue = new JSONArray(cloudQueue.toString());
                        trialCloudQueue.put(new JSONObject(event.toString()));
                        if (trialCloudQueue.toString().getBytes(StandardCharsets.UTF_8).length > MAX_CLOUD_OUTBOX_BYTES) {
                            cloudQueueFull = true;
                        } else {
                            cloudQueue.put(new JSONObject(event.toString()));
                        }
                    }
                }
            }
            if (!prefs.edit().putString(OUTBOX, queue.toString()).commit()) {
                throw new IllegalStateException("Unable to persist Diagnostics IPC outbox.");
            }
            boolean cloudQueuePersisted = !cloudConsent || prefs.edit().putString(CLOUD_OUTBOX, cloudQueue.toString()).commit();
            if (!cloudQueuePersisted) {
                android.util.Log.w("NexusDeviceIdentity", "Cloud outbox persistence deferred; local Diagnostics IPC queue remains saved.");
            }
            if (cloudQueueFull) {
                android.util.Log.w("NexusDeviceIdentity", "Cloud outbox is full; pending cloud events were retained and new cloud events were not queued.");
            }

            int acknowledged = flushOutbox();
            int pending = new JSONArray(prefs.getString(OUTBOX, "[]")).length();
            if (cloudConsent) scheduleCloudOutboxFlush();
            int cloudPending = new JSONArray(prefs.getString(CLOUD_OUTBOX, "[]")).length();
            JSObject result = new JSObject();
            result.put("accepted", incoming.length());
            result.put("acknowledged", acknowledged);
            result.put("pending", pending);
            result.put("cloudPending", cloudPending);
            result.put("cloudConsent", cloudConsent);
            result.put("cloudQueueFull", cloudQueueFull);
            result.put("cloudQueuePersisted", cloudQueuePersisted);
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
            boolean cloudConsent = hasCurrentConsent(preferences());
            if (cloudConsent) scheduleCloudOutboxFlush();
            JSObject result = new JSObject();
            result.put("acknowledged", acknowledged);
            result.put("pending", new JSONArray(preferences().getString(OUTBOX, "[]")).length());
            result.put("cloudPending", new JSONArray(preferences().getString(CLOUD_OUTBOX, "[]")).length());
            result.put("cloudConsent", cloudConsent);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Diagnostics IPC outbox flush failed; pending events were retained.", error);
        }
    }

    private JSONObject toBridgeEvent(JSONObject source, String deviceId, SharedPreferences prefs) throws Exception {
        long sequence = prefs.getLong(NEXT_SEQUENCE, 1L);
        if (!prefs.edit().putLong(NEXT_SEQUENCE, sequence + 1L).commit()) throw new IllegalStateException("Unable to persist IPC sequence.");
        String tool = source.optString("tool", "RDS");
        String normalizedTool = tool.trim().toUpperCase(java.util.Locale.ROOT);
        String sourceName;
        switch (normalizedTool) {
            case "LOGCAT": sourceName = "RDS_LOGCAT"; break;
            case "RIT TRACE": sourceName = "RIT_TRACE"; break;
            case "WEBGL / SHADER": sourceName = "WEBGL_SHADER"; break;
            case "SHADOW MAPS": sourceName = "SHADOW_MAPS"; break;
            case "MATERIALS & TEXTURES": sourceName = "MATERIALS_TEXTURES"; break;
            case "DFI CORE": sourceName = "DFI_CORE"; break;
            case "MESH DFI": sourceName = "MESH_DFI"; break;
            case "ROOT CAUSE": sourceName = "ROOT_CAUSE"; break;
            case "SOURCE AUDIT": sourceName = "SOURCE_AUDIT"; break;
            case "REPORTS": sourceName = "REPORTS"; break;
            default: sourceName = "RUNTIME"; break;
        }
        String level = source.optString("level", "INFO").toUpperCase(java.util.Locale.ROOT);
        if (!level.matches("VERBOSE|DEBUG|INFO|WARN|ERROR|FATAL")) level = "INFO";
        String title = source.optString("event", source.optString("message", "RDS event"));
        String rawDetails = source.optJSONObject("details") != null
                ? source.optJSONObject("details").toString() : source.optString("details", "");
        JSONObject detailsEnvelope = new JSONObject();
        detailsEnvelope.put("deviceId", deviceId);
        detailsEnvelope.put("appVersion", prefs.getString(APP_VERSION, "unknown"));
        detailsEnvelope.put("buildNumber", source.optLong("buildNumber", prefs.getLong(APP_BUILD_NUMBER, 0L)));
        int payloadLength = rawDetails.length();
        String details = "";
        while (true) {
            detailsEnvelope.put("eventDetails", rawDetails.substring(0, payloadLength));
            details = detailsEnvelope.toString();
            if (details.length() <= 24000 || payloadLength == 0) break;
            payloadLength = Math.max(0, payloadLength - (details.length() - 24000));
        }
        JSONObject event = new JSONObject();
        String originalEventId = source.optString("id", "");
        event.put("eventId", isUuid(originalEventId) ? originalEventId : UUID.randomUUID().toString());
        event.put("deviceId", deviceId);
        event.put("sequence", sequence);
        event.put("schemaVersion", 1);
        event.put("source", sourceName);
        event.put("severity", level);
        event.put("title", title.length() > 240 ? title.substring(0, 240) : title);
        event.put("details", details.length() > 24000 ? details.substring(0, 24000) : details);
        event.put("sessionId", source.optString("sessionId", "UNASSIGNED_SESSION"));
        event.put("timestampEpochMs", source.optLong("timestampEpochMs", System.currentTimeMillis()));
        return event;
    }

    private int flushOutbox() throws Exception {
        SharedPreferences prefs = preferences();
        JSONArray queue = new JSONArray(prefs.getString(OUTBOX, "[]"));
        int totalAcknowledged = 0;
        int consecutiveUnacknowledged = 0;
        String[] authorities = new String[] {
                "content://com.nexus3d.diagnostics.bridge",
                "content://com.nexus3d.diagnostics.debug.bridge"
        };

        while (queue.length() > 0) {
            int passLimit = queue.length();
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

            Bundle response = callDiagnosticsProvider(batch, authorities);
            // A single invalid event can reject an otherwise valid batch. Isolate the
            // head event before deciding whether the provider itself is unavailable.
            if (response == null && batch.length() > 1) {
                JSONArray single = new JSONArray().put(queue.getJSONObject(0));
                response = callDiagnosticsProvider(single, authorities);
            }

            Set<String> acknowledgedIds = new HashSet<>();
            if (response != null && response.getBoolean("ok", false)) {
                java.util.ArrayList<String> ack = response.getStringArrayList("acknowledgedEventIds");
                if (ack != null) acknowledgedIds.addAll(ack);
            }

            JSONArray remaining = new JSONArray();
            int removed = 0;
            for (int i = 0; i < queue.length(); i++) {
                JSONObject item = queue.getJSONObject(i);
                if (acknowledgedIds.contains(item.optString("eventId"))) {
                    removed++;
                } else {
                    remaining.put(item);
                }
            }

            if (removed > 0) {
                if (!prefs.edit().putString(OUTBOX, remaining.toString()).commit()) {
                    throw new IllegalStateException("Unable to persist IPC acknowledgments.");
                }
                totalAcknowledged += removed;
                queue = remaining;
                consecutiveUnacknowledged = 0;
                continue;
            }

            // Preserve the original event and its ID. Move an unacknowledged head
            // event to the tail after one failed isolated attempt so it cannot block
            // later valid records. If every event fails, stop after one complete pass.
            JSONObject deferred = queue.getJSONObject(0);
            deferred.put("ipcRetryCount", deferred.optInt("ipcRetryCount", 0) + 1);
            JSONArray rotated = new JSONArray();
            for (int i = 1; i < queue.length(); i++) rotated.put(queue.getJSONObject(i));
            rotated.put(deferred);
            if (!prefs.edit().putString(OUTBOX, rotated.toString()).commit()) {
                throw new IllegalStateException("Unable to persist deferred IPC event order.");
            }
            queue = rotated;
            consecutiveUnacknowledged++;
            if (consecutiveUnacknowledged >= passLimit) break;
        }
        return totalAcknowledged;
    }

    private Bundle callDiagnosticsProvider(JSONArray batch, String[] authorities) {
        Bundle extras = new Bundle();
        extras.putString("eventsJson", batch.toString());
        for (String authority : authorities) {
            try {
                Bundle response = getContext().getContentResolver().call(
                        Uri.parse(authority), "ingestBatch", null, extras
                );
                if (response != null && response.getBoolean("ok", false)) return response;
            } catch (Exception unavailableOrRejected) {
                // Try the alternate installed package, then let the caller retain/reorder the event.
            }
        }
        return null;
    }

    private void scheduleCloudOutboxFlush() {
        if (!CLOUD_FLUSH_SCHEDULED.compareAndSet(false, true)) return;
        Context context = getContext().getApplicationContext();
        registrationExecutor.execute(() -> {
            try {
                Identity identity = loadOrCreate(context, "");
                flushCloudOutbox(context, identity.credential);
            } catch (Exception error) {
                android.util.Log.w("NexusDeviceIdentity", "Cloud diagnostics sync deferred; queued events retained.", error);
            } finally {
                CLOUD_FLUSH_SCHEDULED.set(false);
            }
        });
    }

    /** Cloud delivery has its own durable queue and ACK lifecycle, separate from local IPC ACKs. */
    private static void flushCloudOutbox(Context context, String credential) {
        synchronized (CLOUD_FLUSH_LOCK) {
            HttpURLConnection connection = null;
            try {
                SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                if (!hasCurrentConsent(prefs) || !prefs.getBoolean(REGISTERED, false)) return;
                if (credential == null || credential.length() != 64) return;

                JSONArray queue = new JSONArray(prefs.getString(CLOUD_OUTBOX, "[]"));
                while (queue.length() > 0) {
                    JSONArray batch = new JSONArray();
                    int end = Math.min(queue.length(), MAX_BATCH);
                    for (int i = 0; i < end; i++) {
                        JSONObject cloudEvent = toCloudEvent(queue.getJSONObject(i));
                        JSONArray trial = new JSONArray(batch.toString());
                        trial.put(cloudEvent);
                        JSONObject trialBody = new JSONObject().put("events", trial);
                        if (trialBody.toString().getBytes(StandardCharsets.UTF_8).length > MAX_CLOUD_PAYLOAD_BYTES) break;
                        batch.put(cloudEvent);
                    }
                    if (batch.length() == 0) return;

                    JSONObject body = new JSONObject().put("events", batch);
                    URL endpoint = new URL(SUPABASE_URL + "/functions/v1/ingest-events");
                    connection = (HttpURLConnection) endpoint.openConnection();
                    connection.setRequestMethod("POST");
                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(15000);
                    connection.setRequestProperty("apikey", SUPABASE_KEY);
                    connection.setRequestProperty("Authorization", "Bearer " + credential);
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
                    if (status < 200 || status >= 300) {
                        android.util.Log.w("NexusDeviceIdentity", "Cloud diagnostics sync deferred: HTTP " + status);
                        return;
                    }

                    JSONObject response = new JSONObject(responseText.toString());
                    if (!response.optBoolean("ok", false)) return;
                    JSONArray ack = response.optJSONArray("acknowledgedEventIds");
                    Set<String> acknowledgedIds = new HashSet<>();
                    if (ack != null) for (int i = 0; i < ack.length(); i++) acknowledgedIds.add(ack.optString(i));
                    if (acknowledgedIds.isEmpty()) return;

                    JSONArray remaining = new JSONArray();
                    int removed = 0;
                    for (int i = 0; i < queue.length(); i++) {
                        JSONObject item = queue.getJSONObject(i);
                        if (acknowledgedIds.contains(item.optString("eventId"))) removed++;
                        else remaining.put(item);
                    }
                    if (removed == 0) return;
                    if (!prefs.edit().putString(CLOUD_OUTBOX, remaining.toString()).commit()) {
                        throw new IllegalStateException("Unable to persist cloud diagnostics acknowledgments.");
                    }
                    if (connection != null) {
                        connection.disconnect();
                        connection = null;
                    }
                    queue = remaining;
                }
            } catch (Exception error) {
                android.util.Log.w("NexusDeviceIdentity", "Cloud diagnostics sync failed; unacknowledged events remain queued.", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
    }

    private static JSONObject toCloudEvent(JSONObject stored) throws Exception {
        long timestamp = stored.optLong("timestampEpochMs", System.currentTimeMillis());
        java.text.SimpleDateFormat formatter = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        formatter.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        JSONObject event = new JSONObject();
        event.put("eventId", stored.optString("eventId"));
        event.put("sessionId", stored.optString("sessionId", "UNASSIGNED_SESSION"));
        event.put("sequence", stored.optLong("sequence", 0));
        event.put("schemaVersion", stored.optInt("schemaVersion", 1));
        event.put("source", stored.optString("source", "RUNTIME"));
        event.put("severity", stored.optString("severity", "INFO"));
        event.put("title", stored.optString("title", "RDS event"));
        event.put("details", stored.optString("details", ""));
        event.put("timestamp", formatter.format(new java.util.Date(timestamp)));
        return event;
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
