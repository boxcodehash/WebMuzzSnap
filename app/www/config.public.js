// Public login origin. Wallets cannot open https://localhost from the APK.
// Override at build time with APP_PUBLIC_URL or WALLETCONNECT_PROJECT_ID
// (written to config.local.json, not committed).
// The Reown project id is a public client identifier for the MuzzSnap project.
// Allowed domains there: muzzsnap-app.vercel.app and localhost.
window.MUZZ_PUBLIC = {
  appPublicUrl: 'https://muzzsnap-app.vercel.app',
  walletConnectProjectId: '8ff03dad157892146048cfe2b4e381ca'
};
window.MUZZ_RUNTIME = window.MUZZ_RUNTIME || {};
if (!window.MUZZ_RUNTIME.walletConnectProjectId) {
  window.MUZZ_RUNTIME.walletConnectProjectId = window.MUZZ_PUBLIC.walletConnectProjectId;
}
