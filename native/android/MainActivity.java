package com.nexus3d.studio;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

/**
 * Keep Nexus3D immersive on Android: hide both the status and navigation bars.
 * Swipe gestures from the screen edges can temporarily reveal system bars.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    private void applyImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }
}
