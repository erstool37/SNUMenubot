import { generateKeyPairSync, sign } from "node:crypto";
import worker from "../src/worker.compact.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicDer = publicKey.export({ format: "der", type: "spki" });
const publicKeyHex = Buffer.from(publicDer.subarray(-32)).toString("hex");

const body = JSON.stringify({ type: 1 });
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

const request = new Request("https://snu-food-discord-bot.example.workers.dev/", {
  method: "POST",
  headers: {
    "x-signature-ed25519": signature,
    "x-signature-timestamp": timestamp,
    "content-type": "application/json",
  },
  body,
});

const response = await worker.fetch(
  request,
  { DISCORD_PUBLIC_KEY: publicKeyHex },
  { waitUntil: (promise) => promise },
);

console.log(`status=${response.status}`);
console.log(await response.text());
