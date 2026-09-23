#!/usr/bin/env node
/**
 * The sBTC token is named literally in ripen-gift-v1.clar (Clarity requires
 * contract-call? to name a literal contract, and a caller-supplied trait would
 * allow a counterfeit token — ADR-003). That literal is the one thing that must
 * change per network, so it gets a guard rather than a convention.
 *
 *   node scripts/check-network-constant.mjs             report
 *   node scripts/check-network-constant.mjs --set testnet   rewrite, printing a diff
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "contracts/ripen-gift-v1.clar";
const TOKENS = {
  devnet: ".mock-sbtc-token",
  testnet: "'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token",
  mainnet: "'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
};
const CALL = /\(contract-call\?\s+(\S+)\s+transfer/g;

const src = readFileSync(FILE, "utf8");
const found = [...src.matchAll(CALL)].map((m) => m[1]);

if (found.length === 0) {
  console.error(`FAIL: no sBTC contract-call? found in ${FILE}`);
  process.exit(1);
}
const unique = [...new Set(found)];
if (unique.length !== 1) {
  console.error(`FAIL: mixed token references — ${unique.join(", ")}`);
  process.exit(1);
}
const current = unique[0];
const network = Object.entries(TOKENS).find(([, v]) => v === current)?.[0];

const setIdx = process.argv.indexOf("--set");
if (setIdx === -1) {
  if (!network) {
    console.error(`FAIL: unrecognised token reference ${current}`);
    process.exit(1);
  }
  console.log(`${FILE}`);
  console.log(`  sBTC token : ${current}`);
  console.log(`  network    : ${network}`);
  console.log(`  call sites : ${found.length}`);
  if (network !== "devnet") {
    console.log(`\n  NOTE: tests run against the devnet mock. Re-run \`npm test\` after setting back to devnet.`);
  }
  process.exit(0);
}

const target = process.argv[setIdx + 1];
if (!TOKENS[target]) {
  console.error(`FAIL: unknown network "${target}". Use devnet, testnet or mainnet.`);
  process.exit(1);
}
if (current === TOKENS[target]) {
  console.log(`Already set to ${target} (${current}). No change.`);
  process.exit(0);
}
const out = src.replaceAll(`(contract-call? ${current} transfer`, `(contract-call? ${TOKENS[target]} transfer`);
writeFileSync(FILE, out);
console.log(`${FILE}: ${network ?? current} -> ${target}`);
console.log(`  - ${current}`);
console.log(`  + ${TOKENS[target]}`);
console.log(`  ${found.length} call site(s) rewritten.`);
