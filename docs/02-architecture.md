# Architecture

**Status:** Draft v1.0 · **Last updated:** 2026-09-23 · **Covers:** Milestone 1, with M2–M3 seams marked.

---

## 1. Shape of the system

```
                     ┌──────────────────────────────────────────┐
                     │              Stacks chain                │
   sender's wallet ──┤  ripen-gift-v1.clar   ◄──► sbtc-token    │
   (Leather/Xverse)  │  (holds all escrowed sBTC)               │
                     └──────────────┬───────────────────────────┘
                                    │ reads (Hiro API)  │ events (Chainhook)
                                    ▼                   ▼
   ┌────────────────┐       ┌──────────────┐     ┌──────────────┐
   │  Next.js app   │◄─────►│   Relayer    │     │   Indexer    │
   │  (PWA)         │       │  submits     │     │  → Postgres  │
   │                │       │  claims,     │     │  dashboard,  │
   │  • create      │       │  pays fees   │     │  analytics   │
   │  • claim       │       └──────────────┘     └──────────────┘
   │  • dashboard   │              │                    ▲
   └───────┬────────┘              └────────────────────┘
           │
           ▼
   ┌────────────────────────────────┐
   │  Gift metadata API + Postgres  │   encrypted message blob,
   │  (never sees a secret)         │   theme, social card data
   └────────────────────────────────┘
```

**The load-bearing property:** every box other than the contract can disappear without any user losing money. The escrow is self-contained — given a gift id and a link key, a claim can be constructed and submitted with nothing but a public Stacks node. Everything else is convenience. This is stated as a requirement, not an accident: see [§8 Degradation](#8-degradation).

## 2. Components

### 2.1 The escrow contract — `ripen-gift-v1.clar`

The only component that holds value. Holds sBTC per gift, enforces the unlock/expiry window, verifies claim signatures, and pays out to exactly two possible destinations: the signature-bound claimant, or the original sender. Fully specified in [03 — Contract specification](03-contract-spec.md).

It references the sBTC token contract **by a hard-coded constant**, not through a trait parameter. A caller-supplied trait would let an attacker pass a counterfeit SIP-010 token and mint worthless gifts that look real in our UI. See [ADR-003](08-decisions.md#adr-003-hard-code-the-sbtc-contract).

| Network | sBTC token contract |
|---|---|
| Mainnet | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| Testnet | `SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token` |
| Devnet / tests | A mock SIP-010 deployed by Clarinet |

*(Both identifiers verified against the live Hiro node APIs on 2026-09-23. sBTC uses 8 decimals, so one sBTC is 100,000,000 base units.)*

### 2.2 The web app — Next.js

One application, three surfaces:

| Route | Rendering | Notes |
|---|---|---|
| `/` | Static | Landing, the demo gift (R-6.4) |
| `/create` | Client | Wallet-connected creation flow |
| `/g/[id]` | Server-rendered shell + client hydration | The claim page. The server renders the social card and public gift facts from chain data; the client reads the fragment and decrypts. |
| `/dashboard` | Client | Sender's gifts |
| `/r/[id]` | Server-rendered | Permanent receipt |

**The fragment discipline.** `/g/[id]#k=<secret>` — the path carries a *public* gift id, the fragment carries the secret. Browsers never transmit a fragment to a server, so the secret is invisible to Ripen, to CDNs, to server logs, and to the link-preview crawler that WhatsApp or Telegram runs when the link is pasted into a chat. That is what lets us render a rich social preview without weakening the gift.

The client cross-checks the two halves: it derives the public key from the fragment, looks up `pubkey → gift-id` on-chain, and refuses to render if that does not equal the id in the path. This defeats a doctored link that pairs a real preview with a different gift.

### 2.3 The relayer

A small signed-service that turns a claim request into a broadcast transaction, paying the STX fee. It holds **only STX**. It has no capability over sBTC, and its signing key gives it no power to redirect a claim, because the recipient address is bound inside the claimant's signature.

```
POST /api/claim  { giftId, recipient, signature }  →  { txid }
```

Before broadcasting it re-validates everything the contract will check — gift exists, is pending, is inside its window, the signature verifies, the recipient is a valid standard principal — so that it never wastes a fee on a transaction destined to abort. Then rate limits, budget caps and a one-relay-per-gift record. Full protocol and abuse controls in [04 — Claim protocol](04-claim-protocol.md).

### 2.4 The gift metadata service

Postgres behind a thin API. Stores, per gift: the encrypted message blob and its IV, the theme id, and the creation timestamp. **It never stores a key, and cannot decrypt anything it holds** — the message is encrypted in the sender's browser under a key derived from the link secret (see [§4](#4-the-message-encrypted-off-chain-committed-on-chain)).

### 2.5 The indexer

Consumes contract events and materialises them into Postgres for the sender dashboard, the public dashboard (M2) and the grant metrics (§10.3 of the [PRD](01-prd.md#103-product-health-metrics-tracked-from-milestone-1)).

Milestone 1 uses **polling the Hiro API** — simple, no infrastructure, adequate at our volume. Milestone 2 moves to **Chainhook** for push delivery. The read model is designed to be fully rebuildable from chain events at any time, so this swap is not a migration.

## 3. Time: Bitcoin blocks, not clocks

Clarity cannot read wall-clock time. It exposes three heights, and choosing among them matters:

| Keyword | What it counts | Pace |
|---|---|---|
| `stacks-block-height` | Stacks blocks | ~5 s post-Nakamoto, and variable |
| `tenure-height` | Stacks tenures | One per Bitcoin block |
| `burn-block-height` | **Bitcoin blocks** | ~10 min, the most stable and most independently verifiable |

**Ripen stores unlock and expiry as `burn-block-height`.** A Bitcoin block is the natural clock for a Bitcoin product, it is stable across Stacks consensus changes, and a recipient can verify "has it opened yet?" against Bitcoin itself. `stacks-block-height` would tie the product's core promise to Stacks block production. (`block-height` no longer exists in Clarity 3.)

The cost is imprecision: Bitcoin blocks arrive on a Poisson process, so a "30 day" lock is 4,320 blocks and will land somewhere around 30 days, not exactly. **We handle this in copy, not in code** — the UI says "opens on or about 25 December" and shows the target block height for anyone who wants the exact truth. Never promise a minute.

Conversion used throughout: **144 blocks ≈ 1 day**, 1,008 ≈ 1 week, 4,320 ≈ 30 days, 52,560 ≈ 1 year.

## 4. The message: encrypted off-chain, committed on-chain

A gift message is personal. Writing "Happy 18th, love Dad" into a public ledger forever is a privacy failure dressed up as decentralisation. Writing it to our database in plaintext makes us a reader of private messages. So neither:

1. The sender's browser derives a message key: `HKDF-SHA256(linkSecret, info = "ripen/msg/v1")`.
2. It encrypts the message with AES-256-GCM and computes `commitment = SHA256(ciphertext ‖ iv)`.
3. The **commitment goes on-chain** in the gift record. The **ciphertext goes to our metadata API**.
4. The recipient's browser fetches the ciphertext, verifies it against the on-chain commitment, and decrypts with a key derived from the same fragment secret.

Result: the message is private from Ripen, private from the chain, and tamper-evident — we cannot substitute a different message without the recipient's browser noticing. The accepted trade-off is durability: if the metadata service is lost, messages are lost. **Funds are not**, and the claim page says so rather than pretending otherwise.

## 5. Frontend stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Server-rendered social cards on the same codebase as the client-only secret handling |
| Wallets | `@stacks/connect` v8 (`connect()` / `request()`) | Supports Leather and Xverse through one API |
| Chain | `@stacks/transactions` | Building calls, post-conditions via the `Pc` builder, consensus serialisation |
| Crypto | `@noble/curves` (secp256k1) + WebCrypto | Key generation, SIP-018 signing, AES-GCM. `@noble/curves` emits low-S signatures by default, which Clarity requires — see [claim protocol §6](04-claim-protocol.md#6-implementation-notes-that-will-bite) |
| Styling | Tailwind + a small token set | Ripeness visual needs tight control over motion and colour |
| State | URL + chain reads; minimal client store | Gift state is on-chain; do not build a second source of truth |
| PWA | `next-pwa` or equivalent, cache-first on the claim shell | N-4: the countdown works offline |

## 6. Repository layout

```
ripen/
├── contracts/            # ripen-gift-v1.clar, mock-sbtc.clar
├── tests/                # Clarinet SDK + Vitest, one file per requirement group
├── deployments/          # Clarinet deployment plans, per network
├── app/                  # Next.js application
│   ├── lib/ripen/        # gift encoding, SIP-018 signing, contract client
│   └── ...
├── relayer/              # claim submission service
├── indexer/              # event ingestion
├── docs/                 # this documentation
└── Clarinet.toml
```

`app/lib/ripen/` is the one module shared by the app, the relayer and the tests, so the signature construction has exactly one implementation. A second implementation of the message hash is a guaranteed source of a silent mismatch.

## 7. Contract versioning

Clarity contracts are immutable, so "upgrading" means deploying `ripen-gift-v2` and pointing new gifts at it. Gifts created in v1 must remain claimable and reclaimable in v1 **forever** — potentially years after we stop creating gifts there.

Therefore:

- Every gift reference in the app, the database and every URL is a **`(contractId, giftId)` pair**, never a bare id. This is true from the first line of code, not retrofitted when v2 arrives.
- A registry of deployed versions ships with the app; the claim page resolves which contract a gift lives in and calls that one.
- The relayer relays for every known version, not just the newest.
- Deprecating a version means blocking *creation* in the UI. It never means dropping support for claiming.

## 8. Degradation

| If this dies | What still works | What breaks |
|---|---|---|
| Relayer | Claiming, via the recipient's own wallet and a little STX (R-3.5) | Gas-free claiming |
| Metadata API | Everything financial; claim page renders without the message | Messages, themes, social card art |
| Indexer | Claim, create, reclaim — all read directly from chain | Dashboards, analytics |
| The whole Ripen frontend | Claim and reclaim via the contract directly; the [claim protocol doc](04-claim-protocol.md) is written to be sufficient to do this by hand | Everything convenient |
| Hiro API | Fall back to a second public endpoint or our own node | Nothing, if failover works |

The last row is the reason [04 — Claim protocol](04-claim-protocol.md) documents the message construction in enough detail to reconstruct a claim from scratch. A self-custody product whose users depend on our website being up is not a self-custody product.

## 9. Environments

| | Devnet | Testnet | Mainnet |
|---|---|---|---|
| sBTC | Mock SIP-010 | Real testnet sBTC | Real sBTC |
| Contract | Deployed by Clarinet | `ripen-gift-v1` | `ripen-gift-v1` (M2) |
| Relayer | Local, unlimited | Budget-capped | Budget-capped, alerting |
| Caps | None | Per-gift cap for parity | Per-gift + protocol cap |
| Demo gift | — | Yes, auto-replenished | Decision open (PRD §13.4) |

---

*Next: [Contract specification](03-contract-spec.md) · [Claim protocol](04-claim-protocol.md) · [Threat model](06-threat-model.md)*
