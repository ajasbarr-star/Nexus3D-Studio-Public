package com.nexus3d.studio.test;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.content.Context;
import android.content.ContentValues;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.ByteArrayOutputStream;
import java.io.BufferedWriter;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NexusProjectFiles")
public class NexusProjectFilesPlugin extends Plugin {
    private static final String PREFS = "nexus_project_file_destinations";
    // SAF providers can be slow; keep project staging, writes, and verification off the UI thread.
    private final ExecutorService projectIo = Executors.newSingleThreadExecutor();

    /** Clears only temporary WebView and app cache files. User projects and app data are preserved. */
    @PluginMethod
    public void clearAppCache(PluginCall call) {
        try {
            getBridge().getWebView().clearCache(true);
            long deletedBytes = deleteCacheContents(getContext().getCacheDir());
            JSObject response = new JSObject();
            response.put("cleared", true);
            response.put("deletedBytes", deletedBytes);
            response.put("message", "Temporary WebView cache cleared. Saved projects and app data were preserved.");
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to clear temporary cache: " + error.getMessage(), error);
        }
    }

    private long deleteCacheContents(java.io.File directory) {
        if (directory == null || !directory.isDirectory()) return 0L;
        long deletedBytes = 0L;
        java.io.File[] children = directory.listFiles();
        if (children == null) return 0L;
        for (java.io.File child : children) {
            if (child.isDirectory()) deletedBytes += deleteCacheContents(child);
            long length = child.isFile() ? child.length() : 0L;
            if (child.delete()) deletedBytes += length;
        }
        return deletedBytes;
    }


    /**
     * Stage the full project in durable app-private files before opening Android's picker.
     * The picker call then carries only a small staged-file reference, not the JSON.
     */
    @PluginMethod
    public void stageProject(PluginCall call) {
        String content = call.getString("content", "");
        if (content == null || content.trim().isEmpty()) {
            call.reject("Project data is empty; nothing was staged");
            return;
        }
        String stagedId = java.util.UUID.randomUUID().toString();
        java.io.File stagedFile = stagedProjectFile(stagedId);
        projectIo.execute(() -> {
            try {
                try (Writer writer = new BufferedWriter(new OutputStreamWriter(
                    new java.io.FileOutputStream(stagedFile, false), StandardCharsets.UTF_8), 32768)) {
                    writer.write(content);
                }
                if (!stagedFile.isFile() || stagedFile.length() == 0L) {
                    throw new IllegalStateException("Temporary project staging file is empty");
                }
                JSObject response = new JSObject();
                response.put("stagedId", stagedId);
                response.put("stagedBytes", stagedFile.length());
                call.resolve(response);
            } catch (Exception error) {
                if (stagedFile.exists()) stagedFile.delete();
                call.reject("Unable to stage project before opening the picker: " + error.getMessage(), error);
            }
        });
    }

    private java.io.File stagedProjectFile(String stagedId) {
        if (stagedId == null || !stagedId.matches("[0-9a-fA-F-]{36}")) {
            throw new IllegalArgumentException("Invalid temporary project reference");
        }
        return new java.io.File(getContext().getFilesDir(), "nexus-save-" + stagedId + ".tmp");
    }

    @PluginMethod
    public void saveProject(PluginCall call) {
        String fileName = call.getString("fileName", "Project.nexus");
        String stagedId = call.getString("stagedId", "");
        final java.io.File stagedFile;
        try {
            stagedFile = stagedProjectFile(stagedId);
        } catch (Exception error) {
            call.reject("Invalid staged project reference", error);
            return;
        }
        if (!stagedFile.isFile() || stagedFile.length() == 0L) {
            call.reject("Staged project is missing or empty; please save again");
            return;
        }

        // The pending Activity result call now contains only fileName + stagedId.
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String savedUri = prefs.getString("uri:" + fileName, null);
        if (savedUri != null) {
            Uri uri = Uri.parse(savedUri);
            projectIo.execute(() -> {
                try {
                    long writtenBytes = writeDocument(uri, stagedFile);
                    stagedFile.delete();
                    JSObject response = new JSObject();
                    response.put("writtenBytes", writtenBytes);
                    response.put("uri", uri.toString());
                    response.put("name", fileName);
                    response.put("overwritten", true);
                    call.resolve(response);
                } catch (Exception error) {
                    call.reject("Unable to verify overwrite of the existing project. The staged recovery file was retained. " + error.getMessage(), error);
                }
            });
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "handleSaveResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Save cancelled; staged project was retained for recovery");
            return;
        }
        Uri uri = result.getData().getData();
        String stagedId = call.getString("stagedId", "");
        String requestedName = call.getString("fileName", "Project.nexus");
        final java.io.File stagedFile;
        try {
            stagedFile = stagedProjectFile(stagedId);
        } catch (Exception error) {
            call.reject("Invalid staged project reference", error);
            return;
        }
        if (!stagedFile.isFile() || stagedFile.length() == 0L) {
            call.reject("Staged project is missing or empty; no destination was written");
            return;
        }
        int resultFlags = result.getData().getFlags();
        int flags = resultFlags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        boolean permissionPersisted = false;
        if ((resultFlags & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0 && flags != 0) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
                permissionPersisted = true;
            } catch (Exception ignored) {
                // Do not store a URI that may stop working after this app session.
            }
        }
        final boolean persistPermission = permissionPersisted;
        projectIo.execute(() -> {
            try {
                long writtenBytes = writeDocument(uri, stagedFile);
                SharedPreferences.Editor destinationEditor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
                if (persistPermission) destinationEditor.putString("uri:" + requestedName, uri.toString());
                else destinationEditor.remove("uri:" + requestedName);
                destinationEditor.apply();
                stagedFile.delete();

                JSObject response = new JSObject();
                response.put("uri", uri.toString());
                response.put("name", fileNameFromUri(uri));
                response.put("overwritten", false);
                response.put("writtenBytes", writtenBytes);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Unable to save project; staged recovery file was retained: " + error.getMessage(), error);
            }
        });
    }

    /** Streams staged private data to SAF and verifies the exact saved bytes. */
    private long writeDocument(Uri uri, java.io.File stagedFile) throws Exception {
        if (stagedFile == null || !stagedFile.isFile() || stagedFile.length() == 0L) {
            throw new IllegalArgumentException("Staged project file is missing or empty");
        }
        MessageDigest expectedDigest = MessageDigest.getInstance("SHA-256");
        long sourceBytes = 0L;
        try (InputStream source = new java.io.BufferedInputStream(new java.io.FileInputStream(stagedFile));
             OutputStream rawOutput = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (rawOutput == null) throw new IllegalStateException("Unable to open selected destination");
            DigestOutputStream digestOutput = new DigestOutputStream(rawOutput, expectedDigest);
            byte[] buffer = new byte[32768];
            int count;
            while ((count = source.read(buffer)) != -1) {
                digestOutput.write(buffer, 0, count);
                sourceBytes += count;
            }
            digestOutput.flush();
        }
        byte[] expectedHash = expectedDigest.digest();
        MessageDigest actualDigest = MessageDigest.getInstance("SHA-256");
        long verifiedBytes = 0L;
        try (InputStream rawInput = getContext().getContentResolver().openInputStream(uri)) {
            if (rawInput == null) throw new IllegalStateException("Saved project could not be reopened for verification");
            try (DigestInputStream input = new DigestInputStream(rawInput, actualDigest)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) verifiedBytes += count;
            }
        }
        if (sourceBytes != verifiedBytes || !MessageDigest.isEqual(expectedHash, actualDigest.digest())) {
            throw new IllegalStateException("Saved project verification failed: file contents do not match staged data");
        }
        if (verifiedBytes == 0L) throw new IllegalStateException("Saved project verification failed: destination is empty");
        return verifiedBytes;
    }

    @PluginMethod
    public void saveProjectArchive(PluginCall call) {
        String fileName = call.getString("fileName", "Nexus3D_Project.zip");
        String base64 = call.getString("base64", "");
        if (base64 == null || base64.trim().isEmpty()) {
            call.reject("Project archive is empty");
            return;
        }

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String savedUri = prefs.getString("zip:" + fileName, null);
        if (savedUri != null) {
            try {
                Uri uri = Uri.parse(savedUri);
                long writtenBytes = writeArchiveDocument(uri, base64);
                JSObject response = new JSObject();
                response.put("uri", uri.toString());
                response.put("name", fileName);
                response.put("overwritten", true);
                response.put("writtenBytes", writtenBytes);
                call.resolve(response);
                return;
            } catch (Exception error) {
                // Preserve the known destination and surface the failure instead of
                // silently creating a second archive with a provider-generated suffix.
                call.reject("Unable to verify overwrite of the existing ZIP archive. The saved destination was retained; use a different archive name for Save As. " + error.getMessage(), error);
                return;
            }
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "handleArchiveSaveResult");
    }

    @ActivityCallback
    private void handleArchiveSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("ZIP export cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        String base64 = call.getString("base64", "");
        String requestedName = call.getString("fileName", "Nexus3D_Project.zip");
        try {
            int resultFlags = result.getData().getFlags();
            int flags = resultFlags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            boolean permissionPersisted = false;
            if ((resultFlags & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0 && flags != 0) {
                try {
                    getContext().getContentResolver().takePersistableUriPermission(uri, flags);
                    permissionPersisted = true;
                } catch (Exception ignored) {
                    // Do not store a URI that may stop working after this app session.
                }
            }
            long writtenBytes = writeArchiveDocument(uri, base64);
            SharedPreferences.Editor destinationEditor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            if (permissionPersisted) destinationEditor.putString("zip:" + requestedName, uri.toString());
            else destinationEditor.remove("zip:" + requestedName);
            destinationEditor.apply();

            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("name", fileNameFromUri(uri));
            response.put("overwritten", false);
            response.put("writtenBytes", writtenBytes);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to export project ZIP: " + error.getMessage(), error);
        }
    }

    /**
     * Writes the complete ZIP archive and verifies the exact bytes by reading
     * the selected document back before reporting a successful export.
     */
    private long writeArchiveDocument(Uri uri, String base64) throws Exception {
        byte[] expected = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
        if (expected.length == 0) throw new IllegalArgumentException("Project archive is empty");
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IllegalStateException("Unable to open selected ZIP destination");
            output.write(expected);
            output.flush();
        }

        long verifiedBytes = 0L;
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("Saved ZIP could not be reopened for verification");
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) != -1) {
                for (int i = 0; i < count; i++) {
                    if (verifiedBytes >= expected.length || buffer[i] != expected[(int) verifiedBytes]) {
                        throw new IllegalStateException("Saved ZIP verification failed: file contents do not match");
                    }
                    verifiedBytes++;
                }
            }
        }
        if (verifiedBytes != expected.length) {
            throw new IllegalStateException("Saved ZIP verification failed: expected "
                + expected.length + " bytes but read back " + verifiedBytes);
        }
        return verifiedBytes;
    }

    /**
     * Saves an RDS ZIP directly into the public Documents/Nexus3D folder on
     * Android 10+ using MediaStore scoped-storage APIs, then reads it back
     * byte-for-byte before resolving success to the web layer.
     */
    @PluginMethod
    public void saveRdsArchive(PluginCall call) {
        String fileName = call.getString("fileName", "");
        String base64 = call.getString("base64", "");
        if (fileName == null || !fileName.matches("[A-Za-z0-9_-]+_[0-9]{1,2}:[0-9]{2}(am|pm)_[0-9]{2}-[0-9]{2}-[0-9]{4}\\.zip")) {
            call.reject("Invalid RDS ZIP filename");
            return;
        }
        if (base64 == null || base64.trim().isEmpty()) {
            call.reject("RDS ZIP archive is empty");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Direct Documents/Nexus3D ZIP saving requires Android 10 or newer");
            return;
        }
        projectIo.execute(() -> {
            Uri uri = null;
            try {
                byte[] expected = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                if (expected.length == 0) throw new IllegalArgumentException("RDS ZIP archive is empty");
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "application/zip");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOCUMENTS + "/Nexus3D");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                uri = getContext().getContentResolver().insert(
                    MediaStore.Files.getContentUri("external"), values);
                if (uri == null) throw new IllegalStateException("Android could not create Documents/Nexus3D ZIP destination");
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                    if (output == null) throw new IllegalStateException("Unable to open Documents/Nexus3D ZIP destination");
                    output.write(expected);
                    output.flush();
                }
                long verifiedBytes = 0L;
                try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IllegalStateException("Saved RDS ZIP could not be reopened for verification");
                    byte[] buffer = new byte[16384];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        for (int i = 0; i < count; i++) {
                            if (verifiedBytes >= expected.length || buffer[i] != expected[(int) verifiedBytes]) {
                                throw new IllegalStateException("RDS ZIP verification failed: saved bytes do not match");
                            }
                            verifiedBytes++;
                        }
                    }
                }
                if (verifiedBytes != expected.length || verifiedBytes == 0L) {
                    throw new IllegalStateException("RDS ZIP verification failed: expected " + expected.length + " bytes but read " + verifiedBytes);
                }
                ContentValues publish = new ContentValues();
                publish.put(MediaStore.MediaColumns.IS_PENDING, 0);
                if (getContext().getContentResolver().update(uri, publish, null, null) != 1) {
                    throw new IllegalStateException("RDS ZIP was written but could not be published in Documents/Nexus3D");
                }
                JSObject response = new JSObject();
                response.put("uri", uri.toString());
                response.put("name", fileName);
                response.put("writtenBytes", verifiedBytes);
                response.put("path", "Documents/Nexus3D/" + fileName);
                call.resolve(response);
            } catch (Exception error) {
                if (uri != null) {
                    try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) { }
                }
                call.reject("Unable to save and verify RDS ZIP in Documents/Nexus3D: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void loadProject(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream", "application/json", "text/plain"});
        startActivityForResult(call, intent, "handleLoadResult");
    }

    @ActivityCallback
    private void handleLoadResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Load cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Unable to read selected project");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String content = new String(output.toByteArray(), StandardCharsets.UTF_8);
            JSObject response = new JSObject();
            response.put("content", content);
            response.put("name", fileNameFromUri(uri));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to load project: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void loadProjectArchive(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/octet-stream"});
        startActivityForResult(call, intent, "handleArchiveLoadResult");
    }

    @ActivityCallback
    private void handleArchiveLoadResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("ZIP load cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Unable to read selected ZIP archive");
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String base64 = android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP);
            JSObject response = new JSObject();
            response.put("base64", base64);
            response.put("name", fileNameFromUri(uri));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to load project ZIP: " + error.getMessage(), error);
        }
    }

    private String fileNameFromUri(Uri uri) {
        String segment = uri.getLastPathSegment();
        if (segment == null || segment.trim().isEmpty()) return "Project.nexus";
        int slash = segment.lastIndexOf('/');
        return slash >= 0 ? segment.substring(slash + 1) : segment;
    }
}
