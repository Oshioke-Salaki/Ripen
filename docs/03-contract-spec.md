# Contract specification — `ripen-gift-v1`

**Status:** Draft v1.0 · **Last updated:** 2026-09-23 · **Clarity version:** 3 · **Target:** Stacks testnet (Milestone 1)

This is the specification the implementation and the test suite are both written against. Requirement IDs (`R-x.y`) refer to the [PRD](01-prd.md#8-functional-requirements).

---

## 1. Responsibilities

The contract does four things and nothing else:

1. Takes custody of sBTC against a gift record (`create-gift`).
2. Releases it to an address proven by a signature, inside a time window (`claim-gift`).
3. Returns it to the original sender after that window closes (`reclaim-gift`).
4. Answers questions about gifts (read-only functions).

Everything cosmetic — messages, themes, card art, notifications — is off-chain. The contract stores exactly one non-financial field: a 32-byte commitment to the encrypted message, which exists so the recipient can detect tampering.

## 2. Constants

```clarity
;; --- sBTC token, hard-coded per network (ADR-003) ---
(define-constant SBTC 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token) ;; testnet

;; --- SIP-018 structured data signing ---
(define-constant SIP018-PREFIX 0x534950303138)   ;; ASCII "SIP018"
(define-constant DOMAIN-HASH (sha256 (unwrap-panic (to-consensus-buff?
  { name: "Ripen", version: "1", chain-id: chain-id }))))

;; --- gift status ---
(define-constant STATUS-PENDING   u0)
(define-constant STATUS-CLAIMED   u1)
(define-constant STATUS-RECLAIMED u2)

(define-constant CONTRACT-OWNER tx-sender)
```

`DOMAIN-HASH` folds `chain-id` in, so a signature produced for testnet cannot be replayed on mainnet, and the contract's own principal is bound into the message hash so a signature for `ripen-gift-v1` cannot be replayed against `ripen-gift-v2`.

## 3. Configuration (owner-settable)

| Variable | Initial (testnet) | Purpose |
|---|---|---|
| `min-amount` | `u1000` (0.00001 sBTC) | Below this, network fees dominate the gift — R-1.5 |
| `max-amount` | `u1000000` (0.01 sBTC) | Per-gift blast radius on an unaudited contract |
| `max-total-locked` | `u100000000` (1 sBTC) | Protocol-wide ceiling on value at risk |
| `max-duration` | `u105120` (~2 years in Bitcoin blocks) | Stops an accidental century-long lock |
| `paused` | `false` | Blocks **creation only** — R-6.2 |
| `contract-owner` | deployer | Transferable; see §7 |

Every one of these governs *creation*. None of them can touch a gift that already exists. Raising `min-amount` cannot strand an existing small gift; pausing cannot block a claim; transferring ownership grants no power over escrowed funds. This is [invariant I-6](#6-invariants) and it is tested.

## 4. Data model

```clarity
(define-map gifts uint {
  sender:          principal,
  amount:          uint,          ;; base units of sBTC (8 decimals)
  unlock-height:   uint,          ;; burn-block-height, inclusive
  expiry-height:   uint,          ;; burn-block-height, exclusive
  claim-pubkey:    (buff 33),     ;; compressed secp256k1 public key
  msg-commitment:  (buff 32),     ;; SHA256(ciphertext || iv), or 0x00..00 for no message
  status:          uint,
  recipient:       (optional principal),  ;; set on claim
  created-at:      uint           ;; burn-block-height at creation
})

;; Enforces R-1.7: one public key, one gift, forever.
(define-map pubkey-gift (buff 33) uint)

(define-data-var gift-counter uint u0)
(define-data-var total-locked uint u0)
```

**Notes on the shape.**

- `unlock-height` is **inclusive** and `expiry-height` is **exclusive**. The claimable window is `[unlock, expiry)`. Stating this once, here, avoids a whole family of off-by-one bugs; both boundary blocks are in the test matrix.
- `recipient` is stored on claim for the receipt (R-5.2) and for retention analytics. It is not used in any authorisation decision.
- There is no `message` field. See [architecture §4](02-architecture.md#4-the-message-encrypted-off-chain-committed-on-chain).
- `pubkey-gift` is never deleted, including after a claim. Deleting it would allow a public key to be reused across gifts, which would let an old signature apply to a new gift.

## 5. Public functions

### 5.1 `create-gift`

```clarity
(define-public (create-gift
  (amount uint)
  (unlock-height uint)
  (expiry-height uint)
  (claim-pubkey (buff 33))
  (msg-commitment (buff 32)))
  (response uint uint))
```

Locks `amount` sBTC from `tx-sender` and creates a gift. Returns the new gift id.

**Checks, in order**

| # | Condition | Error |
|---|---|---|
| 1 | `paused` is false | `ERR-PAUSED` |
| 2 | `amount >= min-amount` and `amount <= max-amount` | `ERR-INVALID-AMOUNT` |
| 3 | `total-locked + amount <= max-total-locked` | `ERR-CAP-EXCEEDED` |
| 4 | `expiry-height > unlock-height` | `ERR-INVALID-SCHEDULE` |
| 5 | `expiry-height > burn-block-height` | `ERR-INVALID-SCHEDULE` |
| 6 | `expiry-height - burn-block-height <= max-duration` | `ERR-INVALID-SCHEDULE` |
| 7 | `claim-pubkey` is a valid point — via `(principal-of? claim-pubkey)` | `ERR-INVALID-PUBKEY` |
| 8 | `claim-pubkey` is not already in `pubkey-gift` | `ERR-PUBKEY-IN-USE` |

`unlock-height` may be at or below the current height — that is R-1.4, an immediately-claimable gift — but expiry must be in the future, because a gift that is born expired is only ever a support ticket.

Check 7 is worth the gas: `principal-of?` fails on a malformed key, and a gift bound to an unusable key would be unclaimable until expiry. Cheap insurance against a frontend bug.

**Effects**
1. `contract-call?` sBTC `transfer` for `amount` from `tx-sender` to `(as-contract tx-sender)`, with the memo `none`. The result is unwrapped — a failed transfer aborts the whole call.
2. Write the gift at id `(+ (var-get gift-counter) u1)`; bump the counter; add to `pubkey-gift`; add `amount` to `total-locked`.
3. `print` a `gift-created` event.

> **Clarity note (for a Solidity background):** `(as-contract tx-sender)` switches the sender context to the contract's own principal, which is how a contract holds and later moves tokens. `tx-sender` is the human who signed the transaction — it is *not* `msg.sender`, and it does not change as calls nest. Use `contract-caller` when you need "who called me directly". Here we want the human, so `tx-sender` is correct.

### 5.2 `claim-gift`

```clarity
(define-public (claim-gift
  (gift-id uint)
  (recipient principal)
  (signature (buff 65)))
  (response uint uint))
```

Releases a gift to `recipient`, on proof that the caller holds the gift's claim key.

**This function is deliberately callable by anyone.** Authorisation is the signature, not the transaction sender. That is what makes gas-free claiming possible (R-3.4): Ripen's relayer submits the transaction and pays the fee, and cannot steal, because `recipient` is bound inside the signed message. A mempool observer sees the signature but can only rebroadcast a claim to the *same* recipient — which does nothing. See [04 — Claim protocol](04-claim-protocol.md).

**Checks, in order**

| # | Condition | Error |
|---|---|---|
| 1 | Gift exists | `ERR-NOT-FOUND` |
| 2 | `status == STATUS-PENDING` | `ERR-NOT-PENDING` |
| 3 | `burn-block-height >= unlock-height` | `ERR-STILL-LOCKED` |
| 4 | `burn-block-height < expiry-height` | `ERR-EXPIRED` |
| 5 | `(secp256k1-verify (claim-message-hash gift-id recipient) signature claim-pubkey)` | `ERR-BAD-SIGNATURE` |

Not pausable. There is no state, and no owner action, that can prevent check 5 from being reachable (R-6.2).

**Effects**
1. Set `status` to `STATUS-CLAIMED` and `recipient` to the supplied principal.
2. Subtract `amount` from `total-locked`.
3. `as-contract` transfer of `amount` sBTC to `recipient`.
4. `print` a `gift-claimed` event.

State is written **before** the token transfer. Clarity has no reentrancy, so this is not a reentrancy guard; it is so that a transfer failure aborts the whole transaction atomically and leaves nothing half-done.

### 5.3 `reclaim-gift`

```clarity
(define-public (reclaim-gift (gift-id uint)) (response uint uint))
```

Returns an expired, unclaimed gift to its original sender.

**Permissionless, by design.** Any caller may invoke it, and the destination is always the `sender` recorded in the gift — never the caller. This is strictly safer than restricting it to the sender and strictly better UX:

- There is no destination to get wrong, so opening it up adds no attack surface.
- Ripen can run a sweeper that returns expired gifts automatically, so a sender who forgot about a gift gets their sBTC back without doing anything (R-4.5).
- A "griefer" who calls it is paying a fee to do the sender a favour.

The one honest cost: a sender cannot choose *when* the return lands, which has tax-lot implications in some jurisdictions. Noted, accepted, documented. See [ADR-005](08-decisions.md#adr-005-permissionless-reclaim).

**Checks**

| # | Condition | Error |
|---|---|---|
| 1 | Gift exists | `ERR-NOT-FOUND` |
| 2 | `status == STATUS-PENDING` | `ERR-NOT-PENDING` |
| 3 | `burn-block-height >= expiry-height` | `ERR-NOT-EXPIRED` |

**Effects:** status → `STATUS-RECLAIMED`; `total-locked` decreased; `as-contract` transfer to `sender`; `print` a `gift-reclaimed` event.

### 5.4 Read-only functions

```clarity
(define-read-only (get-gift (gift-id uint))
  (optional { ...gift record... }))

(define-read-only (get-gift-id-by-pubkey (claim-pubkey (buff 33)))
  (optional uint))                     ;; the claim page's primary lookup

(define-read-only (claim-message-hash (gift-id uint) (recipient principal))
  (buff 32))                           ;; the exact bytes to sign — §8

(define-read-only (get-gift-state (gift-id uint))
  (optional { status: uint, claimable: bool, reclaimable: bool,
              blocks-until-unlock: uint, blocks-until-expiry: uint }))

(define-read-only (get-config)
  { min-amount: uint, max-amount: uint, max-total-locked: uint,
    max-duration: uint, total-locked: uint, gift-count: uint, paused: bool })
```

`claim-message-hash` being public and read-only is a deliberate anti-footgun: any client, or a person with a block explorer and no trust in our documentation, can ask the contract itself what to sign. It removes an entire class of "my signature doesn't verify and I can't tell why" failure.

`get-gift-state` exists so the UI makes one call instead of recomputing window logic client-side, where it would drift from the contract.

### 5.5 Administrative functions

```clarity
(define-public (set-paused          (new-paused bool))         (response bool uint))
(define-public (set-limits          (min uint) (max uint) (cap uint) (dur uint)) (response bool uint))
(define-public (transfer-ownership  (new-owner principal))     (response bool uint))
```

All require `tx-sender` to be the current owner. **None of them can move sBTC, alter a gift record, change a schedule, or affect `claim-gift` or `reclaim-gift` in any way.** The entire administrative surface governs whether *new* gifts may be created and within what bounds. This is invariant I-6 and it has dedicated adversarial tests.

## 6. Invariants

These hold at every block height, in every state. Each has at least one test (§9).

| # | Invariant |
|---|---|
| **I-1** | The contract's sBTC balance is greater than or equal to the sum of `amount` over all `STATUS-PENDING` gifts. Equivalently, `total-locked` is always fully backed. |
| **I-2** | A gift's status only ever moves `PENDING → CLAIMED` or `PENDING → RECLAIMED`. Never back, never sideways, never twice. |
| **I-3** | sBTC leaves the contract to exactly two possible destinations: the `recipient` bound in a verified claim signature, or the `sender` stored at creation. There is no third path. |
| **I-4** | A given `claim-pubkey` maps to exactly one gift id, permanently, including after that gift is settled. |
| **I-5** | `claim-gift` and `reclaim-gift` are never blocked by `paused` or by any owner action. |
| **I-6** | No sequence of owner calls can cause any sBTC to reach an address other than a valid claimant or the original sender. |
| **I-7** | `total-locked` equals the sum of `amount` over pending gifts, after any sequence of operations. |

## 7. Errors

```clarity
(define-constant ERR-PAUSED            (err u100))
(define-constant ERR-NOT-AUTHORIZED    (err u101))
(define-constant ERR-NOT-FOUND         (err u102))
(define-constant ERR-NOT-PENDING       (err u103))
(define-constant ERR-STILL-LOCKED      (err u104))
(define-constant ERR-EXPIRED           (err u105))
(define-constant ERR-NOT-EXPIRED       (err u106))
(define-constant ERR-BAD-SIGNATURE     (err u107))
(define-constant ERR-INVALID-AMOUNT    (err u108))
(define-constant ERR-INVALID-SCHEDULE  (err u109))
(define-constant ERR-INVALID-PUBKEY    (err u110))
(define-constant ERR-PUBKEY-IN-USE     (err u111))
(define-constant ERR-CAP-EXCEEDED      (err u112))
(define-constant ERR-INVALID-RECIPIENT (err u114))
```

`u113` is deliberately unused. An earlier draft reserved it for `ERR-TRANSFER-FAILED`, but a failed sBTC transfer propagates the token contract's own error through `try!` rather than being re-wrapped, so no dedicated code is needed. The number is left retired rather than recycled, because the deployed contract cannot be renumbered and a reused code would mean two different failures sharing one number across versions.

`u114` (`ERR-INVALID-RECIPIENT`) rejects the escrow's own principal as a claim destination. Paying the contract itself would leave sBTC inside it with no gift accounting for it, breaking invariant I-1.

Codes are stable across versions and are mapped one-to-one to user-facing copy in [05 — UX flows](05-ux-flows.md#7-error-copy). A raw `u107` must never reach a user; the claim page says "This link doesn't match this gift."

## 8. The claim message

The exact bytes a claimant signs, following [SIP-018](https://github.com/stacksgov/sips/blob/main/sips/sip-018/sip-018-signed-structured-data.md):

```clarity
(define-read-only (claim-message-hash (gift-id uint) (recipient principal))
  (sha256 (concat SIP018-PREFIX
          (concat DOMAIN-HASH
                  (sha256 (unwrap-panic (to-consensus-buff? {
                    gift-id:  gift-id,
                    recipient: recipient,
                    contract: (as-contract tx-sender)
                  })))))))
```

Four bindings, each blocking a specific attack:

| Bound field | Prevents |
|---|---|
| `gift-id` | Replaying a signature against a different gift |
| `recipient` | **Front-running.** A mempool observer cannot redirect the claim, and neither can our relayer |
| `contract` | Replay against another Ripen contract version |
| `chain-id` (inside `DOMAIN-HASH`) | Replay of a testnet signature on mainnet |

The `SIP018-PREFIX` guarantees the signed bytes can never be a valid Stacks transaction, so a claim signature can never be repurposed as an authorisation to move the signer's own funds.

Client-side construction, signature malleability, and the full end-to-end flow: [04 — Claim protocol](04-claim-protocol.md).

## 9. Test matrix

Clarinet SDK + Vitest. Every row is a named test. A row without a test is an unshipped requirement.

### Creation

| # | Case | Expect |
|---|---|---|
| C-1 | Valid creation | `(ok u1)`, sBTC moved, `total-locked` updated, event emitted |
| C-2 | Second gift | id increments to `u2` |
| C-3 | Amount below `min-amount` | `ERR-INVALID-AMOUNT` |
| C-4 | Amount above `max-amount` | `ERR-INVALID-AMOUNT` |
| C-5 | Amount exactly at each bound | Succeeds (boundary) |
| C-6 | Would exceed `max-total-locked` | `ERR-CAP-EXCEEDED` |
| C-7 | `expiry <= unlock` | `ERR-INVALID-SCHEDULE` |
| C-8 | `expiry` in the past | `ERR-INVALID-SCHEDULE` |
| C-9 | Duration beyond `max-duration` | `ERR-INVALID-SCHEDULE` |
| C-10 | `unlock` in the past, `expiry` in the future | Succeeds — immediately claimable (R-1.4) |
| C-11 | Malformed `claim-pubkey` | `ERR-INVALID-PUBKEY` |
| C-12 | Reused `claim-pubkey` | `ERR-PUBKEY-IN-USE` |
| C-13 | Reused pubkey from an already-claimed gift | `ERR-PUBKEY-IN-USE` (I-4) |
| C-14 | Sender has insufficient sBTC | Aborts, no gift written |
| C-15 | While paused | `ERR-PAUSED` |

### Claiming

| # | Case | Expect |
|---|---|---|
| L-1 | Valid claim after unlock | `(ok ...)`, sBTC to recipient, status `CLAIMED` |
| L-2 | Claim at exactly `unlock-height` | Succeeds (inclusive boundary) |
| L-3 | Claim one block before unlock | `ERR-STILL-LOCKED` |
| L-4 | Claim at exactly `expiry-height` | `ERR-EXPIRED` (exclusive boundary) |
| L-5 | Claim one block before expiry | Succeeds |
| L-6 | Double claim | `ERR-NOT-PENDING` |
| L-7 | Signature from the wrong key | `ERR-BAD-SIGNATURE` |
| L-8 | **Valid signature, different `recipient` argument** | `ERR-BAD-SIGNATURE` — the front-running test |
| L-9 | Signature valid for gift 1, submitted for gift 2 | `ERR-BAD-SIGNATURE` |
| L-10 | Malformed / truncated signature | `ERR-BAD-SIGNATURE`, no abort |
| L-11 | High-S (malleated) signature | **Accepted** — `secp256k1-verify` does not enforce low-S. The same test asserts a malleated signature still cannot be redirected to another recipient |
| L-12 | **Claim submitted by a third party** (relayer) | Succeeds; funds reach `recipient`, not the submitter |
| L-13 | Claim on a nonexistent gift | `ERR-NOT-FOUND` |
| L-14 | Claim a reclaimed gift | `ERR-NOT-PENDING` |
| L-15 | Claim while paused | **Succeeds** (I-5) |
| L-16 | Recipient is the contract itself | Rejected or provably safe — must be decided, not discovered |
| L-17 | Recipient is the sender | Succeeds; self-gifting is legitimate (the Saver) |

### Reclaiming

| # | Case | Expect |
|---|---|---|
| X-1 | Sender reclaims after expiry | `(ok ...)`, sBTC home, status `RECLAIMED` |
| X-2 | **Third party reclaims after expiry** | Succeeds; funds go to the *sender*, not the caller (R-4.2) |
| X-3 | Reclaim before expiry | `ERR-NOT-EXPIRED` |
| X-4 | Reclaim at exactly `expiry-height` | Succeeds |
| X-5 | Reclaim a claimed gift | `ERR-NOT-PENDING` |
| X-6 | Double reclaim | `ERR-NOT-PENDING` |
| X-7 | Reclaim while paused | **Succeeds** (I-5) |
| X-8 | Claim after a reclaim | `ERR-NOT-PENDING` |

### Administration and invariants

| # | Case | Expect |
|---|---|---|
| A-1 | Non-owner calls any admin function | `ERR-NOT-AUTHORIZED` |
| A-2 | Pause then create | `ERR-PAUSED` |
| A-3 | Pause then claim and reclaim | Both succeed (I-5) |
| A-4 | Raise `min-amount` above an existing gift's amount, then claim it | Succeeds — config never touches live gifts |
| A-5 | Lower `max-total-locked` below `total-locked`, then claim and reclaim | Both succeed |
| A-6 | Ownership transfer | New owner can administer, old owner cannot |
| A-7 | **Adversarial:** any owner-call sequence that moves sBTC to a third address | Impossible (I-6) |
| A-8 | **Accounting:** random sequence of 50 creates/claims/reclaims | `total-locked` equals the pending sum; contract balance ≥ `total-locked` (I-1, I-7) |
| A-9 | Counterfeit SIP-010 token passed anywhere | No entry point accepts one (ADR-003) |

### Message hash

| # | Case | Expect |
|---|---|---|
| H-1 | `claim-message-hash` matches the TypeScript implementation, over many random inputs | Byte-identical |
| H-2 | Differing `gift-id`, `recipient` or contract | Different hash |
| H-3 | A signature produced by the frontend library verifies on-chain | Round-trip passes |

H-1 and H-3 are the highest-value tests in the suite. A mismatch between the client's message construction and the contract's makes every gift permanently unclaimable, and it is silent until a real user tries to open one.

## 10. Deployment checklist

**Testnet (M1)**
- [ ] `SBTC` constant points at the testnet token
- [ ] Limits set to the testnet values in §3
- [ ] Full matrix green in `clarinet test`; `clarinet check` clean
- [ ] Deployment plan committed under `deployments/`
- [ ] Contract source verified and readable in the explorer
- [ ] Post-deploy smoke: create → claim → reclaim, with real testnet sBTC, from the deployed app
- [ ] Deployed address recorded in the README and in the app's version registry

**Mainnet (M2)** — everything above, plus:
- [ ] `SBTC` constant points at mainnet, asserted by a test that fails on the wrong network
- [ ] External review complete, findings resolved and published
- [ ] Caps set conservatively and a written plan for raising them
- [ ] Ownership key on hardware; recovery documented
- [ ] Monitoring on `total-locked`, claim failures and relayer balance
- [ ] A written incident plan whose first step is *pause creation*, given that claims can never be paused

---

*Next: [Claim protocol](04-claim-protocol.md) · [Threat model](06-threat-model.md) · [Decision log](08-decisions.md)*
