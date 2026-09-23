/**
 * Ripen claim message — the single implementation.
 *
 * The claim message is constructed in the recipient's browser, re-validated by
 * the relayer, and recomputed on-chain by ripen-gift-v1. A divergence between
 * any two of those makes gifts silently unclaimable, so there is exactly one
 * implementation here and a test (H-1) asserts it matches the contract's own
 * `claim-message-hash` read-only function over random inputs.
 *
 * Format: SIP-018 signed structured data.
 *   sha256( "SIP018" || domainHash || structuredDataHash )
 *
 * See docs/04-claim-protocol.md.
 */
import { Cl, serializeCVBytes } from "@stacks/transactions";
import { sha256 } from "@noble/hashes/sha256";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes, bytesToHex, concatBytes } from "@noble/hashes/utils";

/** ASCII "SIP018". Guarantees signed bytes can never be a valid transaction. */
export const SIP018_PREFIX = hexToBytes("534950303138");

/** Stacks chain IDs. */
export const CHAIN_ID = { mainnet: 1, testnet: 2147483648 } as const;

/** sha256(consensus-serialise({ name, version, chain-id })) */
export function domainHash(chainId: number): Uint8Array {
  return sha256(
    serializeCVBytes(
      Cl.tuple({
        name: Cl.stringAscii("Ripen"),
        version: Cl.stringAscii("1"),
        "chain-id": Cl.uint(chainId),
      }),
    ),
  );
}

export interface ClaimMessage {
  /** On-chain gift id. */
  giftId: number | bigint;
  /** Destination the claim pays. Bound into the signature — this is what stops front-running. */
  recipient: string;
  /** Fully-qualified contract id, e.g. "ST1....ripen-gift-v1". */
  contractId: string;
  chainId: number;
}

/** The exact 32 bytes a claimant signs. */
export function claimMessageHash(m: ClaimMessage): Uint8Array {
  const structured = sha256(
    serializeCVBytes(
      Cl.tuple({
        contract: Cl.principal(m.contractId),
        "gift-id": Cl.uint(m.giftId),
        recipient: Cl.principal(m.recipient),
      }),
    ),
  );
  return sha256(concatBytes(SIP018_PREFIX, domainHash(m.chainId), structured));
}

/**
 * Sign a claim with the one-time key carried in the gift link.
 *
 * Returns 65 bytes: r || s || recovery-id. Clarity's secp256k1-verify REJECTS
 * high-S signatures, so low-S canonical form is mandatory. @noble/curves does
 * this by default; do not disable it.
 */
export function signClaim(privateKey: Uint8Array | string, m: ClaimMessage): Uint8Array {
  const key = typeof privateKey === "string" ? hexToBytes(privateKey) : privateKey;
  const sig = secp256k1.sign(claimMessageHash(m), key, { lowS: true });
  return concatBytes(sig.toCompactRawBytes(), new Uint8Array([sig.recovery]));
}

/** Generate a one-time claim keypair. The private key goes in the link fragment only. */
export function generateClaimKey(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = secp256k1.utils.randomPrivateKey();
  return { privateKey, publicKey: secp256k1.getPublicKey(privateKey, true) };
}

export { bytesToHex, hexToBytes };
