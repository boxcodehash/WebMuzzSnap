package app.muzzsnap.chat;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.Build;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.WebViewListener;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private String pendingAuth = null;
    private int authAttempts = 0;
    private long lastWalletReturnAt = 0;
    private boolean probedOpen = false;
    private boolean backHandlerLogged = false;
    private final OnBackPressedCallback systemBackCallback = new OnBackPressedCallback(true) {
        @Override
        public void handleOnBackPressed() {
            onSystemBack();
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WalletLinkPlugin.class);
        super.onCreate(savedInstanceState);
        installSystemBackHandler();
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        installWalletWebViewClient(webView);
        webView.getSettings().setSupportMultipleWindows(true);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                return WalletLinks.capturePopup(view, resultMsg);
            }
        });
        probeWebViewLoads(webView);
        maybeOpenDebugPage(getIntent());
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView view) {
                view.evaluateJavascript(WalletLinks.OPEN_HOOK, null);
                probeWalletOpen(view);
            }

            @Override
            public void onPageLoaded(WebView view) {
                view.evaluateJavascript(WalletLinks.OPEN_HOOK, null);
            }

            @Override
            public boolean onRenderProcessGone(WebView webView, android.webkit.RenderProcessGoneDetail detail) {
                return true;
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        installSystemBackHandler();
        if (WalletLinks.consumeReturn()) notifyWalletReturn();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null) setIntent(intent);
        maybeOpenDebugPage(intent);
        deliverAuth(intent);
        deliverWalletReturn(intent);
    }

    /**
     * Last callback wins, including Android 13+ predictive back.
     * Never finish the activity: close an overlay, go back inside the app, or minimize.
     */
    private void installSystemBackHandler() {
        systemBackCallback.remove();
        systemBackCallback.setEnabled(true);
        getOnBackPressedDispatcher().addCallback(this, systemBackCallback);
        if (!backHandlerLogged) {
            backHandlerLogged = true;
            android.util.Log.i(WalletLinks.TAG, "back handler installed");
        }
    }

    private void onSystemBack() {
        final WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            minimizeToBackground();
            return;
        }
        final boolean[] settled = { false };
        final Handler handler = new Handler(Looper.getMainLooper());
        final Runnable fallback = () -> {
            if (settled[0]) return;
            settled[0] = true;
            android.util.Log.i(WalletLinks.TAG, "back timeout");
            applyBackDecision(webView, "");
        };
        handler.postDelayed(fallback, 180);
        webView.evaluateJavascript(
            "(function(){try{if(window.muzzConsumeBack)return String(window.muzzConsumeBack());}catch(e){}return '';})()",
            value -> {
                if (settled[0]) return;
                settled[0] = true;
                handler.removeCallbacks(fallback);
                applyBackDecision(webView, value);
            }
        );
    }

    private void applyBackDecision(WebView webView, String raw) {
        String action = raw == null ? "" : raw.replace("\"", "").trim();
        if ("null".equals(action) || "undefined".equals(action)) action = "";
        if ("closed".equals(action)) {
            android.util.Log.i(WalletLinks.TAG, "back closed");
            return;
        }
        if ("back".equals(action) || (action.isEmpty() && isInAppHistoryPage(webView) && webView.canGoBack())) {
            if (webView.canGoBack()) {
                android.util.Log.i(WalletLinks.TAG, "back history");
                webView.goBack();
                return;
            }
        }
        minimizeToBackground();
    }

    private void minimizeToBackground() {
        android.util.Log.i(WalletLinks.TAG, "back minimize");
        moveTaskToBack(true);
    }

    /** private.html may return to chat. Chat and login stay put and minimize. */
    private boolean isInAppHistoryPage(WebView webView) {
        String url = webView.getUrl();
        if (url == null) return false;
        int cut = url.indexOf('?');
        if (cut >= 0) url = url.substring(0, cut);
        cut = url.indexOf('#');
        if (cut >= 0) url = url.substring(0, cut);
        return url.endsWith("/private.html") || url.endsWith("/private");
    }

    /** Debug builds only: adb can open chat.html when the renderer is not running page scripts. */
    private void maybeOpenDebugPage(Intent intent) {
        if (!isDebuggable() || intent == null) return;
        String page = intent.getStringExtra("muzz_page");
        if (page == null || !page.matches("[A-Za-z0-9._-]+\\.html")) return;
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        intent.removeExtra("muzz_page");
        String url = "https://localhost/" + page;
        android.util.Log.i(WalletLinks.TAG, "debug page " + url);
        webView.post(() -> webView.loadUrl(url));
    }

    private void installWalletWebViewClient(WebView webView) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        WebViewClient current = webView.getWebViewClient();
        if (current instanceof WalletWebViewClient) return;
        webView.setWebViewClient(new WalletWebViewClient(current));
        android.util.Log.i(WalletLinks.TAG, "WalletWebViewClient installed");
    }

    /** Debug builds only: adb asks the WebView itself to navigate to wallet URLs. */
    private void probeWebViewLoads(WebView webView) {
        String extra = getIntent() == null ? null : getIntent().getStringExtra("muzz_probe");
        if (!isDebuggable() || !"1".equals(extra)) return;
        android.util.Log.i(WalletLinks.TAG, "probe extra=" + extra + " debuggable=" + isDebuggable());
        String[] direct = new String[] {
            "metamask://wc?uri=wc:from-webview",
            "wc:from-webview@2?relay-protocol=irn&symKey=abc",
            "intent://wc#Intent;scheme=metamask;package=io.metamask;end",
            "https://link.trustwallet.com/wc?uri=wc:from-webview",
            "https://metamask.app.link/wc?uri=wc:from-webview"
        };
        for (String url : direct) WalletLinks.start(this, Uri.parse(url));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebViewClient client = webView.getWebViewClient();
            String[] viaClient = new String[] {
                "metamask://wc?uri=wc:from-client",
                "wc:from-client@2?relay-protocol=irn&symKey=abc",
                "intent://wc#Intent;scheme=trust;package=com.wallet.crypto.trustapp;end",
                "https://metamask.app.link/wc?uri=wc:from-client",
                "https://link.trustwallet.com/wc?uri=wc:from-client"
            };
            for (String url : viaClient) {
                android.util.Log.i(WalletLinks.TAG, "client-override " + url);
                if (client != null) client.shouldOverrideUrlLoading(webView, url);
            }
        }
        String[] scripts = new String[] {
            "location.assign(" + JSONObject.quote("metamask://wc?uri=wc:from-js") + ")",
            "window.open(" + JSONObject.quote("wc:from-js@2?relay-protocol=irn&symKey=abc") + ")",
            "window.open(" + JSONObject.quote("intent://wc#Intent;scheme=metamask;package=io.metamask;end") + ")",
            "window.open(" + JSONObject.quote("https://metamask.app.link/wc?uri=wc:from-js") + ")"
        };
        android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        for (int i = 0; i < scripts.length; i += 1) {
            final String script = scripts[i];
            handler.postDelayed(() -> {
                android.util.Log.i(WalletLinks.TAG, "eval " + script);
                webView.evaluateJavascript(script, value -> android.util.Log.i(WalletLinks.TAG, "eval-result " + value));
            }, 800L * (i + 1));
        }
    }

    /** Debug builds only: adb can ask the live page to call window.open. */
    private void probeWalletOpen(WebView view) {
        if (probedOpen || !isDebuggable() || getIntent() == null) return;
        String open = getIntent().getStringExtra("muzz_probe_open");
        String assign = getIntent().getStringExtra("muzz_probe_assign");
        if ((open == null || open.isEmpty()) && (assign == null || assign.isEmpty())) return;
        probedOpen = true;
        view.postDelayed(() -> {
            if (open != null && !open.isEmpty()) {
                String quoted = JSONObject.quote(open);
                view.evaluateJavascript("try{window.open(" + quoted + ");}catch(e){}", null);
            }
            if (assign != null && !assign.isEmpty()) {
                String quoted = JSONObject.quote(assign);
                view.evaluateJavascript("try{location.assign(" + quoted + ");}catch(e){}", null);
            }
        }, 400);
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private void deliverWalletReturn(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri data = intent.getData();
        if (!"muzzsnap".equals(data.getScheme()) || !"wc".equals(data.getHost())) return;
        intent.setData(null);
        setIntent(intent);
        notifyWalletReturn();
    }

    private void notifyWalletReturn() {
        long now = SystemClock.uptimeMillis();
        if (now - lastWalletReturnAt < 800) return;
        lastWalletReturnAt = now;
        android.util.Log.i(WalletLinks.TAG, "return muzzsnap://wc");
        Bridge bridge = getBridge();
        if (bridge == null) return;
        bridge.eval("try{window.dispatchEvent(new Event('muzz-wc-return'));}catch(e){}", null);
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
