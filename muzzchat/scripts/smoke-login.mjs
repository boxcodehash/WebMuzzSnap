import { getAddress, Wallet } from "ethers";
import { SiweMessage } from "siwe";

const base = process.env.MUZZCHAT_FUNCTIONS_URL || "http://127.0.0.1:5001/demo-muzzchat/us-central1";

async function call(name, data) {
  const response = await fetch(`${base}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  const json = await response.json();
  if (json.error) {
    const error = new Error(json.error.message || "callable error");
    error.code = json.error.status;
    throw error;
  }
  return json.result;
}

function buildMessage(address, nonce) {
  return new SiweMessage({
    domain: "127.0.0.1:5173",
    address,
    statement: "Entra a MuzzChat. Comprobaremos tu saldo de MUZZ en Ethereum.",
    uri: "http://127.0.0.1:5173",
    version: "1",
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();
}

const wallet = Wallet.createRandom();
const address = getAddress(wallet.address);
const first = await call("requestNonce", {});
const message = buildMessage(address, first.nonce);
const signature = await wallet.signMessage(message);
const { token } = await call("verifyLogin", { message, signature });
const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
if (payload.uid !== address.toLowerCase()) throw new Error(`uid ${payload.uid}`);
if (payload.claims?.muzz !== true || payload.claims?.wallet !== address.toLowerCase()) {
  throw new Error(`claims ${JSON.stringify(payload.claims)}`);
}

const second = await call("requestNonce", {});
const again = buildMessage(address, second.nonce);
try {
  await call("verifyLogin", { message: again, signature: "0x" + "11".repeat(65) });
  throw new Error("invalid signature was accepted");
} catch (error) {
  if (!/firma inválida/i.test(error.message)) throw error;
}

console.log("smoke login ok", address.toLowerCase());
