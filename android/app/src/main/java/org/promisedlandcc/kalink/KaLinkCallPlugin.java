package org.promisedlandcc.kalink;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Called from the Ka Link web code (lib/nativeShell.ts) when a call starts and ends. */
@CapacitorPlugin(name = "KaLinkCall")
public class KaLinkCallPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), KaLinkCallService.class);
            intent.putExtra(KaLinkCallService.EXTRA_TITLE, call.getString("title", "Live Ka Link"));
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not keep the Ka Link going in the background", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), KaLinkCallService.class));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        getContext().stopService(new Intent(getContext(), KaLinkCallService.class));
    }
}
