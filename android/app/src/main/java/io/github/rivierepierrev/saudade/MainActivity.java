package io.github.rivierepierrev.saudade;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DavHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
