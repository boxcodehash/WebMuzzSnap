package app.muzzsnap.chat;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Message;
import android.os.SystemClock;
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
    private static String lastStarted = "";
    private static long lastStartedAt = 0;

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
        + "function browserLink(url){"
        + "try{var u=new URL(String(url),location.href);"
        + "var path=(u.pathname||'').toLowerCase();"
        + "var q=(u.search||'').toLowerCase();"
        + "if(path.indexOf('/dapp')>=0||path.indexOf('/browse')>=0||path.indexOf('/open_url')>=0)return true;"
        + "if(q.indexOf('open_url=')>=0||q.indexOf('cb_url=')>=0||q.indexOf('dappurl=')>=0)return true;"
        + "return false;}catch(e){return false;}"
        + "}"
        + "function nativeWc(url){"
        + "try{var u=new URL(String(url),location.href);"
        + "var uri=u.searchParams.get('uri')||'';"
        + "if(uri.indexOf('wc:')!==0)return String(url);"
        + "var host=(u.hostname||'').toLowerCase();"
        + "var enc=encodeURIComponent(uri);"
        + "if(host==='metamask.app.link')return 'metamask://wc?uri='+enc;"
        + "if(host==='link.trustwallet.com')return 'trust://wc?uri='+enc;"
        + "if(host==='go.cb-w.com')return 'cbwallet://wc?uri='+enc;"
        + "if(host==='rnbwapp.com')return 'rainbow://wc?uri='+enc;"
        + "if(host==='phantom.app')return 'phantom://wc?uri='+enc;"
        + "}catch(e){}"
        + "return String(url);"
        + "}"
        + "function wrapped(url){"
        + "if(browserLink(url))return null;"
        + "url=nativeWc(url);"
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

    /** A popup that lands on login.html must not reload the page or the in-flight sign is lost. */
    public static boolean isLoginPage(Uri url) {
        if (url == null) return false;
        String path = url.getPath() == null ? "" : url.getPath();
        return path.endsWith("/login.html") || path.equals("login.html") || path.endsWith("/login");
    }

    public static boolean shouldLeaveWebView(Uri url) {
        if (url == null) return false;
        String scheme = scheme(url);
        if (scheme.isEmpty() || "muzzsnap".equals(scheme) || isInlineScheme(scheme)) return false;
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

    /** Wallet in-app browsers (/dapp/, /browse, open_url). These must never load. */
    public static boolean isInAppBrowserLink(Uri url) {
        if (url == null) return false;
        String path = url.getPath() == null ? "" : url.getPath().toLowerCase(Locale.US);
        String query = url.getQuery() == null ? "" : url.getQuery().toLowerCase(Locale.US);
        if (path.contains("/dapp") || path.contains("/browse") || path.contains("/open_url")) return true;
        if (query.contains("open_url=") || query.contains("cb_url=") || query.contains("dappurl=")) return true;
        return false;
    }

    /**
     * Universal /wc links become wallet-native schemes. A browser link without a
     * wc: URI is dropped so the WebView stays on the APK.
     */
    public static Uri preferNativeWallet(Uri url) {
        if (url == null) return null;
        if (isInAppBrowserLink(url)) {
            String buried = url.getQueryParameter("uri");
            if (buried == null || !buried.startsWith("wc:")) return null;
            return Uri.parse("metamask://wc?uri=" + Uri.encode(buried));
        }
        String scheme = scheme(url);
        if (!"http".equals(scheme) && !"https".equals(scheme)) return url;
        String uri = url.getQueryParameter("uri");
        if (uri == null || !uri.startsWith("wc:")) return url;
        String enc = Uri.encode(uri);
        String host = host(url);
        if ("metamask.app.link".equals(host)) return Uri.parse("metamask://wc?uri=" + enc);
        if ("link.trustwallet.com".equals(host)) return Uri.parse("trust://wc?uri=" + enc);
        if ("go.cb-w.com".equals(host)) return Uri.parse("cbwallet://wc?uri=" + enc);
        if ("rnbwapp.com".equals(host)) return Uri.parse("rainbow://wc?uri=" + enc);
        if ("phantom.app".equals(host)) return Uri.parse("phantom://wc?uri=" + enc);
        return url;
    }

    public static boolean start(Context context, Uri url) {
        if (context == null || url == null) return false;
        Uri target = preferNativeWallet(url);
        if (target == null) {
            Log.i(TAG, "blocked in-app browser " + url);
            return false;
        }
        url = target;
        String key = url.toString();
        long now = SystemClock.uptimeMillis();
        if (key.equals(lastStarted) && now - lastStartedAt < 800) return true;
        lastStarted = key;
        lastStartedAt = now;
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
                else if (target != null && !isLoginPage(target)) parent.loadUrl(target.toString());
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

    private static boolean isInlineScheme(String scheme) {
        return "about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme) || "javascript".equals(scheme);
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
