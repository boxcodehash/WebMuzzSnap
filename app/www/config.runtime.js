// Configuración pública de arranque. No pongas secretos aquí.
// El project id de WalletConnect y MUZZ_PREVIEW NO van en este archivo (se commitea).
// Van en app/.env (WALLETCONNECT_PROJECT_ID, MUZZ_PREVIEW, MUZZ_FUNCTIONS_BASE).
// npm run config escribe www/config.local.json, que no se sube.
// Tras desplegar las functions, pon su URL sin barra final, por ejemplo:
// https://us-central1-TU_PROYECTO.cloudfunctions.net
window.MUZZ_RUNTIME = {
  functionsBase: '',
  walletConnectProjectId: '',
  minMuzz: 10000000,
  firebase: null
};
