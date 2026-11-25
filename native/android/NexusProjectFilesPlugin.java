package com.nexus3d.studio.test;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
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


    @PluginMethod
    public void saveProject(PluginCall call) {
        String fileName = call.getString("fileName", "Project.nexus");
        String content = call.getString("content", "");
        if (content == null || content.trim().isEmpty()) {
            call.reject("Project data is empty; nothing was saved");
            return;
        }

        // Reuse the exact document URI selected on the first save. ACTION_CREATE_DOCUMENT
        // creates a new "(1)" copy on many Android providers instead of replacing the old file.
        // Writing to the persisted URI updates the same file and avoids opening the picker again.
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String savedUri = prefs.getString("uri:" + fileName, null);
        if (savedUri != null) {
            try {
                Uri uri = Uri.parse(savedUri);
                long writtenBytes = writeDocument(uri, content);
                JSObject response = new JSObject();
                response.put("writtenBytes", writtenBytes);
                response.put("uri", uri.toString());
                response.put("name", fileName);
                response.put("overwritten", true);
                call.resolve(response);
                return;
            } catch (Exception error) {
                // Do not silently discard the saved destination and create a duplicate.
                // The existing document may need recovery if the provider failed mid-write.
                call.reject("Unable to verify overwrite of the existing project. The saved destination was retained; use a different project name for Save As. " + error.getMessage(), error);
                return;
            }
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
            call.reject("Save cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        String content = call.getString("content", "");
        String requestedName = call.getString("fileName", "Project.nexus");
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
            long writtenBytes = writeDocument(uri, content);
            SharedPreferences.Editor destinationEditor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            if (permissionPersisted) destinationEditor.putString("uri:" + requestedName, uri.toString());
            else destinationEditor.remove("uri:" + requestedName);
            destinationEditor.apply();

            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("name", fileNameFromUri(uri));
            response.put("overwritten", false);
            response.put("writtenBytes", writtenBytes);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to save project: " + error.getMessage(), error);
        }
    }

    /**
     * Writes the complete UTF-8 project and verifies that the document provider
     * can read back the same bytes before the plugin reports success.
     */
    private long writeDocument(Uri uri, String content) throws Exception {
        if (content == null || content.trim().isEmpty()) {
            throw new IllegalArgumentException("Project data is empty; nothing was saved");
        }
        byte[] expected = content.getBytes(StandardCharsets.UTF_8);
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IllegalStateException("Unable to open selected destination");
            output.write(expected);
            output.flush();
        }

        long verifiedBytes = 0L;
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("Saved project could not be reopened for verification");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                for (int i = 0; i < count; i++) {
                    if (verifiedBytes >= expected.length || buffer[i] != expected[(int) verifiedBytes]) {
                        throw new IllegalStateException("Saved project verification failed: file contents do not match");
                    }
                    verifiedBytes++;
                }
            }
        }
        if (verifiedBytes != expected.length) {
            throw new IllegalStateException("Saved project verification failed: expected "
                + expected.length + " bytes but read back " + verifiedBytes);
        }
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
