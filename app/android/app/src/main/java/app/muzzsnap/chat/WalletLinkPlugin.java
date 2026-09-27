package app.muzzsnap.chat;

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
        if (!WalletLinks.start(getContext(), Uri.parse(url))) {
            call.reject("Wallet app not found. Install it or choose another wallet.");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void checkUpdate(PluginCall call) {
        UpdateChecker.checkNow(getActivity());
        call.resolve();
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null) return null;
        android.util.Log.i(WalletLinks.TAG, "override " + url.getScheme() + " " + url);
        if (WalletLinks.isAppReturn(url)) {
            WalletLinks.start(getContext(), url);
            return true;
        }
        if (!WalletLinks.shouldLeaveWebView(url)) return null;
        if (!WalletLinks.start(getContext(), url) && bridge != null) {
            bridge.eval("try{if(window.muzzWalletMissing)window.muzzWalletMissing();}catch(e){}", null);
        }
        return true;
    }
}
