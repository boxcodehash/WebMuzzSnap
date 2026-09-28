package app.muzzsnap.chat;

import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Capacitor's WebView would load wc:, metamask:// and wallet universal links
 * itself. That navigation fails, the screen flickers, and the wallet list stays.
 * This client sends those URLs out as ACTION_VIEW and leaves the page in place.
 */
public class WalletWebViewClient extends WebViewClient {
    private final WebViewClient delegate;

    public WalletWebViewClient(WebViewClient delegate) {
        this.delegate = delegate;
    }

    private boolean handoff(WebView view, Uri url) {
        if (view == null || url == null) return false;
        if (!WalletLinks.shouldLeaveWebView(url) && !WalletLinks.isAppReturn(url)) return false;
        android.util.Log.i(WalletLinks.TAG, "webview-handoff " + url);
        WalletLinks.start(view.getContext(), url);
        view.stopLoading();
        return true;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request != null && handoff(view, request.getUrl())) return true;
        if (request != null && sameLoginNavigation(view, request.getUrl())) return true;
        if (delegate != null) return delegate.shouldOverrideUrlLoading(view, request);
        return false;
    }

    /** Returning from the wallet must not load login.html again. That drops the signature request. */
    private boolean sameLoginNavigation(WebView view, Uri target) {
        if (view == null || !WalletLinks.isLoginPage(target)) return false;
        String current = view.getUrl();
        return current != null && current.contains("login.html");
    }

    @Override
    @SuppressWarnings("deprecation")
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (url != null && handoff(view, Uri.parse(url))) return true;
        if (url != null && sameLoginNavigation(view, Uri.parse(url))) return true;
        if (delegate != null) return delegate.shouldOverrideUrlLoading(view, url);
        return false;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (delegate != null) return delegate.shouldInterceptRequest(view, request);
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        if (url != null && handoff(view, Uri.parse(url))) return;
        if (delegate != null) delegate.onPageStarted(view, url, favicon);
        else super.onPageStarted(view, url, favicon);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        if (delegate != null) delegate.onPageFinished(view, url);
        else super.onPageFinished(view, url);
        android.content.Context context = view == null ? null : view.getContext();
        while (context instanceof android.content.ContextWrapper
            && !(context instanceof android.app.Activity)) {
            context = ((android.content.ContextWrapper) context).getBaseContext();
        }
        if (context instanceof android.app.Activity) PushAlerts.inject((android.app.Activity) context);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        if (delegate != null) delegate.onReceivedHttpError(view, request, errorResponse);
        else super.onReceivedHttpError(view, request, errorResponse);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        Uri url = request == null ? null : request.getUrl();
        if (request != null && request.isForMainFrame()
            && (WalletLinks.shouldLeaveWebView(url) || WalletLinks.isAppReturn(url))) {
            return;
        }
        if (delegate != null) delegate.onReceivedError(view, request, error);
        else super.onReceivedError(view, request, error);
    }

    @Override
    public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
        if (delegate != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return delegate.onRenderProcessGone(view, detail);
        }
        return true;
    }
}
