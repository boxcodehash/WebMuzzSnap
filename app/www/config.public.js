// Public login origin. Wallets cannot open https://localhost from the APK.
// Override at build time with APP_PUBLIC_URL (written to config.local.json, not committed).
window.MUZZ_PUBLIC = {
  appPublicUrl: 'https://muzzsnap-app.vercel.app',
  walletConnectProjectId: ''
};
