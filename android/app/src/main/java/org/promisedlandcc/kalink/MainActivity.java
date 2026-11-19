package org.promisedlandcc.kalink;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KaLinkCallPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
