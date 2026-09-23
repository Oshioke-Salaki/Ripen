#!/usr/bin/env node
/**
 * Deploy ripen-gift-v1 to Stacks testnet.
 *
 * The canonical contract source stays pointed at the devnet mock so `npm test`
 * always works. This script applies the testnet sBTC substitution in memory,
 * writes the exact bytes it deploys to deployments/ for the record, and then
 * broadcasts.
 *
 *   node scripts/deploy-testnet.mjs --keygen     create and fund a deployer key
 *   node scripts/deploy-testnet.mjs              deploy using .env.deploy
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  makeContractDeploy, broadcastTransaction, ClarityVersion,
  privateKeyToAddress, randomPrivateKey, fetchNonce,
} from "@stacks/transactions";

const API = "https://api.testnet.hiro.so";
const NETWORK = "testnet";
const CONTRACT_NAME = "ripen-gift-v1";
const KEYFILE = ".env.deploy";
const TESTNET_SBTC = "'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadKey() {
  if (!existsSync(KEYFILE)) {
    console.error(`No ${KEYFILE}. Run: node scripts/deploy-testnet.mjs --keygen`);
    process.exit(1);
  }
  const m = readFileSync(KEYFILE, "utf8").match(/DEPLOYER_KEY=(\S+)/);
  if (!m) { console.error(`${KEYFILE} has no DEPLOYER_KEY`); process.exit(1); }
  return m[1];
}

async function balance(addr) {
  const r = await fetch(`${API}/extended/v1/address/${addr}/stx`);
  if (!r.ok) return 0n;
  const j = await r.json();
  return BigInt(j.balance ?? 0);
}

async function keygen() {
  const key = randomPrivateKey();
  const address = privateKeyToAddress(key, NETWORK);
  writeFileSync(KEYFILE, `# Ripen testnet deployer. Gitignored. Testnet only — never reuse on mainnet.\nDEPLOYER_KEY=${key}\nDEPLOYER_ADDRESS=${address}\n`);
  console.log(`Wrote ${KEYFILE}`);
  console.log(`  address: ${address}`);

  console.log("\nRequesting testnet STX from the faucet...");
  const res = await fetch(`${API}/extended/v1/faucets/stx?address=${address}`, { method: "POST" });
  console.log(`  faucet: ${res.status} ${res.ok ? "accepted" : await res.text()}`);

  process.stdout.write("  waiting for funds");
  for (let i = 0; i < 40; i++) {
    const b = await balance(address);
    if (b > 0n) { console.log(`\n  funded: ${Number(b) / 1e6} STX`); return; }
    process.stdout.write(".");
    await sleep(6000);
  }
  console.log("\n  still unfunded — the testnet faucet can be slow. Re-run --keygen later, or fund manually:");
  console.log(`  https://explorer.hiro.so/sandbox/faucet?chain=testnet`);
}

async function deploy() {
  const key = loadKey();
  const address = privateKeyToAddress(key, NETWORK);
  const bal = await balance(address);
  console.log(`deployer: ${address}`);
  console.log(`balance : ${Number(bal) / 1e6} STX`);
  if (bal === 0n) { console.error("Deployer has no STX. Fund it first."); process.exit(1); }

  // Canonical source is devnet-pointed; substitute for testnet in memory.
  const src = readFileSync(`contracts/${CONTRACT_NAME}.clar`, "utf8");
  const codeBody = src.replaceAll("(contract-call? .mock-sbtc-token transfer", `(contract-call? ${TESTNET_SBTC} transfer`);
  if (codeBody === src) { console.error("Substitution made no change — check the contract source."); process.exit(1); }
  // Only call sites matter; the header comment legitimately names all three networks.
  if (/\(contract-call\?\s+\.mock-sbtc-token/.test(codeBody)) {
    console.error("A mock call site survived substitution — refusing to deploy.");
    process.exit(1);
  }
  const callSites = [...codeBody.matchAll(/\(contract-call\?\s+(\S+)\s+transfer/g)].map((m) => m[1]);
  if (!callSites.length || !callSites.every((s) => s === TESTNET_SBTC)) {
    console.error(`Unexpected token call sites after substitution: ${callSites.join(", ") || "none"}`);
    process.exit(1);
  }
  console.log(`token call sites: ${callSites.length}, all -> ${TESTNET_SBTC}`);

  const outPath = `deployments/${CONTRACT_NAME}.testnet.clar`;
  writeFileSync(outPath, codeBody);
  console.log(`exact deployed source written to ${outPath}`);

  const nonce = await fetchNonce({ address, network: NETWORK });
  const tx = await makeContractDeploy({
    contractName: CONTRACT_NAME,
    codeBody,
    senderKey: key,
    network: NETWORK,
    clarityVersion: ClarityVersion.Clarity3,
    nonce,
    fee: 200000n,
  });

  const res = await broadcastTransaction({ transaction: tx, network: NETWORK });
  if (res.error) {
    console.error(`broadcast failed: ${res.error} ${res.reason ?? ""} ${JSON.stringify(res.reason_data ?? {})}`);
    process.exit(1);
  }
  const txid = res.txid;
  console.log(`\nbroadcast txid: ${txid}`);
  console.log(`explorer: https://explorer.hiro.so/txid/${txid}?chain=testnet`);
  console.log(`contract: ${address}.${CONTRACT_NAME}`);

  process.stdout.write("\nwaiting for confirmation");
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const r = await fetch(`${API}/extended/v1/tx/${txid}`);
    if (r.ok) {
      const j = await r.json();
      if (j.tx_status === "success") {
        console.log(`\nCONFIRMED. Contract live at ${address}.${CONTRACT_NAME}`);
        return;
      }
      if (j.tx_status && j.tx_status !== "pending") {
        console.error(`\nFAILED: ${j.tx_status} ${JSON.stringify(j.tx_result ?? {})}`);
        process.exit(1);
      }
    }
    process.stdout.write(".");
  }
  console.log("\nStill pending. Check the explorer link above.");
}

if (process.argv.includes("--keygen")) await keygen();
else await deploy();
