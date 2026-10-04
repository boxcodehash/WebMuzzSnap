import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { CONSUMED_PREKEY_GRACE_MS, READ_TTL_MS, UNREAD_TTL_MS } from "../../shared/constants";
import { hasMuzzAccess, parseMinWhole } from "../../shared/gate";
import { messageDueForDeletion, prekeyDueForDeletion } from "../../shared/purge";
import "./admin";
import { readMuzzBalance } from "./eth";

const REGION = "us-central1";

async function revokeHolder(wallet: string, uid: string, balance: bigint): Promise<void> {
  const { getAuth } = await import("firebase-admin/auth");
  try {
    await getAuth().setCustomUserClaims(uid, { wallet, muzz: false });
    await getAuth().revokeRefreshTokens(uid);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") console.error("revoke failed", wallet, code || error);
  }
  await getFirestore().collection("holders").doc(wallet).set(
    { muzz: false, revokedAt: Date.now(), lastBalance: balance.toString(), wallet, uid },
    { merge: true },
  );
}

export const recheckMuzzBalances = onSchedule(
  { schedule: "every 30 minutes", region: REGION, timeoutSeconds: 540, memory: "256MiB" },
  async () => {
    const snap = await getFirestore().collection("holders").where("muzz", "==", true).limit(500).get();
    if (snap.size === 500) console.warn("MuzzChat recheck truncated at 500 holders");
    let minWhole: bigint;
    try {
      minWhole = parseMinWhole(process.env.MIN_MUZZ_WHOLE);
    } catch (error) {
      console.error("MIN_MUZZ_WHOLE", error);
      return;
    }
    for (const doc of snap.docs) {
      const wallet = doc.id;
      try {
        const balance = await readMuzzBalance(wallet);
        if (!hasMuzzAccess(balance, minWhole)) {
          const uid = String(doc.data().uid || wallet);
          await revokeHolder(wallet, uid, balance);
        } else {
          await doc.ref.set({ lastChecked: Date.now(), lastBalance: balance.toString() }, { merge: true });
        }
      } catch (error) {
        console.error("balance check skipped", wallet, error instanceof Error ? error.message : error);
      }
    }
  },
);

export const purgeExpiredData = onSchedule(
  { schedule: "every 15 minutes", region: REGION, timeoutSeconds: 180, memory: "256MiB" },
  async () => {
    const firestore = getFirestore();
    const now = Date.now();
    const readCutoff = now - READ_TTL_MS;
    const unreadCutoff = now - UNREAD_TTL_MS;
    const prekeyCutoff = now - CONSUMED_PREKEY_GRACE_MS;

    const [readOld, unreadOld, consumed, oldNonces, oldQuota] = await Promise.all([
      firestore.collection("messages").where("readAt", "<=", readCutoff).limit(200).get(),
      firestore.collection("messages").where("readAt", "==", null).where("createdAt", "<=", unreadCutoff).limit(200).get(),
      firestore.collectionGroup("items").where("consumed", "==", true).where("consumedAt", "<=", prekeyCutoff).limit(200).get(),
      firestore.collection("nonces").where("expiresAt", "<", now).limit(200).get(),
      firestore.collection("claimQuota").where("expiresAt", "<", now).limit(200).get(),
    ]);

    const batch = firestore.batch();
    let writes = 0;
    const queue = (ref: DocumentReference) => {
      if (writes >= 450) return;
      batch.delete(ref);
      writes += 1;
    };

    for (const doc of [...readOld.docs, ...unreadOld.docs]) {
      const data = doc.data();
      if (messageDueForDeletion({ createdAt: Number(data.createdAt), readAt: (data.readAt ?? null) as number | null }, now)) {
        queue(doc.ref);
      }
    }
    for (const doc of consumed.docs) {
      const data = doc.data();
      if (
        prekeyDueForDeletion(
          { id: doc.id, consumed: data.consumed === true, consumedAt: (data.consumedAt ?? null) as number | null },
          now,
        )
      ) {
        queue(doc.ref);
      }
    }
    for (const doc of oldNonces.docs) queue(doc.ref);
    for (const doc of oldQuota.docs) queue(doc.ref);
    if (writes) await batch.commit();
  },
);
