import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-muzzchat";

if (projectId === "pulsari") {
  throw new Error("MuzzChat no usa el proyecto Firebase pulsari.");
}

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "demo-muzzchat.firebaseapp.com",
  projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "demo-app-id",
});

export const auth = getAuth(app);
export const functions = getFunctions(app, "us-central1");
export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

const globalState = globalThis as typeof globalThis & { __muzzchatEmulators?: boolean };
if (usingEmulators && !globalState.__muzzchatEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  globalState.__muzzchatEmulators = true;
}
