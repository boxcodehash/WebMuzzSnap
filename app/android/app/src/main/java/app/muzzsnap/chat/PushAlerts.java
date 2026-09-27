package app.muzzsnap.chat;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;

/**
 * Native FCM setup for the bundled WebView. Page scripts are not required
 * for the channel, the permission request, or obtaining a token.
 */
public final class PushAlerts {
    static final String TAG = "MuzzSnapPush";
    static final String CHANNEL_ID = "private";
    static final int PERMISSION_REQUEST = 41012;
    private static String token = "";
    private static boolean asked = false;

    private PushAlerts() {}

    static void ensureChannel(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Private messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("New private messages");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
        android.util.Log.i(TAG, "channel private importance=high");
    }

    static void askPermission(Activity activity) {
        if (activity == null) return;
        ensureChannel(activity);
        if (Build.VERSION.SDK_INT < 33) {
            inject(activity);
            return;
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            inject(activity);
            return;
        }
        if (asked) return;
        asked = true;
        android.util.Log.i(TAG, "request POST_NOTIFICATIONS");
        activity.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, PERMISSION_REQUEST);
    }

    static void refresh(Activity activity) {
        if (activity == null) return;
        ensureChannel(activity);
        inject(activity);
        if (token == null || token.isEmpty()) fetchToken(activity);
    }

    static void fetchToken(Context context) {
        if (context == null) return;
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null || task.getResult().isEmpty()) {
                Exception error = task.getException();
                String detail = error == null ? "empty" : error.getClass().getSimpleName();
                String message = error == null || error.getMessage() == null ? "" : error.getMessage();
                if (message.length() > 160) message = message.substring(0, 160);
                android.util.Log.w(TAG, "fcm token failed " + detail + (message.isEmpty() ? "" : " " + message));
                    return;
                }
                token = task.getResult();
                android.util.Log.i(TAG, "fcm token obtained len=" + token.length());
                if (context instanceof Activity) inject((Activity) context);
            });
        } catch (Throwable err) {
            android.util.Log.w(TAG, "fcm token failed " + err.getClass().getSimpleName());
        }
    }

    static void inject(Activity activity) {
        if (!(activity instanceof MainActivity)) return;
        WebView view = webView((MainActivity) activity);
        if (view == null) return;
        String permission = notificationPermission(activity);
        String js = "try{window.__muzzNativePushPermission=" + JSONObject.quote(permission) + ";"
            + (token == null || token.isEmpty() ? "" : "window.__muzzNativeFcmToken=" + JSONObject.quote(token) + ";")
            + "window.dispatchEvent(new Event('muzz-fcm-token'));}catch(e){}";
        view.post(() -> view.evaluateJavascript(js, null));
    }

    static void openFromTap(MainActivity activity, Intent intent) {
        if (activity == null || intent == null) return;
        Bundle extras = intent.getExtras();
        if (extras == null || extras.get("google.message_id") == null) return;
        String messageId = String.valueOf(extras.get("google.message_id"));
        if (messageId.equals(intent.getStringExtra("muzz_push_consumed"))) return;
        WebView view = webView(activity);
        if (view == null) return;
        intent.putExtra("muzz_push_consumed", messageId);
        String peer = extras.getString("peer");
        String url = "https://localhost/private.html";
        if (peer != null && peer.matches("(?i)0x[a-f0-9]{40}")) {
            url += "?peer=" + peer.toLowerCase(java.util.Locale.US);
        }
        final String target = url;
        android.util.Log.i(TAG, "push open private");
        view.postDelayed(() -> view.loadUrl(target), 700);
    }

    private static WebView webView(MainActivity activity) {
        if (activity.getBridge() == null) return null;
        return activity.getBridge().getWebView();
    }

    private static String notificationPermission(Context context) {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        int state = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS);
        return state == PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
    }
}
