package com.nexus3d.studio.test;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Creates one persistent installation identity on first app launch.
 * The device credential is encrypted with an Android Keystore AES/GCM key and is
 * never returned to JavaScript. Cloud registration is opt-in and idempotent.
 */
@CapacitorPlugin(name = "NexusDeviceIdentity")
public class NexusDeviceIdentityPlugin extends Plugin {
    private static final String PREFS = "nexus3d_device_identity";
    private static final String KEY_ALIAS = "nexus3d_device_identity_key_v1";
    private static final String ID = "installation_id";
    private static final String SECRET_IV = "credential_iv";
    private static final String SECRET_CIPHER = "credential_cipher";
    private static final String CONSENT = "cloud_diagnostics_consent";
    private static final String REGISTERED = "registered";
    private static final String SUPABASE_URL = "https://rupftghvjmalntjoesnv.supabase.co";
    private static final String SUPABASE_KEY = "sb_publishable_t3-BF5smZ21bzc59TVrYIw_4MHGG3Dq";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getOrCreateIdentity(PluginCall call) {
        try {
            Identity identity = loadOrCreate(getContext());
            JSObject result = new JSObject();
            result.put("deviceId", identity.installationId);
            result.put("registered", preferences().getBoolean(REGISTERED, false));
            result.put("cloudConsent", preferences().getBoolean(CONSENT, false));
            call.resolve(result);
            if (preferences().getBoolean(CONSENT, false) && !preferences().getBoolean(REGISTERED, false)) {
                executor.execute(() -> registerWithBackend(identity));
            }
        } catch (Exception error) {
            call.reject("Unable to create Nexus3D installation identity.", error);
        }
    }

    @PluginMethod
    public void setCloudDiagnosticsConsent(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        try {
            preferences().edit().putBoolean(CONSENT, enabled).apply();
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            if (!enabled) {
                call.resolve(result);
                return;
            }
            Identity identity = loadOrCreate(getContext());
            executor.execute(() -> {
                try {
                    registerWithBackend(identity);
                    JSObject response = new JSObject();
                    response.put("enabled", true);
                    response.put("registered", preferences().getBoolean(REGISTERED, false));
                    call.resolve(response);
                } catch (Exception error) {
                    call.reject("Cloud registration will retry when the app is opened online.", error);
                }
            });
        } catch (Exception error) {
            call.reject("Unable to update diagnostics consent.", error);
        }
    }


    @PluginMethod
    public void requestCloudConsent(PluginCall call) {
        SharedPreferences prefs = preferences();
        if (prefs.getBoolean("consent_decided", false)) {
            boolean enabled = prefs.getBoolean(CONSENT, false);
            if (enabled) {
                try {
                    Identity identity = loadOrCreate(getContext());
                    executor.execute(() -> registerWithBackend(identity));
                } catch (Exception error) {
                    android.util.Log.w("NexusDeviceIdentity", "Identity initialization deferred.", error);
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
            .setMessage("Allow Nexus3D to register a random installation ID and share limited technical information (device manufacturer/model, Android version, app version/build and connection timestamps) with Nexus3D Diagnostics? No files, contacts, GPS, IMEI or personal account data are collected. You can change this choice later in Diagnostics settings.")
            .setPositiveButton("Allow", (dialog, which) -> {
                prefs.edit().putBoolean(CONSENT, true).putBoolean("consent_decided", true).apply();
                try {
                    Identity identity = loadOrCreate(getContext());
                    executor.execute(() -> registerWithBackend(identity));
                } catch (Exception error) {
                    android.util.Log.w("NexusDeviceIdentity", "Registration deferred.", error);
                }
                JSObject result = new JSObject();
                result.put("enabled", true);
                result.put("alreadyDecided", false);
                call.resolve(result);
            })
            .setNegativeButton("Not now", (dialog, which) -> {
                prefs.edit().putBoolean(CONSENT, false).putBoolean("consent_decided", true).apply();
                JSObject result = new JSObject();
                result.put("enabled", false);
                result.put("alreadyDecided", false);
                call.resolve(result);
            })
            .setCancelable(false)
            .show());
    }

    private Identity loadOrCreate(Context context) throws Exception {
        SharedPreferences prefs = preferences();
        String installationId = prefs.getString(ID, null);
        String credential = decryptCredential(prefs);
        if (installationId != null && credential != null) return new Identity(installationId, credential);

        installationId = UUID.randomUUID().toString();
        byte[] secret = new byte[32];
        new SecureRandom().nextBytes(secret);
        credential = toHex(secret);
        encryptCredential(prefs, credential);
        prefs.edit().putString(ID, installationId).putBoolean(REGISTERED, false).apply();
        return new Identity(installationId, credential);
    }

    private void registerWithBackend(Identity identity) {
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject();
            body.put("installationId", identity.installationId);
            body.put("deviceCode", identity.credential);
            body.put("appVersion", getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName);
            android.content.pm.PackageInfo packageInfo = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long installedVersionCode = Build.VERSION.SDK_INT >= 28
                    ? packageInfo.getLongVersionCode()
                    : packageInfo.versionCode;
            body.put("versionCode", installedVersionCode);
            body.put("buildNumber", installedVersionCode);
            JSONObject info = new JSONObject();
            info.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
            info.put("model", Build.MODEL == null ? "" : Build.MODEL);
            info.put("androidVersion", Build.VERSION.RELEASE == null ? "" : Build.VERSION.RELEASE);
            body.put("deviceInfo", info);

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
            StringBuilder response = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) response.append(line);
                }
            }
            if (status >= 200 && status < 300) {
                preferences().edit().putBoolean(REGISTERED, true).apply();
            } else {
                android.util.Log.w("NexusDeviceIdentity", "Automatic registration pending: HTTP " + status);
            }
        } catch (Exception error) {
            android.util.Log.w("NexusDeviceIdentity", "Automatic registration deferred until next launch.", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
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
        prefs.edit().putString(SECRET_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString(SECRET_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP)).apply();
    }

    private String decryptCredential(SharedPreferences prefs) throws Exception {
        String ivValue = prefs.getString(SECRET_IV, null);
        String cipherValue = prefs.getString(SECRET_CIPHER, null);
        if (ivValue == null || cipherValue == null) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                new GCMParameterSpec(128, Base64.decode(ivValue, Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(cipherValue, Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }

    private static final class Identity {
        final String installationId;
        final String credential;
        Identity(String id, String secret) { installationId = id; credential = secret; }
    }
}
