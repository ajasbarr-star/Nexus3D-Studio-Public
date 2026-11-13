package com.nexus3d.studio.phase1;

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
                writeDocument(uri, content);
                JSObject response = new JSObject();
                response.put("uri", uri.toString());
                response.put("name", fileName);
                response.put("overwritten", true);
                call.resolve(response);
                return;
            } catch (Exception error) {
                // The user may have revoked access or removed the file. Ask for a new destination.
                prefs.edit().remove("uri:" + fileName).apply();
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
            int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            } catch (Exception ignored) {
                // Some document providers grant access only for the current app session.
            }
            writeDocument(uri, content);
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString("uri:" + requestedName, uri.toString()).apply();

            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("name", fileNameFromUri(uri));
            response.put("overwritten", false);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to save project: " + error.getMessage(), error);
        }
    }

    private void writeDocument(Uri uri, String content) throws Exception {
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IllegalStateException("Unable to open selected destination");
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
        }
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
                writeArchiveDocument(uri, base64);
                JSObject response = new JSObject();
                response.put("uri", uri.toString());
                response.put("name", fileName);
                response.put("overwritten", true);
                call.resolve(response);
                return;
            } catch (Exception error) {
                prefs.edit().remove("zip:" + fileName).apply();
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
            int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            } catch (Exception ignored) {
                // Some document providers grant access only for the current app session.
            }
            writeArchiveDocument(uri, base64);
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString("zip:" + requestedName, uri.toString()).apply();

            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("name", fileNameFromUri(uri));
            response.put("overwritten", false);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to export project ZIP: " + error.getMessage(), error);
        }
    }

    private void writeArchiveDocument(Uri uri, String base64) throws Exception {
        byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IllegalStateException("Unable to open selected ZIP destination");
            output.write(bytes);
            output.flush();
        }
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
