package app.muzzsnap.chat;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WalletLink")
public class WalletLinkPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Wallet app not found. Install it or choose another wallet.");
            return;
        }
        if (!startView(Uri.parse(url))) {
            call.reject("Wallet app not found. Install it or choose another wallet.");
            return;
        }
        call.resolve();
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null || url.getScheme() == null) return null;
        String scheme = url.getScheme().toLowerCase();
        if ("http".equals(scheme) || "https".equals(scheme) || "about".equals(scheme)
            || "data".equals(scheme) || "blob".equals(scheme) || "muzzsnap".equals(scheme)
            || "javascript".equals(scheme)) {
            return null;
        }
        if (!startView(url) && bridge != null) {
            bridge.eval("try{if(window.muzzWalletMissing)window.muzzWalletMissing();}catch(e){}", null);
        }
        return true;
    }

    private boolean startView(Uri url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, url);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException ex) {
            return false;
        }
    }
}
