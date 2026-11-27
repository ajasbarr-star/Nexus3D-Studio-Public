package com.nexus3d.studio.test;

import android.content.Context;
import android.content.SharedPreferences;
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
