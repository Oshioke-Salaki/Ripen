import { describe, it, expect, beforeEach } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { concatBytes } from "@noble/hashes/utils";
import {
  Ctx, Cl, ERR, CONFIG, pretty, isErr, uintOf,
  generateClaimKey, claimMessageHash, CHAIN_ID,
} from "./helpers";

let c: Ctx;
beforeEach(async () => {
  c = await Ctx.fresh();
  c.mint(c.w1, 50_000_000);
  c.mint(c.w2, 50_000_000);
});

// ===========================================================================
// Creation — C-1 .. C-15
// ===========================================================================
describe("create-gift", () => {
  it("C-1 valid creation moves sBTC, records the gift and emits an event", () => {
    const before = c.balance(c.w1);
    const { res, amount } = c.createGift();
    expect(pretty(res.result)).toBe("(ok u1)");
    expect(c.balance(c.w1)).toBe(before - BigInt(amount));
    expect(c.contractBalance()).toBe(BigInt(amount));
    expect(c.totalLocked()).toBe(BigInt(amount));
    expect(c.gift(1)).toContain("status: u0");
    const ev = res.events.find((e) => e.event === "print_event");
    expect(pretty(ev!.data.value!)).toContain('event: "gift-created"');
  });

  it("C-2 second gift increments the id", () => {
    c.createGift();
    expect(pretty(c.createGift().res.result)).toBe("(ok u2)");
  });

  it("C-3 amount below min is rejected", () => {
    expect(isErr(c.createGift({ amount: CONFIG.MIN - 1 }).res.result, ERR.INVALID_AMOUNT)).toBe(true);
  });

  it("C-4 amount above max is rejected", () => {
    expect(isErr(c.createGift({ amount: CONFIG.MAX + 1 }).res.result, ERR.INVALID_AMOUNT)).toBe(true);
  });

  it("C-5 amounts exactly at each bound succeed", () => {
    expect(pretty(c.createGift({ amount: CONFIG.MIN }).res.result)).toBe("(ok u1)");
    expect(pretty(c.createGift({ amount: CONFIG.MAX }).res.result)).toBe("(ok u2)");
  });

  it("C-6 exceeding the protocol cap is rejected", () => {
    c.setLimits(CONFIG.MIN, CONFIG.MAX, 15_000, CONFIG.MAX_DURATION);
    expect(pretty(c.createGift({ amount: 10_000 }).res.result)).toBe("(ok u1)");
    expect(isErr(c.createGift({ amount: 10_000 }).res.result, ERR.CAP_EXCEEDED)).toBe(true);
  });

  it("C-7 expiry at or before unlock is rejected", () => {
    expect(isErr(c.createGift({ unlockIn: 100, expiryIn: 100 }).res.result, ERR.INVALID_SCHEDULE)).toBe(true);
    expect(isErr(c.createGift({ unlockIn: 100, expiryIn: 50 }).res.result, ERR.INVALID_SCHEDULE)).toBe(true);
  });

  it("C-8 expiry in the past is rejected", () => {
    c.advanceBurn(50);
    expect(isErr(c.createGift({ unlockIn: -40, expiryIn: -20 }).res.result, ERR.INVALID_SCHEDULE)).toBe(true);
  });

  it("C-9 duration beyond max-duration is rejected", () => {
    expect(isErr(c.createGift({ expiryIn: CONFIG.MAX_DURATION + 1 }).res.result, ERR.INVALID_SCHEDULE)).toBe(true);
  });

  it("C-10 unlock in the past with a future expiry succeeds (immediately claimable)", () => {
    c.advanceBurn(50);
    const { res } = c.createGift({ unlockIn: -10, expiryIn: 500 });
    expect(pretty(res.result)).toBe("(ok u1)");
    expect(c.giftState(1)).toContain("claimable: true");
  });

  it("C-11 a malformed claim public key is rejected", () => {
    const bad = new Uint8Array(33); // all zeros — not a curve point
    expect(isErr(c.createGift({ pubkeyOverride: bad }).res.result, ERR.INVALID_PUBKEY)).toBe(true);
  });

  it("C-12 a reused claim public key is rejected", () => {
    const key = generateClaimKey();
    expect(pretty(c.createGift({ key }).res.result)).toBe("(ok u1)");
    expect(isErr(c.createGift({ key }).res.result, ERR.PUBKEY_IN_USE)).toBe(true);
  });

  it("C-13 a public key from an already-claimed gift cannot be reused (I-4)", () => {
    const key = generateClaimKey();
    c.createGift({ key });
    const sig = c.signFor(key, 1, c.w2);
    expect(pretty(c.claim(1, c.w2, sig).result)).toBe("(ok u1)");
    expect(isErr(c.createGift({ key }).res.result, ERR.PUBKEY_IN_USE)).toBe(true);
  });

  it("C-14 insufficient sBTC aborts and writes no gift", () => {
    const { res } = c.createGift({ sender: c.w3, amount: 10_000 }); // w3 was never minted to
    expect(pretty(res.result).startsWith("(err")).toBe(true);
    expect(c.gift(1)).toBe("none");
    expect(c.totalLocked()).toBe(0n);
  });

  it("C-15 creation while paused is rejected", () => {
    c.setPaused(true);
    expect(isErr(c.createGift().res.result, ERR.PAUSED)).toBe(true);
  });
});

// ===========================================================================
// Claiming — L-1 .. L-17
// ===========================================================================
describe("claim-gift", () => {
  it("L-1 a valid claim after unlock pays the recipient", () => {
    const { key, amount } = c.createGift({ unlockIn: 10, expiryIn: 500 });
    c.advanceBurn(11);
    const before = c.balance(c.w2);
    const res = c.claim(1, c.w2, c.signFor(key, 1, c.w2));
    expect(pretty(res.result)).toBe("(ok u1)");
    expect(c.balance(c.w2)).toBe(before + BigInt(amount));
    expect(c.contractBalance()).toBe(0n);
    expect(c.totalLocked()).toBe(0n);
    expect(c.gift(1)).toContain("status: u1");
  });

  it("L-2 a claim at exactly unlock-height succeeds (inclusive bound)", () => {
    const { key, unlock } = c.createGift({ unlockIn: 10, expiryIn: 500 });
    c.advanceBurn(unlock - c.burn);
    expect(c.burn).toBe(unlock);
    expect(pretty(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result)).toBe("(ok u1)");
  });

  it("L-3 a claim one block before unlock is rejected", () => {
    const { key, unlock } = c.createGift({ unlockIn: 10, expiryIn: 500 });
    c.advanceBurn(unlock - c.burn - 1);
    expect(c.burn).toBe(unlock - 1);
    expect(isErr(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result, ERR.STILL_LOCKED)).toBe(true);
  });

  it("L-4 a claim at exactly expiry-height is rejected (exclusive bound)", () => {
    const { key, expiry } = c.createGift({ unlockIn: 0, expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    expect(c.burn).toBe(expiry);
    expect(isErr(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result, ERR.EXPIRED)).toBe(true);
  });

  it("L-5 a claim one block before expiry succeeds", () => {
    const { key, expiry } = c.createGift({ unlockIn: 0, expiryIn: 50 });
    c.advanceBurn(expiry - c.burn - 1);
    expect(pretty(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result)).toBe("(ok u1)");
  });

  it("L-6 a second claim is rejected", () => {
    const { key } = c.createGift();
    const sig = c.signFor(key, 1, c.w2);
    expect(pretty(c.claim(1, c.w2, sig).result)).toBe("(ok u1)");
    expect(isErr(c.claim(1, c.w2, sig).result, ERR.NOT_PENDING)).toBe(true);
  });

  it("L-7 a signature from the wrong key is rejected", () => {
    c.createGift();
    const wrong = generateClaimKey();
    expect(isErr(c.claim(1, c.w2, c.signFor(wrong, 1, c.w2)).result, ERR.BAD_SIGNATURE)).toBe(true);
  });

  it("L-8 a valid signature replayed for a DIFFERENT recipient is rejected (front-running)", () => {
    const { key } = c.createGift();
    const sigForW2 = c.signFor(key, 1, c.w2);
    // An attacker lifts the signature from the mempool and points it at themselves.
    expect(isErr(c.claim(1, c.w3, sigForW2).result, ERR.BAD_SIGNATURE)).toBe(true);
    // The rightful recipient is unaffected.
    expect(pretty(c.claim(1, c.w2, sigForW2).result)).toBe("(ok u1)");
  });

  it("L-9 a signature for gift 1 cannot claim gift 2", () => {
    const k1 = generateClaimKey(), k2 = generateClaimKey();
    c.createGift({ key: k1 });
    c.createGift({ key: k2 });
    expect(isErr(c.claim(2, c.w2, c.signFor(k1, 1, c.w2)).result, ERR.BAD_SIGNATURE)).toBe(true);
  });

  it("L-10 a truncated signature is rejected cleanly", () => {
    c.createGift();
    expect(isErr(c.claim(1, c.w2, new Uint8Array(10)).result, ERR.BAD_SIGNATURE)).toBe(true);
  });

  it("L-11 high-S signatures are accepted, but malleation still cannot redirect a claim", () => {
    // VERIFIED BEHAVIOUR, not documented behaviour. The Stacks docs state that
    // secp256k1-verify rejects high-S signatures to enforce canonical low-S
    // form. Against this Clarity version it does not: (r, n-s) verifies exactly
    // as (r, s) does, in both 64- and 65-byte form, and the recovery byte is
    // ignored. Claim signatures are therefore malleable.
    //
    // That is harmless for Ripen because the recipient is bound inside the
    // signed message, so a malleated signature still only ever pays the address
    // it was signed for — asserted below. The operational consequence is that
    // relayer idempotency must be keyed on gift-id, never on signature bytes.
    const malleate = (sig: Uint8Array): Uint8Array => {
      const toBig = (b: Uint8Array) => BigInt("0x" + Buffer.from(b).toString("hex"));
      const flipped = new secp256k1.Signature(
        toBig(sig.slice(0, 32)), secp256k1.CURVE.n - toBig(sig.slice(32, 64)));
      return concatBytes(flipped.toCompactRawBytes(), sig.slice(64));
    };

    const g1 = c.createGift();
    const g2 = c.createGift();

    // (a) A malleated signature verifies — documents the real behaviour.
    expect(pretty(c.claim(1, c.w2, malleate(c.signFor(g1.key, 1, c.w2))).result)).toBe("(ok u1)");

    // (b) The property that actually matters: it still cannot be redirected.
    expect(isErr(c.claim(2, c.w3, malleate(c.signFor(g2.key, 2, c.w2))).result,
                 ERR.BAD_SIGNATURE)).toBe(true);
  });

  it("L-12 a third party (the relayer) can submit; funds reach the recipient, not the submitter", () => {
    const { key, amount } = c.createGift();
    const relayerBefore = c.balance(c.w3);
    const recipientBefore = c.balance(c.w2);
    // w3 submits on w2's behalf and pays the fee. w3 is not the recipient.
    const res = c.claim(1, c.w2, c.signFor(key, 1, c.w2), c.w3);
    expect(pretty(res.result)).toBe("(ok u1)");
    expect(c.balance(c.w2)).toBe(recipientBefore + BigInt(amount));
    expect(c.balance(c.w3)).toBe(relayerBefore);
  });

  it("L-13 claiming a nonexistent gift is rejected", () => {
    const key = generateClaimKey();
    expect(isErr(c.claim(99, c.w2, c.signFor(key, 99, c.w2)).result, ERR.NOT_FOUND)).toBe(true);
  });

  it("L-14 claiming a reclaimed gift is rejected", () => {
    const { key, expiry } = c.createGift({ expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    expect(pretty(c.reclaim(1).result)).toBe("(ok u1)");
    expect(isErr(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result, ERR.NOT_PENDING)).toBe(true);
  });

  it("L-15 claiming still works while creation is paused (I-5)", () => {
    const { key } = c.createGift();
    c.setPaused(true);
    expect(pretty(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result)).toBe("(ok u1)");
  });

  it("L-16 the escrow contract itself is rejected as a recipient", () => {
    const { key } = c.createGift();
    expect(isErr(c.claim(1, c.contract, c.signFor(key, 1, c.contract)).result, ERR.INVALID_RECIPIENT)).toBe(true);
  });

  it("L-17 the sender may be the recipient (self-gifting / the Saver)", () => {
    const { key, amount } = c.createGift({ sender: c.w1 });
    const before = c.balance(c.w1);
    expect(pretty(c.claim(1, c.w1, c.signFor(key, 1, c.w1)).result)).toBe("(ok u1)");
    expect(c.balance(c.w1)).toBe(before + BigInt(amount));
  });
});

// ===========================================================================
// Reclaiming — X-1 .. X-8
// ===========================================================================
describe("reclaim-gift", () => {
  it("X-1 the sender reclaims after expiry", () => {
    const { amount, expiry } = c.createGift({ expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    const before = c.balance(c.w1);
    expect(pretty(c.reclaim(1, c.w1).result)).toBe("(ok u1)");
    expect(c.balance(c.w1)).toBe(before + BigInt(amount));
    expect(c.gift(1)).toContain("status: u2");
    expect(c.totalLocked()).toBe(0n);
  });

  it("X-2 a third party can trigger reclaim; funds go to the SENDER, not the caller", () => {
    const { amount, expiry } = c.createGift({ sender: c.w1, expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    const senderBefore = c.balance(c.w1);
    const callerBefore = c.balance(c.w3);
    expect(pretty(c.reclaim(1, c.w3).result)).toBe("(ok u1)");
    expect(c.balance(c.w1)).toBe(senderBefore + BigInt(amount));
    expect(c.balance(c.w3)).toBe(callerBefore);
  });

  it("X-3 reclaim before expiry is rejected", () => {
    c.createGift({ expiryIn: 50 });
    expect(isErr(c.reclaim(1).result, ERR.NOT_EXPIRED)).toBe(true);
  });

  it("X-4 reclaim at exactly expiry-height succeeds", () => {
    const { expiry } = c.createGift({ expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    expect(c.burn).toBe(expiry);
    expect(pretty(c.reclaim(1).result)).toBe("(ok u1)");
  });

  it("X-5 reclaiming a claimed gift is rejected", () => {
    const { key, expiry } = c.createGift({ expiryIn: 50 });
    c.claim(1, c.w2, c.signFor(key, 1, c.w2));
    c.advanceBurn(expiry - c.burn);
    expect(isErr(c.reclaim(1).result, ERR.NOT_PENDING)).toBe(true);
  });

  it("X-6 a second reclaim is rejected", () => {
    const { expiry } = c.createGift({ expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    expect(pretty(c.reclaim(1).result)).toBe("(ok u1)");
    expect(isErr(c.reclaim(1).result, ERR.NOT_PENDING)).toBe(true);
  });

  it("X-7 reclaim still works while creation is paused (I-5)", () => {
    const { expiry } = c.createGift({ expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    c.setPaused(true);
    expect(pretty(c.reclaim(1).result)).toBe("(ok u1)");
  });

  it("X-8 claiming after a reclaim is rejected", () => {
    const { key, expiry } = c.createGift({ expiryIn: 50 });
    c.advanceBurn(expiry - c.burn);
    c.reclaim(1);
    expect(isErr(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result, ERR.NOT_PENDING)).toBe(true);
  });
});

// ===========================================================================
// Administration and invariants — A-1 .. A-9
// ===========================================================================
describe("administration and invariants", () => {
  it("A-1 a non-owner cannot call any admin function", () => {
    expect(isErr(c.setPaused(true, c.w1).result, ERR.NOT_AUTHORIZED)).toBe(true);
    expect(isErr(c.setLimits(1, 2, 3, 4, c.w1).result, ERR.NOT_AUTHORIZED)).toBe(true);
    expect(isErr(c.transferOwnership(c.w1, c.w1).result, ERR.NOT_AUTHORIZED)).toBe(true);
  });

  it("A-2 pausing blocks creation", () => {
    c.setPaused(true);
    expect(isErr(c.createGift().res.result, ERR.PAUSED)).toBe(true);
    c.setPaused(false);
    expect(pretty(c.createGift().res.result)).toBe("(ok u1)");
  });

  it("A-3 pausing never blocks claim or reclaim (I-5)", () => {
    const g1 = c.createGift({ expiryIn: 500 });
    const g2 = c.createGift({ expiryIn: 50 });
    c.setPaused(true);
    expect(pretty(c.claim(1, c.w2, c.signFor(g1.key, 1, c.w2)).result)).toBe("(ok u1)");
    c.advanceBurn(g2.expiry - c.burn);
    expect(pretty(c.reclaim(2).result)).toBe("(ok u2)");
  });

  it("A-4 raising min-amount above an existing gift does not affect it", () => {
    const { key, amount } = c.createGift({ amount: 5_000 });
    c.setLimits(100_000, CONFIG.MAX, CONFIG.CAP, CONFIG.MAX_DURATION);
    const before = c.balance(c.w2);
    expect(pretty(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result)).toBe("(ok u1)");
    expect(c.balance(c.w2)).toBe(before + BigInt(amount));
  });

  it("A-5 lowering the cap below total-locked does not affect existing gifts", () => {
    const g1 = c.createGift({ amount: 50_000, expiryIn: 500 });
    const g2 = c.createGift({ amount: 50_000, expiryIn: 50 });
    c.setLimits(CONFIG.MIN, CONFIG.MAX, 1, CONFIG.MAX_DURATION);
    expect(pretty(c.claim(1, c.w2, c.signFor(g1.key, 1, c.w2)).result)).toBe("(ok u1)");
    c.advanceBurn(g2.expiry - c.burn);
    expect(pretty(c.reclaim(2).result)).toBe("(ok u2)");
  });

  it("A-6 ownership transfer moves authority and revokes the old owner", () => {
    expect(pretty(c.transferOwnership(c.w1).result)).toBe("(ok true)");
    expect(pretty(c.setPaused(true, c.w1).result)).toBe("(ok true)");
    expect(isErr(c.setPaused(false, c.deployer).result, ERR.NOT_AUTHORIZED)).toBe(true);
  });

  it("A-7 no owner action can move sBTC to a third address (I-6)", () => {
    const { amount } = c.createGift();
    const balBefore = c.contractBalance();
    const ownerBefore = c.balance(c.deployer);
    // Exercise the entire administrative surface.
    c.setPaused(true); c.setPaused(false);
    c.setLimits(1, CONFIG.MAX, CONFIG.CAP, CONFIG.MAX_DURATION);
    c.transferOwnership(c.deployer);
    expect(c.contractBalance()).toBe(balBefore);
    expect(c.balance(c.deployer)).toBe(ownerBefore);
    expect(c.totalLocked()).toBe(BigInt(amount));
  });

  it("A-8 accounting holds over a long mixed sequence (I-1, I-7)", () => {
    const keys: any[] = [];
    let expectedLocked = 0n;
    for (let i = 0; i < 20; i++) {
      const amount = 1_000 + i * 137;
      const g = c.createGift({ sender: i % 2 ? c.w1 : c.w2, amount, expiryIn: 60 });
      expect(pretty(g.res.result)).toBe(`(ok u${i + 1})`);
      keys.push(g); expectedLocked += BigInt(amount);
    }
    expect(c.totalLocked()).toBe(expectedLocked);
    // Claim a third of them.
    for (let i = 0; i < 20; i += 3) {
      const r = c.claim(i + 1, c.w3, c.signFor(keys[i].key, i + 1, c.w3));
      expect(pretty(r.result)).toBe(`(ok u${i + 1})`);
      expectedLocked -= BigInt(keys[i].amount);
    }
    expect(c.totalLocked()).toBe(expectedLocked);
    expect(c.contractBalance()).toBeGreaterThanOrEqual(c.totalLocked());
    // Expire and reclaim the rest.
    c.advanceBurn(100);
    for (let i = 0; i < 20; i++) {
      if (i % 3 === 0) continue;
      expect(pretty(c.reclaim(i + 1).result)).toBe(`(ok u${i + 1})`);
      expectedLocked -= BigInt(keys[i].amount);
    }
    expect(c.totalLocked()).toBe(0n);
    expect(expectedLocked).toBe(0n);
    expect(c.contractBalance()).toBe(0n); // I-1: nothing stranded
  });

  it("A-9 no entry point accepts a caller-supplied token contract (ADR-003)", () => {
    const iface = c.simnet.getContractsInterfaces().get(c.contract)!;
    const takesTrait = iface.functions.some((f: any) =>
      f.args.some((a: any) => JSON.stringify(a.type).includes("trait")));
    expect(takesTrait).toBe(false);
  });
});

// ===========================================================================
// Claim message — H-1 .. H-3
// ===========================================================================
describe("claim message hash", () => {
  it("H-1 the TypeScript implementation matches the contract over random inputs", () => {
    const recipients = [c.w1, c.w2, c.w3, c.deployer, c.contract];
    for (let i = 0; i < 25; i++) {
      const giftId = Math.floor(Math.random() * 1_000_000);
      const recipient = recipients[i % recipients.length];
      const ts = claimMessageHash({ giftId, recipient, contractId: c.contract, chainId: CHAIN_ID.testnet });
      expect(Buffer.from(ts).toString("hex"))
        .toBe(Buffer.from(c.onChainHash(giftId, recipient)).toString("hex"));
    }
  });

  it("H-2 a different gift-id, recipient or contract gives a different hash", () => {
    const base = { giftId: 1, recipient: c.w2, contractId: c.contract, chainId: CHAIN_ID.testnet };
    const h = (o: any) => Buffer.from(claimMessageHash({ ...base, ...o })).toString("hex");
    const b = h({});
    expect(h({ giftId: 2 })).not.toBe(b);
    expect(h({ recipient: c.w3 })).not.toBe(b);
    expect(h({ contractId: `${c.deployer}.ripen-gift-v2` })).not.toBe(b);
    expect(h({ chainId: CHAIN_ID.mainnet })).not.toBe(b);
  });

  it("H-3 a signature produced by the library verifies on-chain (round trip)", () => {
    const { key } = c.createGift();
    expect(pretty(c.claim(1, c.w2, c.signFor(key, 1, c.w2)).result)).toBe("(ok u1)");
  });
});
