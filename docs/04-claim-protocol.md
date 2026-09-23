# Claim protocol

**Status:** Draft v1.0 · **Last updated:** 2026-09-23

How a gift travels from a sender's wallet, through a link, into a stranger's hands — without that stranger owning anything first. This document is deliberately complete enough that a claim could be reconstructed by hand if every Ripen service were offline.

---

## 1. The core idea

A claim is authorised by **a signature, not by the transaction sender**.

The contract stores a public key. To claim, you prove you hold the matching private key by signing a message that names *where the money should go*. The contract checks the signature and pays that address.

Two consequences follow, and they are the whole product:

**It cannot be front-run.** The obvious design — put a secret in the link, hash it into the contract, reveal the secret to claim — leaks the secret into the mempool the moment a claim is submitted. Anyone watching can copy it and submit their own claim with a higher fee. Because Ripen binds the destination address *inside the signed message*, a copied signature is worthless: it only ever authorises payment to the address it was signed for.

**Anybody can submit the transaction.** The signer and the sender of the transaction need not be the same party. So Ripen's relayer submits the claim and pays the fee, and the recipient — who may have opened a wallet ninety seconds ago — needs no STX, signs no transaction, and approves no wallet prompt. They need an address and nothing else.

This is why Milestone 1 does not use Stacks sponsored transactions. Sponsorship solves "the user signs but someone else pays". Here the user does not need to sign at all. Sponsored transactions remain available as a fallback and as a tool for later flows — see [ADR-004](08-decisions.md#adr-004-relayed-claims-instead-of-sponsored-transactions).

## 2. The link

```
https://ripen.app/g/8f3k2a#k=9c1f...  (64 hex chars)
                   ▲        ▲
                   │        └── secret: the 32-byte claim private key
                   └── public gift id (base36 of the on-chain uint)
```

**Why the secret is in the fragment.** Browsers never send the part after `#` to a server. Not to Ripen, not through a CDN, not into an access log, and — the one that matters most in practice — not to the link-preview crawler that WhatsApp, Telegram, iMessage or Slack fires when the link is pasted into a chat. So Ripen can render a rich social card from the public id while the secret stays on the recipient's device. The privacy property and the marketing surface are not in tension.

**Why the id is in the path at all**, when it could be derived from the key: the server needs *something* to render the preview from, and it must not be the secret.

**The cross-check.** On load, the client derives the public key from the fragment, reads `get-gift-id-by-pubkey` on-chain, and refuses to render if the result does not match the path id. Without this, a doctored link could pair a trustworthy-looking preview ("0.05 sBTC from Ada") with a different, worthless gift.

**Encoding.** Lowercase hex for the secret — unambiguous, copy-pastes cleanly, survives every chat client that mangles case or punctuation. 64 characters is acceptable inside a fragment nobody reads. Base58 would be shorter and is a reasonable future change; hex is chosen for debuggability during Milestone 1.

## 3. Creating a gift

```ts
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

// 1. One-time claim keypair, generated in the sender's browser. Never sent anywhere.
const claimPrivKey = secp256k1.utils.randomPrivateKey();      // 32 bytes
const claimPubKey  = secp256k1.getPublicKey(claimPrivKey, true); // 33 bytes, compressed

// 2. Encrypt the message under a key derived from the same secret.
const msgKey = await hkdf(claimPrivKey, 'ripen/msg/v1');       // HKDF-SHA256
const { ciphertext, iv } = await aesGcmEncrypt(msgKey, message);
const commitment = sha256(concat(ciphertext, iv));             // 32 bytes → on-chain

// 3. Schedule, in Bitcoin blocks.
const unlockHeight = currentBurnHeight + Math.round(days * 144);
const expiryHeight = unlockHeight + 180 * 144;

// 4. Create, with a post-condition the wallet enforces independently of us.
await request('stx_callContract', {
  contract: 'ST...ripen-gift-v1',
  functionName: 'create-gift',
  functionArgs: [uintCV(amount), uintCV(unlockHeight), uintCV(expiryHeight),
                 bufferCV(claimPubKey), bufferCV(commitment)],
  postConditionMode: 'deny',
  postConditions: [
    Pc.principal(senderAddress).willSendEq(amount).ft(SBTC_CONTRACT, 'sbtc-token'),
  ],
});

// 5. The link. Only now does the gift exist anywhere outside this browser.
const link = `https://ripen.app/g/${giftId.toString(36)}#k=${bytesToHex(claimPrivKey)}`;
```

`postConditionMode: 'deny'` plus an exact-amount post-condition means the wallet itself aborts the transaction if anything other than precisely that amount of sBTC leaves the sender's account. The user is not trusting our contract on this point — they are trusting their own wallet. That is the correct place to put the trust, and it is worth saying out loud in the review screen.

**The link exists only in that browser tab.** The sender must save or share it before the flow completes (R-1.10), and we cache it locally as a backstop. If it is lost, nobody can claim the gift and the sBTC returns to the sender at expiry — inconvenient, not lost. Link recovery lands in Milestone 2 ([ADR-009](08-decisions.md#adr-009-link-recovery-via-deterministic-re-derivation)).

## 4. Signing a claim

The recipient's browser has the secret from the fragment and a destination address. It signs, in place, with no wallet involved:

```ts
// The exact bytes, per SIP-018. Must match the contract byte for byte.
const structured = sha256(serializeCV(tupleCV({
  'gift-id':   uintCV(giftId),
  'recipient': principalCV(recipientAddress),
  'contract':  principalCV(ripenContractId),
})));
const domain = sha256(serializeCV(tupleCV({
  name:       stringAsciiCV('Ripen'),
  version:    stringAsciiCV('1'),
  'chain-id': uintCV(chainId),
})));
const messageHash = sha256(concat(SIP018_PREFIX, domain, structured)); // 0x534950303138

// Sign. lowS is @noble/curves' default and Clarity requires it — see §6.
const sig = secp256k1.sign(messageHash, claimPrivKey, { lowS: true });
const signature = concat(sig.toCompactRawBytes(), new Uint8Array([sig.recovery]));  // 65 bytes
```

Do not hand-roll this twice. There is one implementation, in `app/lib/ripen/`, shared by the app, the relayer and the tests, and it is verified against the contract's own `claim-message-hash` read-only function over random inputs (test H-1). A client/contract mismatch here makes every gift silently unclaimable.

## 5. Submitting the claim

### 5.1 Relayed — the default

```
recipient's browser                 relayer                    chain
       │                               │                         │
       │  POST /api/claim              │                         │
       │  { giftId, recipient, sig }   │                         │
       ├──────────────────────────────►│                         │
       │                               │ revalidate everything   │
       │                               │ the contract will check │
       │                               │                         │
       │                               │  claim-gift(...) tx,    │
       │                               │  relayer pays the fee   │
       │                               ├────────────────────────►│
       │         { txid }              │                         │
       │◄──────────────────────────────┤                         │
```

The recipient contributes a signature and an address. No STX, no wallet transaction, no approval dialog. The relayer's own key pays the fee and has no other power in the flow.

**Relayer validation, before spending a fee.** Every check the contract will make, made first, so we never burn STX on a transaction that is going to abort:

1. The gift exists, is `PENDING`, and `unlock ≤ burn-block-height < expiry`.
2. The signature verifies off-chain against the stored `claim-pubkey`, using the shared library.
3. `recipient` is a well-formed standard principal on the right network, and is not a contract principal.
4. The gift's amount is at or above the relay threshold (we do not spend a fee to deliver dust).
5. No relay has previously been issued for this gift id — recorded durably, checked atomically.
6. Per-IP and global rate limits pass, and the daily STX budget has room.

Then: build, sign, broadcast, record the txid against the gift, return it.

**What a fully compromised relayer can do.** Refuse to relay, delay a claim, or broadcast claims that were already validly authorised. It cannot redirect a single satoshi, because the destination is inside the signature it is merely carrying. It holds STX only. This bound is the reason the relayer is allowed to exist at all.

### 5.2 Self-submitted — the fallback

If the relayer is down, over budget, or the gift is below the relay threshold, the same signature goes into a transaction the recipient sends themselves (R-3.5). They need a small amount of STX. The UI offers this automatically rather than dead-ending, and explains why it is asking.

### 5.3 Sponsored — available, not needed

Stacks supports native sponsored transactions: the origin builds with `sponsored: true` and a zero fee, signs it, and a sponsor calls `sponsorTransaction()` to attach the fee and broadcast. Through a wallet, that is `request('stx_signTransaction', { transaction, broadcast: false })`, then hand the signed hex to the sponsor service.

We do not need it for claims, because the recipient does not need to be the transaction's origin at all. It is documented here because it *is* the right tool for later flows where the user must be the origin — a sender with sBTC but no STX, say — and because it is worth recording that we considered it and found a simpler path.

One practical note in its favour: sponsored-transaction signing is [currently broken in Leather's mobile wallet](https://github.com/leather-io/mono/issues/2788). The relayed design does not care, because it never asks a wallet to sign anything. Choosing the architecture that touches the fewest wallet code paths was the right call for a product whose users are on phones.

## 6. Implementation notes that will bite

**Signature malleability — and a correction.** The Stacks documentation states that `secp256k1-verify` rejects high-S signatures to enforce canonical low-S form. We tested it against the deployed Clarity version and it does not. A malleated signature `(r, n-s)` verifies exactly as `(r, s)` does, in both 64- and 65-byte form, and the trailing recovery byte is ignored entirely.

This does not hurt Ripen. The recipient is bound inside the signed message, so a malleated signature still only pays the address it was signed for — test L-11 asserts exactly that. It does have one operational consequence: **the relayer's one-relay-per-gift record must be keyed on gift id, never on signature bytes**, because the same authorisation has more than one valid byte representation.

We still sign low-S (`@noble/curves` does so by default). Standard practice, and it costs nothing.

**Signature length.** `secp256k1-verify` accepts a 64-byte `(r, s)` or 65 bytes with a trailing recovery id. We standardise on 65 for consistency with `secp256k1-recover?` and the wider ecosystem. Fix the type in the contract signature; do not accept both.

**`to-consensus-buff?` is the contract's serialiser, `serializeCV` is the client's.** They must agree exactly, including field ordering inside the tuple. Clarity serialises tuple fields in lexicographic order by key name; make sure the client does too, and pin it with test H-1 rather than reading it off a blog post.

**Public key validity.** `principal-of?` returns `(err u1)` on a malformed key. `create-gift` uses it as a guard so a frontend bug cannot mint a gift nobody can ever open.

**Claim races.** Two devices can submit valid claims to different addresses at the same time. The first to confirm wins; the second aborts with `ERR-NOT-PENDING`. The UI must treat that as "already opened — here's where it went" rather than as an error, because it is the expected outcome of a shared link.

**Nonce management on the relayer.** Serialise transaction building behind a single nonce source. Two claims broadcast from the same relayer key within one block with the same nonce means one is dropped — which shows up as a claim that mysteriously never confirms.

## 7. Claiming without Ripen

If the app is gone and the relayer is gone, the escrow still works. With only a block explorer, a node and the link:

1. Take the 64 hex characters after `#k=` — that is the claim private key.
2. Derive the compressed public key, and call `get-gift-id-by-pubkey` on the contract to find the gift id.
3. Call the contract's own `claim-message-hash(gift-id, your-address)` read-only function. It returns the exact 32 bytes to sign.
4. Sign those bytes with the claim key. 65-byte compact form with a recovery id is what Ripen emits; a 64-byte signature also verifies.
5. Call `claim-gift(gift-id, your-address, signature)` from any Stacks account with a little STX.

Step 3 is why `claim-message-hash` is a public read-only function: the contract is the authority on what to sign, so no one ever has to trust this document to get their money out.

---

*Next: [UX flows and copy](05-ux-flows.md) · [Threat model](06-threat-model.md)*
