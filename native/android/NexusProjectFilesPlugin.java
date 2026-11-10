package com.nexus3d.studio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
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
    @PluginMethod
    public void saveProject(PluginCall call) {
        String fileName = call.getString("fileName", "Project.nexus");
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
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IllegalStateException("Unable to open selected destination");
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("name", fileNameFromUri(uri));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to save project: " + error.getMessage(), error);
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

    private String fileNameFromUri(Uri uri) {
        String segment = uri.getLastPathSegment();
        if (segment == null || segment.trim().isEmpty()) return "Project.nexus";
        int slash = segment.lastIndexOf('/');
        return slash >= 0 ? segment.substring(slash + 1) : segment;
    }
}
