package com.nexus3d.studio.test;

import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NexusDiagnosticsBridge")
public class NexusDiagnosticsBridgePlugin extends Plugin {
    private static final int MAX_BATCH_EVENTS = 20;
    private static final int MAX_PAYLOAD_CHARS = 128 * 1024;

    @PluginMethod
    public void sendEvents(PluginCall call) {
        JSArray events = call.getArray("events");
        if (events == null || events.length() < 1 || events.length() > MAX_BATCH_EVENTS) {
            call.reject("Diagnostic batch must contain 1-" + MAX_BATCH_EVENTS + " events");
            return;
        }
        String payload = events.toString();
        if (payload == null || payload.length() > MAX_PAYLOAD_CHARS) {
            call.reject("Diagnostic batch exceeds the IPC payload limit");
            return;
        }

        String[] authorities = {
            "com.nexus3d.diagnostics.debug.bridge",
            "com.nexus3d.diagnostics.bridge"
        };
        Exception lastError = null;
        for (String authority : authorities) {
            try {
                Bundle extras = new Bundle();
                extras.putString("eventsJson", payload);
                Uri uri = Uri.parse("content://" + authority);
                Bundle response = getContext().getContentResolver().call(uri, "ingestBatch", null, extras);
                if (response != null && response.getBoolean("ok", false)) {
                    JSObject result = new JSObject();
                    result.put("accepted", response.getInt("accepted", 0));
                    result.put("destination", authority);
                    call.resolve(result);
                    return;
                }
                lastError = new IllegalStateException("Diagnostics provider returned no successful acknowledgement");
            } catch (Exception error) {
                lastError = error;
            }
        }
        call.reject("Nexus3D Diagnostics is not installed or rejected the event batch: "
            + (lastError == null ? "no provider response" : lastError.getMessage()), lastError);
    }
}
