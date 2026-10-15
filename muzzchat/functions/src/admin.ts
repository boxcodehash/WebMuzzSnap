import { getApps, initializeApp } from "firebase-admin/app";

const project =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || "";

if (project === "pulsari") {
  throw new Error("MuzzChat refuses to start on the pulsari Firebase project.");
}

if (getApps().length === 0) {
  initializeApp();
}
