# Security policy

Ripen holds other people's Bitcoin. Reports are taken seriously and answered.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting** — the *Security* tab of this
repository, "Report a vulnerability". It creates a private thread visible only
to the maintainer, so nothing is disclosed while it is being fixed.

Please do not open a public issue for a security problem.

**What to expect:** acknowledgement within 72 hours, an assessment within
7 days, and credit in the fix unless you prefer otherwise. If you do not hear
back within 72 hours, open a public issue saying only that you are waiting on a
security response — no details.

## Scope

**In scope**

- `contracts/ripen-gift-v1.clar` — the escrow
- `lib/claim-message.ts` — claim message construction and signing
- Anything that could move escrowed sBTC to an address other than the
  signature-bound claimant or the original sender
- Anything that could make an existing gift permanently unclaimable
- Anything that leaks a claim key off the holder's device

**Out of scope**

- The sBTC token, the Stacks chain, Clarity itself, Leather and Xverse
- `contracts/mock-sbtc-token.clar` — a test double, never deployed
- Testnet-only issues with no mainnet equivalent
- Findings that require the reporter to already hold the gift's claim link

## Current status

Nothing is on mainnet. The escrow is deployed to **testnet only**, holds no real
value, and **has not been audited**. An external review is planned before any
mainnet deployment ([roadmap](docs/07-roadmap-and-metrics.md)).

## Known and accepted

Documented rather than hidden. Both are covered in the
[threat model](docs/06-threat-model.md).

- **Gift links are bearer instruments.** Anyone holding the link can claim the
  gift. This is inherent to claiming without an account. Disclosed in the UI; an
  optional passphrase is planned.
- **Claim signatures are malleable.** Clarity's `secp256k1-verify` does not
  enforce canonical low-S form, contrary to the Stacks documentation — we
  established this by testing it (see test `L-11`). Harmless here, because the
  recipient is bound inside the signed message, so a malleated signature still
  only pays the address it was signed for. The operational consequence is that
  relayer idempotency must key on gift id, never on signature bytes.

## Design commitments

These are structural, and there are tests asserting each one:

- No administrative path can move user funds to any address other than the
  claimant or the original sender.
- Creation can be paused. **Claiming and reclaiming can never be paused.**
- Every deployed contract version stays claimable and reclaimable indefinitely.
