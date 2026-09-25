// Configuración pública de arranque. No pongas secretos aquí.
// El project id de WalletConnect NO va en este archivo (se commitea).
// Ponlo en WALLETCONNECT_PROJECT_ID y ejecuta npm run config.
// Eso escribe www/config.local.json, que no se sube.
// Tras desplegar las functions, pon su URL sin barra final, por ejemplo:
// https://us-central1-TU_PROYECTO.cloudfunctions.net
window.MUZZ_RUNTIME = {
  functionsBase: '',
  walletConnectProjectId: '',
  minMuzz: 10000000,
  firebase: null
};
