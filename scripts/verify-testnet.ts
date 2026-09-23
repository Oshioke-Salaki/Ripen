/**
 * Verify the deployed testnet contract from a terminal, with no wallet and no
 * funds. Everything here is a read-only call.
 *
 *   npm run verify:testnet
 *
 * The last check is the important one: it recomputes the SIP-018 claim message
 * hash locally with lib/claim-message.ts and compares it against what the
 * deployed contract returns. If those ever disagree, gifts become unclaimable —
 * so this proves client and chain agree on the live deployment, not just in
 * tests.
 */
import { Cl, deserializeCV } from "@stacks/transactions";
import { claimMessageHash, CHAIN_ID, bytesToHex } from "../lib/claim-message.ts";

const API = "https://api.testnet.hiro.so";
const ADDRESS = process.env.RIPEN_CONTRACT_ADDRESS ?? "STXWNPMB6D6Y8F4GMSR66RVP4WTWN03B94XRMA31";
const NAME = "ripen-gift-v1";
const CONTRACT = `${ADDRESS}.${NAME}`;

let failures = 0;
const ok = (label: string, detail = "") => console.log(`  PASS  ${label}${detail ? " — " + detail : ""}`);
const bad = (label: string, detail = "") => { failures++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); };

async function readOnly(fn: string, args: string[] = []) {
  const r = await fetch(`${API}/v2/contracts/call-read/${ADDRESS}/${NAME}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: ADDRESS, arguments: args }),
  });
  const j = await r.json();
  if (!j.okay) throw new Error(`${fn}: ${JSON.stringify(j).slice(0, 160)}`);
  return deserializeCV(j.result);
}

console.log(`\nRipen — verifying ${CONTRACT}\n`);

// 1. The contract exists and exposes the expected surface.
const iface = await (await fetch(`${API}/v2/contracts/interface/${ADDRESS}/${NAME}`)).json();
if (iface.functions) {
  const names = iface.functions.map((f: any) => f.name);
  const required = ["create-gift", "claim-gift", "reclaim-gift", "claim-message-hash", "get-gift", "get-config"];
  const missing = required.filter((n) => !names.includes(n));
  missing.length ? bad("contract surface", `missing ${missing.join(", ")}`)
                 : ok("contract deployed", `${names.length} functions`);
} else {
  bad("contract deployed", "no interface returned");
}

// 2. It is bound to the real testnet sBTC token, not a mock.
const src = await (await fetch(`${API}/v2/contracts/source/${ADDRESS}/${NAME}`)).json();
const body: string = src.source ?? "";
if (/\(contract-call\?\s+'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1\.sbtc-token\s+transfer/.test(body)) {
  ok("bound to real testnet sBTC", "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token");
} else {
  bad("bound to real testnet sBTC", "token call site not found in deployed source");
}
if (/\(contract-call\?\s+\.mock-sbtc-token/.test(body)) bad("no mock in deployed source");
else ok("no mock token in deployed source");

// 3. Configuration is live and readable.
const cfg = Cl.prettyPrint(await readOnly("get-config"));
ok("get-config readable");
console.log(cfg.split("\n").map((l) => "        " + l.trim()).join("\n"));

// 4. Claiming and reclaiming cannot be paused — assert creation-pause only.
if (/\(asserts!\s+\(not\s+\(var-get paused\)\)/.test(body)) {
  const claimFn = body.slice(body.indexOf("(define-public (claim-gift"), body.indexOf("(define-public (reclaim-gift"));
  claimFn.includes("var-get paused")
    ? bad("claim is not pausable", "paused referenced inside claim-gift")
    : ok("claim is not pausable", "pause guards creation only");
} else {
  bad("pause guard", "not found");
}

// 5. Client and chain agree on the claim message hash.
let parity = 0;
for (const [giftId, recipient] of [[1, ADDRESS], [42, "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"], [987654, CONTRACT]] as const) {
  const onChain = Cl.prettyPrint(await readOnly("claim-message-hash",
    [Cl.serialize(Cl.uint(giftId)), Cl.serialize(Cl.principal(recipient))])).replace(/^0x/, "");
  const local = bytesToHex(claimMessageHash({ giftId, recipient, contractId: CONTRACT, chainId: CHAIN_ID.testnet }));
  if (onChain === local) parity++;
  else bad("claim-message-hash parity", `gift ${giftId}: chain ${onChain.slice(0, 16)} vs local ${local.slice(0, 16)}`);
}
if (parity === 3) ok("claim-message-hash parity", "3/3 match between lib/claim-message.ts and the deployed contract");

console.log(`\nexplorer: https://explorer.hiro.so/txid/${CONTRACT}?chain=testnet`);
console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
