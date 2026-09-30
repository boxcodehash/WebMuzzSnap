package app.muzzsnap.chat;

import android.app.Application;

public class MuzzApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        PushAlerts.ensureChannel(this);
        PushAlerts.fetchToken(this);
    }
}
