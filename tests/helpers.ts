import { initSimnet } from "@stacks/clarinet-sdk";
import { Cl, ClarityValue } from "@stacks/transactions";
import { claimMessageHash, signClaim, generateClaimKey, CHAIN_ID } from "../lib/claim-message";

export type Simnet = Awaited<ReturnType<typeof initSimnet>>;

export const ERR = {
  PAUSED: 100, NOT_AUTHORIZED: 101, NOT_FOUND: 102, NOT_PENDING: 103,
  STILL_LOCKED: 104, EXPIRED: 105, NOT_EXPIRED: 106, BAD_SIGNATURE: 107,
  INVALID_AMOUNT: 108, INVALID_SCHEDULE: 109, INVALID_PUBKEY: 110,
  PUBKEY_IN_USE: 111, CAP_EXCEEDED: 112, INVALID_RECIPIENT: 114,
} as const;

export const STATUS = { PENDING: 0, COMPLETED_CLAIM: 1, RECLAIMED: 2 } as const;

/** Default config from the contract. */
export const CONFIG = { MIN: 1_000, MAX: 1_000_000, CAP: 100_000_000, MAX_DURATION: 105_120 };

export function pretty(cv: ClarityValue): string {
  return Cl.prettyPrint(cv);
}
export function expectOk(cv: ClarityValue, inner?: string) {
  const s = pretty(cv);
  if (!s.startsWith("(ok ")) throw new Error(`expected ok, got ${s}`);
  if (inner !== undefined && s !== `(ok ${inner})`) throw new Error(`expected (ok ${inner}), got ${s}`);
  return s;
}
export function isErr(cv: ClarityValue, code: number): boolean {
  return pretty(cv) === `(err u${code})`;
}
export function uintOf(cv: ClarityValue): bigint {
  const m = pretty(cv).match(/u(\d+)/);
  if (!m) throw new Error(`no uint in ${pretty(cv)}`);
  return BigInt(m[1]);
}

export class Ctx {
  simnet!: Simnet;
  deployer!: string;
  w1!: string; w2!: string; w3!: string;
  contract!: string;
  token!: string;

  static async fresh(): Promise<Ctx> {
    const c = new Ctx();
    c.simnet = await initSimnet();
    const a = c.simnet.getAccounts();
    c.deployer = a.get("deployer")!;
    c.w1 = a.get("wallet_1")!;
    c.w2 = a.get("wallet_2")!;
    c.w3 = a.get("wallet_3")!;
    c.contract = `${c.deployer}.ripen-gift-v1`;
    c.token = `${c.deployer}.mock-sbtc-token`;
    return c;
  }

  mint(to: string, amount: number) {
    return this.simnet.callPublicFn(this.token, "mint", [Cl.uint(amount), Cl.principal(to)], this.deployer);
  }
  balance(who: string): bigint {
    return uintOf(this.simnet.callReadOnlyFn(this.token, "get-balance", [Cl.principal(who)], this.deployer).result);
  }
  contractBalance(): bigint { return this.balance(this.contract); }

  get burn(): number { return this.simnet.burnBlockHeight; }
  advanceBurn(n: number) { this.simnet.mineEmptyBurnBlocks(n); }

  config() {
    const r = this.simnet.callReadOnlyFn(this.contract, "get-config", [], this.deployer).result;
    return pretty(r);
  }
  totalLocked(): bigint {
    const s = this.config();
    // NB: must not match "max-total-locked"
    const m = s.match(/(?:^|[,{\s])total-locked:\s*u(\d+)/);
    return BigInt(m![1]);
  }

  /** Create a gift. Returns the response plus the key material used. */
  createGift(opts: {
    sender?: string; amount?: number; unlockIn?: number; expiryIn?: number;
    key?: { privateKey: Uint8Array; publicKey: Uint8Array };
    pubkeyOverride?: Uint8Array; commitment?: Uint8Array;
  } = {}) {
    const sender = opts.sender ?? this.w1;
    const amount = opts.amount ?? 10_000;
    const unlock = this.burn + (opts.unlockIn ?? 0);
    const expiry = this.burn + (opts.expiryIn ?? 1_000);
    const key = opts.key ?? generateClaimKey();
    const pubkey = opts.pubkeyOverride ?? key.publicKey;
    const commitment = opts.commitment ?? new Uint8Array(32).fill(7);
    const res = this.simnet.callPublicFn(this.contract, "create-gift", [
      Cl.uint(amount), Cl.uint(unlock), Cl.uint(expiry),
      Cl.buffer(pubkey), Cl.buffer(commitment),
    ], sender);
    return { res, key, amount, unlock, expiry, sender };
  }

  signFor(key: { privateKey: Uint8Array }, giftId: number | bigint, recipient: string) {
    return signClaim(key.privateKey, {
      giftId, recipient, contractId: this.contract, chainId: CHAIN_ID.testnet,
    });
  }

  claim(giftId: number | bigint, recipient: string, signature: Uint8Array, submitter?: string) {
    return this.simnet.callPublicFn(this.contract, "claim-gift", [
      Cl.uint(giftId), Cl.principal(recipient), Cl.buffer(signature),
    ], submitter ?? this.w3);
  }

  reclaim(giftId: number | bigint, caller?: string) {
    return this.simnet.callPublicFn(this.contract, "reclaim-gift", [Cl.uint(giftId)], caller ?? this.w3);
  }

  gift(giftId: number | bigint) {
    return pretty(this.simnet.callReadOnlyFn(this.contract, "get-gift", [Cl.uint(giftId)], this.deployer).result);
  }
  giftState(giftId: number | bigint) {
    return pretty(this.simnet.callReadOnlyFn(this.contract, "get-gift-state", [Cl.uint(giftId)], this.deployer).result);
  }
  onChainHash(giftId: number | bigint, recipient: string): Uint8Array {
    const s = pretty(this.simnet.callReadOnlyFn(this.contract, "claim-message-hash",
      [Cl.uint(giftId), Cl.principal(recipient)], this.deployer).result);
    const hex = s.replace(/^0x/, "");
    return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  }
  setPaused(v: boolean, caller?: string) {
    return this.simnet.callPublicFn(this.contract, "set-paused", [Cl.bool(v)], caller ?? this.deployer);
  }
  setLimits(min: number, max: number, cap: number, dur: number, caller?: string) {
    return this.simnet.callPublicFn(this.contract, "set-limits",
      [Cl.uint(min), Cl.uint(max), Cl.uint(cap), Cl.uint(dur)], caller ?? this.deployer);
  }
  transferOwnership(to: string, caller?: string) {
    return this.simnet.callPublicFn(this.contract, "transfer-ownership", [Cl.principal(to)], caller ?? this.deployer);
  }
}

export { Cl, claimMessageHash, signClaim, generateClaimKey, CHAIN_ID };
