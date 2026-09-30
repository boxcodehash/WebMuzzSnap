package app.muzzsnap.chat;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.pm.PackageInfoCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/**
 * Asks Android users to install a newer APK. The dialog is on the activity,
 * so it shows on the login screen as well as chat. Offline failures stay quiet
 * unless the user tapped Check for updates.
 */
public final class UpdateChecker {
    public static final String VERSION_URL = "https://muzzsnap-apk-dl.vercel.app/version.json";
    private static final long DEBOUNCE_MS = 30_000L;
    private static final int MAX_BODY = 65536;
    private static final AtomicBoolean inFlight = new AtomicBoolean(false);
    private static AlertDialog dialog;
    private static boolean laterDismissed = false;
    private static boolean resumeAfterLater = false;
    private static final int MAX_FOCUS_WAITS = 24;
    private static long lastFetchAt = 0L;
    private static JSONObject pending = null;
    private static boolean announceCurrent = false;
    private static int focusWaits = 0;

    private UpdateChecker() {}

    public static void onForeground(Activity activity) {
        check(activity, false);
    }

    /** Menu item. Always hits the network and says so when this build is current. */
    public static void checkNow(Activity activity) {
        check(activity, true);
    }

    private static void check(Activity activity, boolean manual) {
        if (activity == null || activity.isFinishing()) return;
        if (manual) {
            laterDismissed = false;
            resumeAfterLater = false;
            announceCurrent = true;
            android.util.Log.i(WalletLinks.TAG, "update manual");
        } else if (laterDismissed && !resumeAfterLater) {
            return;
        } else if (resumeAfterLater) {
            laterDismissed = false;
            resumeAfterLater = false;
        }
        String url = resolveUrl(activity);
        boolean debugUrl = !VERSION_URL.equals(url);
        long now = SystemClock.elapsedRealtime();
        boolean debounced = !manual && !debugUrl && lastFetchAt > 0L && now - lastFetchAt < DEBOUNCE_MS;
        if (debounced) {
            android.util.Log.i(WalletLinks.TAG, "update debounce");
            if (pending != null) present(activity, pending, announceCurrent);
            return;
        }
        if (!inFlight.compareAndSet(false, true)) {
            if (manual) announceCurrent = true;
            return;
        }
        lastFetchAt = now;
        focusWaits = 0;
        android.util.Log.i(WalletLinks.TAG, "update check");
        new Thread(() -> {
            try {
                JSONObject json = new JSONObject(httpGet(url));
                pending = json;
                new Handler(Looper.getMainLooper()).post(() -> present(activity, json, announceCurrent));
            } catch (Exception err) {
                android.util.Log.i(WalletLinks.TAG, "update skip");
                new Handler(Looper.getMainLooper()).post(() -> {
                    if (announceCurrent) showNote(activity, "Couldn't check for updates.");
                });
            } finally {
                inFlight.set(false);
            }
        }, "muzz-update").start();
    }

    public static void onPause() {
        if (laterDismissed) resumeAfterLater = true;
    }

    /** Cold start often finishes the fetch before the window is focused. */
    public static void onWindowReady(Activity activity) {
        if (activity == null || !activity.hasWindowFocus() || pending == null) return;
        if (dialog != null && dialog.isShowing()) return;
        focusWaits = 0;
        present(activity, pending, announceCurrent);
    }

    private static String resolveUrl(Activity activity) {
        boolean debuggable = (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable || activity.getIntent() == null) return VERSION_URL;
        String extra = activity.getIntent().getStringExtra("muzz_version_url");
        if (extra == null || extra.length() > 200) return VERSION_URL;
        if (extra.startsWith("https://") || extra.startsWith("http://")) return extra;
        return VERSION_URL;
    }

    private static void present(Activity activity, JSONObject json, boolean announce) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        if (!activity.hasWindowFocus()) {
            pending = json;
            if (announce) announceCurrent = true;
            if (focusWaits == 0) android.util.Log.i(WalletLinks.TAG, "update wait");
            if (focusWaits < MAX_FOCUS_WAITS) {
                focusWaits++;
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (activity.isFinishing() || activity.isDestroyed() || pending == null) return;
                    if (dialog != null && dialog.isShowing()) return;
                    present(activity, pending, announceCurrent);
                }, 500);
            }
            return;
        }
        if (dialog != null && dialog.isShowing()) return;
        focusWaits = 0;
        announceCurrent = false;
        int remote = json == null ? 0 : json.optInt("versionCode", 0);
        long installed = installedCode(activity);
        android.util.Log.i(WalletLinks.TAG, "update remote=" + remote + " installed=" + installed);
        if (remote <= installed) {
            pending = null;
            dismissDialog();
            android.util.Log.i(WalletLinks.TAG, "update current");
            if (announce) showNote(activity, "You're up to date (v" + installedName(activity, json) + ")");
            return;
        }
        String name = json.optString("versionName", "").trim();
        if (name.isEmpty()) name = String.valueOf(remote);
        String notes = json.optString("notes", "").replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").trim();
        if (notes.length() > 400) notes = notes.substring(0, 400);
        String apk = json.optString("apkUrl", "").trim();
        if (!apk.startsWith("https://") && !apk.startsWith("http://")) {
            pending = null;
            android.util.Log.i(WalletLinks.TAG, "update skip");
            return;
        }
        boolean force = json.optBoolean("force", false);
        if (dialog != null && dialog.isShowing()) return;
        String message = "MuzzSnap " + name + " is ready.";
        if (!notes.isEmpty()) message = message + "\n\n" + notes;
        final String apkUrl = apk;
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage(message)
            .setPositiveButton("Update", (d, which) -> openApk(activity, apkUrl));
        if (!force) {
            builder.setNegativeButton("Later", (d, which) -> { laterDismissed = true; });
            builder.setOnCancelListener(d -> { laterDismissed = true; });
        } else {
            builder.setCancelable(false);
        }
        try {
            dialog = builder.create();
            if (force) {
                dialog.setCancelable(false);
                dialog.setCanceledOnTouchOutside(false);
            }
            pending = null;
            dialog.show();
            if (dialog.getButton(AlertDialog.BUTTON_POSITIVE) != null) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setAllCaps(false);
            }
            if (dialog.getButton(AlertDialog.BUTTON_NEGATIVE) != null) {
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setAllCaps(false);
            }
            android.util.Log.i(WalletLinks.TAG, "update dialog");
        } catch (Exception err) {
            android.util.Log.i(WalletLinks.TAG, "update skip");
        }
    }

    private static void showNote(Activity activity, String message) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed() || message == null) return;
        announceCurrent = false;
        pending = null;
        dismissDialog();
        try {
            dialog = new AlertDialog.Builder(activity)
                .setMessage(message)
                .setPositiveButton("OK", null)
                .create();
            dialog.show();
            if (dialog.getButton(AlertDialog.BUTTON_POSITIVE) != null) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setAllCaps(false);
            }
            android.util.Log.i(WalletLinks.TAG, "update note");
        } catch (Exception err) {
            android.util.Log.i(WalletLinks.TAG, "update skip");
        }
    }

    private static String installedName(Activity activity, JSONObject json) {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            String name = info.versionName == null ? "" : info.versionName.trim();
            if (name.startsWith("v") || name.startsWith("V")) name = name.substring(1);
            if (!name.isEmpty()) return name;
        } catch (Exception ignored) {
            /* fall through to the remote name */
        }
        String remote = json == null ? "" : json.optString("versionName", "").trim();
        if (remote.startsWith("v") || remote.startsWith("V")) remote = remote.substring(1);
        if (!remote.isEmpty()) return remote;
        return String.valueOf(installedCode(activity));
    }

    private static void dismissDialog() {
        if (dialog == null) return;
        try {
            dialog.dismiss();
        } catch (Exception ignored) {
            /* the window may already be gone */
        }
        dialog = null;
    }

    private static void openApk(Activity activity, String apkUrl) {
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl));
            view.addCategory(Intent.CATEGORY_BROWSABLE);
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(view);
        } catch (Exception err) {
            android.util.Log.i(WalletLinks.TAG, "update skip");
        }
    }

    private static long installedCode(Activity activity) {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return PackageInfoCompat.getLongVersionCode(info);
        } catch (Exception err) {
            return 0L;
        }
    }

    private static String httpGet(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        conn.setUseCaches(false);
        conn.setRequestProperty("Cache-Control", "no-cache");
        conn.setRequestProperty("Pragma", "no-cache");
        conn.setRequestProperty("Accept", "application/json");
        try {
            int status = conn.getResponseCode();
            if (status != 200) throw new java.io.IOException("http " + status);
            InputStream input = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int total = 0;
            int n;
            while ((n = input.read(buf)) >= 0 && total < MAX_BODY) {
                int take = Math.min(n, MAX_BODY - total);
                out.write(buf, 0, take);
                total += take;
            }
            input.close();
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            conn.disconnect();
        }
    }
}
