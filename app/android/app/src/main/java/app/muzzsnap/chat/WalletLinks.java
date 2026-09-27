package app.muzzsnap.chat;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Message;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.net.URISyntaxException;
import java.util.Locale;

/** Sends wallet links out of the Capacitor WebView as ACTION_VIEW. */
public final class WalletLinks {
    public static final String TAG = "MuzzSnapWallet";
    private static volatile boolean awaitingReturn = false;

    private WalletLinks() {}

    /**
     * AppKit calls window.open at click time. A WebView leaves custom schemes
     * and wallet universal links inside the page unless this runs first.
     */
    public static final String OPEN_HOOK = "(function(){"
        + "var current=window.open;"
        + "if(current&&current.__muzz)return;"
        + "function external(url){"
        + "try{var u=new URL(String(url),location.href);"
        + "var scheme=(u.protocol||'').replace(':','');"
        + "var host=(u.hostname||'').toLowerCase();"
        + "if(scheme==='http'||scheme==='https'){"
        + "if(host==='metamask.app.link'||host==='link.trustwallet.com'||host==='go.cb-w.com'||host==='rnbwapp.com')return true;"
        + "if(host==='phantom.app'&&u.pathname.indexOf('/ul/')===0)return true;"
        + "if((host==='www.okx.com'||host==='okx.com')&&(u.pathname.indexOf('/download')===0||u.search.indexOf('deeplink=')>=0))return true;"
        + "return false;}"
        + "if(scheme==='about'||scheme==='blob'||scheme==='data'||scheme==='javascript'||scheme==='muzzsnap')return false;"
        + "return scheme.length>0;"
        + "}catch(e){return false;}"
        + "}"
        + "function wrapped(url){"
        + "if(external(url)){"
        + "var href=String(url);"
        + "try{var Cap=window.Capacitor;"
        + "if(Cap&&typeof Cap.registerPlugin==='function'){Cap.registerPlugin('WalletLink').open({url:href});return null;}"
        + "}catch(e){}"
        + "try{location.href=href;}catch(e2){}"
        + "return null;}"
        + "if(current)return current.apply(window,arguments);"
        + "return null;}"
        + "wrapped.__muzz=true;"
        + "window.open=wrapped;"
        + "})();";

    public static boolean isAppReturn(Uri url) {
        return url != null && "muzzsnap".equals(scheme(url));
    }

    public static boolean shouldLeaveWebView(Uri url) {
        if (url == null) return false;
        String scheme = scheme(url);
        if (scheme.isEmpty() || isDocumentScheme(scheme) || "muzzsnap".equals(scheme)) return false;
        if (!"http".equals(scheme) && !"https".equals(scheme)) return true;
        return isWalletUniversalLink(url);
    }

    public static Intent externalView(Uri url) throws URISyntaxException {
        if (url != null && "intent".equals(scheme(url))) {
            Intent parsed = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
            parsed.setComponent(null);
            parsed.setSelector(null);
            parsed.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            parsed.addCategory(Intent.CATEGORY_BROWSABLE);
            if (parsed.getAction() == null) parsed.setAction(Intent.ACTION_VIEW);
            return parsed;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, url);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    public static boolean start(Context context, Uri url) {
        if (context == null || url == null) return false;
        try {
            Intent intent = externalView(url);
            Log.i(TAG, "ACTION_VIEW " + intent.getAction() + " data=" + intent.getDataString());
            context.startActivity(intent);
            if (!isAppReturn(url)) awaitingReturn = true;
            Log.i(TAG, "ACTION_VIEW started data=" + intent.getDataString());
            return true;
        } catch (ActivityNotFoundException ex) {
            Log.i(TAG, "ACTION_VIEW no-handler data=" + url);
            return startFallback(context, url);
        } catch (URISyntaxException | SecurityException ex) {
            Log.i(TAG, "ACTION_VIEW rejected data=" + url + " " + ex.getClass().getSimpleName());
            return false;
        }
    }

    public static boolean consumeReturn() {
        boolean pending = awaitingReturn;
        awaitingReturn = false;
        return pending;
    }

    public static boolean capturePopup(WebView parent, Message resultMsg) {
        if (parent == null || resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
        final Context context = parent.getContext();
        WebView popup = new WebView(context);
        popup.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (shouldLeaveWebView(target) || isAppReturn(target)) start(context, target);
                else if (target != null) parent.loadUrl(target.toString());
                return true;
            }
        });
        ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
        resultMsg.sendToTarget();
        return true;
    }

    private static boolean startFallback(Context context, Uri url) {
        if (url == null || !"intent".equals(scheme(url))) return false;
        try {
            Intent parsed = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
            String fallback = parsed.getStringExtra("browser_fallback_url");
            if (fallback == null || fallback.isEmpty()) return false;
            Uri next = Uri.parse(fallback);
            if (!shouldLeaveWebView(next)) return false;
            return start(context, next);
        } catch (URISyntaxException ex) {
            return false;
        }
    }

    private static boolean isDocumentScheme(String scheme) {
        return "http".equals(scheme) || "https".equals(scheme) || "about".equals(scheme)
            || "data".equals(scheme) || "blob".equals(scheme) || "javascript".equals(scheme);
    }

    private static boolean isWalletUniversalLink(Uri url) {
        String host = host(url);
        if ("metamask.app.link".equals(host) || "link.trustwallet.com".equals(host)
            || "go.cb-w.com".equals(host) || "rnbwapp.com".equals(host)) {
            return true;
        }
        String path = url.getPath() == null ? "" : url.getPath();
        if ("phantom.app".equals(host) && path.startsWith("/ul/")) return true;
        if (("www.okx.com".equals(host) || "okx.com".equals(host))
            && (path.startsWith("/download") || String.valueOf(url.getQuery()).contains("deeplink="))) {
            return true;
        }
        return false;
    }

    private static String scheme(Uri url) {
        String value = url.getScheme();
        return value == null ? "" : value.toLowerCase(Locale.US);
    }

    private static String host(Uri url) {
        String value = url.getHost();
        return value == null ? "" : value.toLowerCase(Locale.US);
    }
}
