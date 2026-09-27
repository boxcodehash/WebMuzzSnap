package app.muzzsnap.chat;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.pm.PackageInfoCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Asks Android users to install a newer APK. Offline failures stay quiet. */
public final class UpdateChecker {
    public static final String VERSION_URL = "https://muzzsnap-apk-dl.vercel.app/version.json";
    private static final long INTERVAL_MS = 4L * 60L * 60L * 1000L;
    private static final int MAX_BODY = 65536;
    private static final AtomicBoolean inFlight = new AtomicBoolean(false);
    private static AlertDialog dialog;
    private static boolean laterDismissed = false;
    private static boolean resumeAfterLater = false;

    private UpdateChecker() {}

    public static void onForeground(Activity activity) {
        if (activity == null || activity.isFinishing()) return;
        if (laterDismissed && !resumeAfterLater) return;
        if (resumeAfterLater) {
            laterDismissed = false;
            resumeAfterLater = false;
        }
        String url = resolveUrl(activity);
        boolean debugUrl = !VERSION_URL.equals(url);
        if (!debugUrl && cacheIsFresh(activity)) {
            present(activity, cachedManifest(activity));
            return;
        }
        if (!inFlight.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                JSONObject json = new JSONObject(httpGet(url));
                if (!debugUrl) remember(activity, json);
                new Handler(Looper.getMainLooper()).postDelayed(() -> present(activity, json), 400);
            } catch (Exception err) {
                android.util.Log.i(WalletLinks.TAG, "update skip");
            } finally {
                inFlight.set(false);
            }
        }, "muzz-update").start();
    }

    public static void onPause() {
        if (laterDismissed) resumeAfterLater = true;
    }

    private static String resolveUrl(Activity activity) {
        boolean debuggable = (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable || activity.getIntent() == null) return VERSION_URL;
        String extra = activity.getIntent().getStringExtra("muzz_version_url");
        if (extra == null || extra.length() > 200) return VERSION_URL;
        if (extra.startsWith("https://") || extra.startsWith("http://")) return extra;
        return VERSION_URL;
    }

    private static SharedPreferences prefs(Activity activity) {
        return activity.getSharedPreferences("muzz_update", Activity.MODE_PRIVATE);
    }

    private static boolean cacheIsFresh(Activity activity) {
        long checkedAt = prefs(activity).getLong("checkedAt", 0L);
        return checkedAt > 0 && System.currentTimeMillis() - checkedAt < INTERVAL_MS
            && prefs(activity).contains("versionCode");
    }

    private static JSONObject cachedManifest(Activity activity) {
        SharedPreferences prefs = prefs(activity);
        JSONObject json = new JSONObject();
        try {
            json.put("versionCode", prefs.getInt("versionCode", 0));
            json.put("versionName", prefs.getString("versionName", ""));
            json.put("apkUrl", prefs.getString("apkUrl", ""));
            json.put("notes", prefs.getString("notes", ""));
            json.put("force", prefs.getBoolean("force", false));
        } catch (Exception ignored) {
            /* present() treats a bad cache as no update */
        }
        return json;
    }

    private static void remember(Activity activity, JSONObject json) {
        prefs(activity).edit()
            .putLong("checkedAt", System.currentTimeMillis())
            .putInt("versionCode", json.optInt("versionCode", 0))
            .putString("versionName", json.optString("versionName", ""))
            .putString("apkUrl", json.optString("apkUrl", ""))
            .putString("notes", json.optString("notes", ""))
            .putBoolean("force", json.optBoolean("force", false))
            .apply();
    }

    private static void present(Activity activity, JSONObject json) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        int remote = json == null ? 0 : json.optInt("versionCode", 0);
        long installed = installedCode(activity);
        android.util.Log.i(WalletLinks.TAG, "update remote=" + remote + " installed=" + installed);
        if (remote <= installed) {
            dismissDialog();
            android.util.Log.i(WalletLinks.TAG, "update current");
            return;
        }
        String name = json.optString("versionName", "").trim();
        if (name.isEmpty()) name = String.valueOf(remote);
        String notes = json.optString("notes", "").replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").trim();
        if (notes.length() > 400) notes = notes.substring(0, 400);
        String apk = json.optString("apkUrl", "").trim();
        if (!apk.startsWith("https://") && !apk.startsWith("http://")) {
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
