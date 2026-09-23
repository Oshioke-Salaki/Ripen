# Roadmap and metrics

**Status:** Draft v1.0 · **Last updated:** 2026-09-23

Milestones map to the Stacks Endowment grant. Acceptance criteria are written so that somebody other than the author can check them.

---

## Milestone 1 — Testnet prototype

**Goal:** a stranger with a browser can send a time-locked sBTC gift and a second stranger can claim it, on testnet, without talking to us.

### Deliverables

| # | Deliverable | Done when |
|---|---|---|
| M1-1 | `ripen-gift-v1.clar` deployed to Stacks testnet | Contract address published in the README; source verified in the explorer |
| M1-2 | Clarinet test suite | Every row of the [test matrix](03-contract-spec.md#9-test-matrix) has a named passing test; `clarinet check` clean |
| M1-3 | Public web app | Create, claim, reclaim, dashboard and receipt all working against testnet |
| M1-4 | Relayed gas-free claims | A wallet with zero STX and zero sBTC completes a claim end to end |
| M1-5 | Demo gift | A visitor claims a pre-funded testnet gift from the homepage without sourcing sBTC; it auto-replenishes |
| M1-6 | Public repository | This documentation, readable contract source, runnable tests, a `SECURITY.md`, and a licence |
| M1-7 | Demo video | Create → time-lock → share → claim → reclaim, unedited timings, showing the empty recipient wallet before claiming |

### Acceptance criteria

1. An independent reviewer completes the full loop from the public URL alone, with no assistance.
2. The recipient's claim requires no STX, no sBTC and no transaction signature.
3. A gift claimed before unlock fails; after expiry fails; with a wrong key fails — each with plain-language copy, never a raw error code.
4. An expired gift returns to its sender when triggered by an account that is not the sender.
5. Pausing creation does not prevent any claim or reclaim (demonstrated, not merely asserted).
6. The claim secret appears in no server log, no analytics payload and no outbound request.

### Sequence

| Order | Work | Why here |
|---|---|---|
| 1 | Clarinet project, mock SIP-010, contract skeleton | Everything depends on the data model |
| 2 | `create-gift` + tests | Simplest path to a real on-chain state |
| 3 | **Message-hash parity** (contract read-only ↔ TypeScript, test H-1) | Highest-risk unknown, and cheapest to discover now. Do this before any UI. |
| 4 | `claim-gift` + signature tests | The core mechanism |
| 5 | `reclaim-gift` + tests | Closes the lifecycle |
| 6 | Testnet deploy + a scripted end-to-end run | Proves the chain half before any React exists |
| 7 | Claim page (states A–F) | The recipient path is the hard one; build it first, not last |
| 8 | Create flow | The sender is patient and technical; the recipient is neither |
| 9 | Relayer + gas-free claim | Converts a working demo into the actual promise |
| 10 | Dashboard, receipts, demo gift | Completes the loop |
| 11 | Polish, copy pass, accessibility, video | — |

Step 3 is placed deliberately early. A mismatch between the client's and the contract's message construction is the one defect that would invalidate the whole design, and it is discoverable in an afternoon with no UI at all.

### Out of scope

Yield, mainnet, passphrases, notifications, embedded wallets, multi-claim drops, chat, any token other than sBTC.

---

## Milestone 2 — Mainnet gifts

**Goal:** real sBTC, real money, deliberately small caps.

### Deliverables

| # | Deliverable | Done when |
|---|---|---|
| M2-1 | External contract review | Report published; every finding resolved or explicitly accepted in writing |
| M2-2 | Mainnet deployment with caps | Per-gift and protocol-wide caps live; a published plan for raising them |
| M2-3 | Themes and message polish | Occasion themes; social cards for each |
| M2-4 | Public on-chain dashboard | Gifts, claims, volume, all derived from chain events and independently reproducible |
| M2-5 | Link recovery | A sender restores a lost link from a wallet signature ([ADR-009](08-decisions.md#adr-009-link-recovery-via-deterministic-re-derivation)) |
| M2-6 | Optional passphrase | Link alone is insufficient when the sender opts in |
| M2-7 | Notifications | Recipient unlock reminders; sender expiry warnings |
| M2-8 | Automatic reclaim sweeper | Expired gifts return without the sender acting |
| M2-9 | Embedded wallet option | A recipient with no wallet completes a claim without leaving the page |

### Acceptance criteria

1. No known unresolved security finding at deployment.
2. Caps enforced on-chain, not only in the UI.
3. The dashboard's numbers are reproducible by a third party from public chain data.
4. Every Milestone 1 testnet gift remains claimable after the mainnet launch.

### Gate before mainnet

No mainnet deployment until: external review complete, the full test matrix green, the owner key on hardware, monitoring and alerting live, an incident runbook written, and `SECURITY.md` published with a working contact.

---

## Milestone 3 — Yield and chat

**Goal:** the gift is worth more when it opens than when it was sent.

### Deliverables

| # | Deliverable | Done when |
|---|---|---|
| M3-1 | Pooled yield vault | Share accounting against an existing Stacks sBTC yield source |
| M3-2 | Yield paid on claim | Claim returns principal plus the gift's share; reclaim likewise |
| M3-3 | Live growth counter | Real accrued yield, shown to sender and recipient, never projected as though earned |
| M3-4 | Chat-to-gift beta | Telegram or WhatsApp; the AI drafts, the user always approves, the AI never holds keys |
| M3-5 | ≥1 sponsored campaign | A third party funds a batch of gifts |

### Design constraints, set now

- **Pooled, not per-gift.** A per-gift yield position would cost more in fees than a small gift earns. One pool with share accounting, like fund units: shares issued at deposit, redeemed at claim.
- **Principal is sacred.** The fee is 10% of *yield earned*, never of principal. The contract must make "principal is always fully redeemable" a structural invariant, not a policy.
- **Instant claimability versus yield-source withdrawal latency is the hard problem.** A gift can be claimed at any moment; a staking position may not be instantly withdrawable. This needs a liquidity buffer design, and it is the first thing to solve — before any UI. It is currently unsolved and is the main technical risk in Milestone 3.
- **Honest display.** A lock shorter than a reward cycle (roughly two weeks) may earn approximately nothing. Say so at creation, before the sender commits.

### Blocking question

Which yield venue, on what terms for small balances, with what withdrawal latency. StackingDAO is the working assumption and has not been verified against these constraints ([PRD §13.1](01-prd.md#13-open-questions), assumption A-5). **Resolve this before designing the vault**, not after.

---

## Instrumentation

### What we count, and from where

Everything financial is derived from chain events, so our numbers are reproducible by anyone. Product-funnel numbers come from first-party analytics with no fragment ever leaving the device (N-10).

| Metric | Source | From |
|---|---|---|
| Gifts created, claimed, reclaimed | `gift-created` / `gift-claimed` / `gift-reclaimed` events | M1 |
| Volume locked, claimed, returned | Event amounts | M1 |
| Claim rate (matured gifts only) | Derived | M1 |
| Time from unlock to claim | Event heights | M1 |
| **New wallets via claims** | Recipient addresses with no prior transaction history at claim time | M1 |
| 30-day sBTC retention | Balance snapshot at claim + 30 days | M2 (mainnet) |
| Claim funnel by step | First-party analytics | M1 |
| Claim flow duration | First-party analytics | M1 |
| Relayer STX spend per claim | Relayer logs | M1 |
| Yield earned and paid | Vault events | M3 |

**"New wallet" is defined precisely** because it is a grant target: a recipient address with zero prior transactions at the block height of its claim. It is measurable from public data, checkable by a reviewer, and impossible for us to inflate quietly. If a definition is going to be reported, it should be one somebody else can audit.

### Grant targets (Milestone 3)

| Target | Number |
|---|---|
| Gifts created | 500+ |
| New Stacks wallets via claims | 300+ |
| Recipients holding sBTC 30 days after claiming | 30%+ |

### Reporting principles

Report gifts created *and* gifts claimed, always together — a created gift nobody opened is not a success. Report claim rate on matured gifts only, never on a denominator inflated with gifts that have not unlocked yet. Publish the queries behind the public dashboard. Never report testnet activity as though it were adoption.

---

*Next: [Decision log](08-decisions.md) · [Glossary](glossary.md)*
