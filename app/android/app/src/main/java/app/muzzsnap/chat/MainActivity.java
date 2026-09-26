package app.muzzsnap.chat;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private String pendingAuth = null;
    private int authAttempts = 0;

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null) setIntent(intent);
        deliverAuth(intent);
    }

    private void deliverAuth(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (!"muzzsnap".equals(data.getScheme()) || !"auth".equals(data.getHost())) return;
        String token = data.getQueryParameter("token");
        if (token == null || token.isEmpty()) return;
        pendingAuth = token;
        authAttempts = 0;
        intent.setData(null);
        setIntent(intent);
        pushAuth();
    }

    private void pushAuth() {
        final String token = pendingAuth;
        if (token == null || token.isEmpty()) return;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (pendingAuth == null) return;
            Bridge bridge = getBridge();
            if (bridge == null || bridge.getWebView() == null) {
                if (authAttempts < 25) {
                    authAttempts += 1;
                    pushAuth();
                }
                return;
            }
            String quoted = JSONObject.quote(token);
            String js = "try{if(sessionStorage.getItem('muzz_auth_done')===" + quoted + "){}"
                + "else{sessionStorage.setItem('muzz_auth_token'," + quoted + ");"
                + "if(window.muzzAcceptAuth){window.muzzAcceptAuth(" + quoted + ");}"
                + "else if(!/login\\.html$/i.test(location.pathname||'')){location.replace('login.html');}}"
                + "}catch(e){}";
            bridge.eval(js, null);
            authAttempts += 1;
            if (authAttempts < 12) pushAuth();
        }, 350);
    }
}
