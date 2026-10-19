package app.georomb;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // свой плагин регистрируется до super.onCreate — тогда он есть в window.Capacitor.Plugins с первого запуска
        registerPlugin(FolderAccessPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
