# Ripen — Product Requirements

**Status:** Draft v1.0 · **Owner:** Oshioke · **Last updated:** 2026-09-23
**Scope:** Milestone 1 specified to build-ready depth; Milestones 2–3 specified to intent depth.

---

## 1. Summary

Ripen is a non-custodial sBTC escrow on Stacks where **time is the product**. A sender locks sBTC, sets when it opens, and shares a link. The recipient opens the link and claims — with no existing balance, no gas, and no transaction to sign. Unclaimed value always returns to the sender.

The first surface is **gifting**, because gifting is the one financial act where a waiting period is desirable rather than annoying. The same escrow then carries savings locks, vesting, payouts, and prize pools without a new contract model.

**The sentence we want a stranger to repeat:** *"Someone sent me Bitcoin in a link, it opened on my birthday, and it was worth more than when they sent it."*

## 2. The problem

Sending crypto to somebody who does not already hold crypto fails at a predictable place. The sender manages it. The recipient hits a wall: install a wallet, understand an address, and then — the part nobody warns them about — discover they cannot touch the asset they were just given because moving it costs a *different* asset they do not have. A gift that requires the recipient to first acquire gas is not a gift; it is homework.

Three specific failures we are targeting:

| # | Failure | Consequence |
|---|---|---|
| P1 | The recipient needs a funded wallet before they can receive | The highest-intent onboarding moment in crypto — somebody *giving* you money — is where the funnel breaks |
| P2 | A transfer is instantaneous and final, so there is no way to send value that is meant for later | Birthdays, graduations, "don't spend this yet", allowances and prizes have no native on-chain form |
| P3 | Money in flight earns nothing, and money "saved for later" in a wallet earns nothing either | The waiting period is pure loss, so nobody chooses to wait |

Ripen's claim: fix P1 and P2 first (they are what make the product usable at all), then P3 turns the waiting period from a cost into a feature.

> **Honesty note.** These are the founder's stated hypotheses from prior work on GoodDrops, not findings from user research. No user interviews have been conducted for Ripen. See [§12 Assumptions](#12-assumption-register) — several of these are marked unvalidated and have a cheap validation plan attached.

## 3. Why Stacks, why now

- **sBTC is real Bitcoin, and Bitcoin is the asset people actually want to be given.** Gifting a governance token is a novelty. Gifting Bitcoin is a gift. sBTC is a 1:1 BTC-backed SIP-010 token on Stacks, so it behaves like an ordinary fungible token in a contract while representing the asset with the most cultural weight.
- **Clarity makes the escrow auditable by a non-specialist.** It is decidable, has no reentrancy, and post-conditions let the *user's wallet* enforce what leaves their account independently of the contract. For a product whose whole promise is "your money is safe while it waits", that is the right substrate.
- **Bitcoin blocks are a good clock.** Clarity can read the Bitcoin chain's height directly (`burn-block-height`), giving the time-lock an approximately ten-minute tick that is independent of Stacks block production.
- **Relayed claims are cheap.** A claim transaction on Stacks costs a fraction of a cent, so Ripen can pay every recipient's fee out of pocket indefinitely at our scale, which is what makes P1 solvable.
- **The ecosystem needs this shape of app.** Stacks has yield venues, DEXes and lending. It has very little that is designed for somebody's *first* interaction with the chain.

## 4. Users

### 4.1 Primary: the Sender

Holds sBTC. Wants to give some of it to a specific person, and wants the act to feel like a gift rather than a wire transfer.

- **Job:** *"I want to give my niece some Bitcoin for her birthday next month, without it turning into a two-hour tech-support call."*
- Needs: confidence the money cannot be lost; a way to say something along with it; a way to get it back if it goes unclaimed; proof of what they sent.
- Fears: sending to the wrong place; the recipient not understanding; the money being stuck forever.

### 4.2 Primary: the Recipient

May have never touched crypto. Arrives via a link in WhatsApp, Telegram, iMessage or email.

- **Job:** *"Somebody sent me something. I want to see what it is and get it, without a lecture."*
- Needs: to understand what they have been given before committing to anything; to get it in under a minute; to not need money in order to receive money.
- Fears: scams; doing something irreversible; looking stupid.

### 4.3 Secondary (Milestone 2–3)

| User | Job |
|---|---|
| **The Saver** | *"Lock this away from myself until December and let it earn."* Same escrow, sender = recipient. |
| **The Organiser** | *"Fund 20 hackathon prizes as claimable links and get the unclaimed ones back."* One creation, many gifts. |
| **The Payer** | *"Pay my contractor on a schedule without babysitting it."* Escrow with a schedule. |

Milestone 1 builds for 4.1 and 4.2 only. The others are named to keep the contract design from painting us into a corner — not to be built now.

## 5. Product principles

These are decisions, not aspirations. Each one has a testable consequence.

1. **A sent gift is a promise.** The sender cannot cancel a gift before it expires. If a sender could pull a gift back at will, the recipient's countdown page would be meaningless. *Consequence:* no `cancel-gift` function in v1 (see [ADR-006](08-decisions.md#adr-006-no-early-cancellation)).
2. **Nothing is ever stranded.** Every gift has a mandatory expiry, and after it, anybody can send the funds home to the sender. *Consequence:* `reclaim-gift` is permissionless and hard-wires the destination to the stored sender.
3. **Receiving money must not require money.** *Consequence:* the recipient never signs a Stacks transaction in the default claim path.
4. **The secret never reaches our servers.** *Consequence:* the claim key lives only in the URL fragment; there is an automated test asserting no code path posts it.
5. **On-chain holds value and rules; off-chain holds presentation.** Amounts, timing, the claim key and a message *commitment* go on-chain. Gift messages, themes and card art live off-chain, encrypted. *Consequence:* a personal message is not published forever in a public ledger, and Ripen cannot read it either.
6. **We never hold user funds.** The only balance Ripen controls is the relayer's STX for paying fees. It cannot move sBTC. *Consequence:* worst case for a total Ripen compromise is that claims stop working, not that money is lost.
7. **Honest numbers.** If a lock is too short to earn meaningful yield, we say so before the sender commits, in the same screen, at the same font size as the upside.
8. **Old gifts stay claimable forever.** Clarity contracts are immutable, so new versions are new deployments and the app routes each gift to the contract it was created in — permanently. *Consequence:* the frontend is multi-version from day one, not retrofitted.

## 6. The experience

### 6.1 The five moments that have to land

| # | Moment | The bar |
|---|---|---|
| **W1** | **Sending** | Connect → amount → when it opens → message → sign. Under 60 seconds, ending on a beautiful shareable card, never on a transaction hash. |
| **W2** | **Arriving** | The recipient opens the link and immediately sees who it is from, what is inside, when it opens, and a live countdown — *before* connecting anything. No wall, no modal, no "connect wallet to continue". |
| **W3** | **Opening** | One tap. No gas, no STX, no signature, no seed phrase. The gift visibly opens and the balance is theirs. Target: under 60 seconds from tap to confirmed. |
| **W4** | **The receipt** | A permanent page proving what was sent, by whom, when it opened and when it was claimed. Shareable, and it works for both parties. |
| **W5** | **The growth** *(M3)* | "It grew while you waited: +1,240 sats." A number that visibly moves, on both the sender's dashboard and the recipient's countdown. |

### 6.2 The ripening metaphor

The gift has a visible ripeness that runs 0 → 100% between creation and unlock, rendered as the core visual on the claim page, the sender's dashboard and the social preview card. Ripe means claimable. After expiry it falls and goes home. This is the reason to name the product Ripen and the reason the countdown page is worth revisiting rather than a dead waiting room.

It is also the honest visual for Milestone 3: ripeness is *time*, and yield is a second, separate number. We never draw yield the gift has not earned.

### 6.3 What makes reviewers and newcomers say "wow"

- **No-wallet claim.** The recipient supplies a destination and nothing else. Everything else in the space asks for a signature here.
- **A pre-funded demo gift on the homepage.** A grant reviewer, or anyone curious, can claim a real testnet gift in about thirty seconds without first sourcing testnet sBTC. It auto-replenishes. This is a Milestone 1 requirement, not a nicety — see R-6.4.
- **The social card.** When the link is pasted into a chat, the preview already says *"Ada sent you sBTC — opens 25 December"* with the ripeness ring. The secret is in the URL fragment, so the chat app's crawler cannot see it. The preview is the marketing.
- **Post-condition transparency.** Before signing, the sender sees in plain English exactly what will leave their wallet, backed by a wallet-enforced post-condition rather than our promise.

## 7. Scope

### 7.1 Milestone 1 — testnet prototype (current)

**In:** Clarity escrow on Stacks testnet · create / claim / reclaim · Bitcoin-block time-locks · signature-based claim · relayed (gas-free) claim · encrypted gift message + theme · sender dashboard · social preview cards · public demo gift · Clarinet test suite · this documentation · demo video.

**Out:** yield of any kind · mainnet · passphrase-protected gifts · multi-claim drops · embedded wallets · notifications · chat-to-gift · any token other than sBTC.

### 7.2 Milestone 2 — mainnet gifts

Mainnet deploy with per-gift and protocol-wide caps and external review · gift themes and message polish · public on-chain dashboard · link recovery for senders · optional passphrase · reminder notifications · claim fallback via a self-paid transaction.

### 7.3 Milestone 3 — yield and chat

Pooled yield vault against an existing Stacks sBTC yield source · principal + yield at claim · live growth counter · chat-to-gift beta (drafts only; the user always approves and the AI never holds keys) · at least one sponsored campaign.

### 7.4 Explicit non-goals

Custody of user funds · our own yield strategy · our own bridge or wrapped asset · a token · a DAO · native mobile apps (the PWA is the mobile app) · NFT gift cards · support for non-sBTC assets before Milestone 3 · being a wallet.

## 8. Functional requirements

Requirement IDs are referenced by the [contract spec](03-contract-spec.md) and the test matrix. **M1** = required for Milestone 1.

### R-1 Creating a gift

| ID | Requirement | M1 |
|---|---|---|
| R-1.1 | A sender can lock a chosen amount of sBTC into the escrow in a single transaction. | ✅ |
| R-1.2 | The sender sets an unlock time and an expiry time; both are stored as Bitcoin block heights. | ✅ |
| R-1.3 | Expiry is mandatory and must be after unlock. Default expiry is unlock + 180 days. | ✅ |
| R-1.4 | Unlock may be "now" (unlock height ≤ current height), producing an immediately-claimable gift. | ✅ |
| R-1.5 | Amount must be within a configurable `[min, max]` band, and the protocol enforces a global cap on total value locked. | ✅ |
| R-1.6 | The gift is bound to a one-time public key generated in the sender's browser; its private key goes only into the share link's URL fragment. | ✅ |
| R-1.7 | A public key may only ever be bound to one gift. | ✅ |
| R-1.8 | The sender may attach a message (≤ 500 characters) and a theme. The message is encrypted client-side to a key derived from the claim key; only a hash commitment is stored on-chain. | ✅ |
| R-1.9 | The sender's wallet must display a post-condition asserting the exact sBTC amount leaving their account. | ✅ |
| R-1.10 | After creation the sender must actively copy, share or save the link before the flow is considered complete; the link is also cached in their browser. | ✅ |
| R-1.11 | A sender can restore lost links by re-deriving them from a wallet signature. | M2 |
| R-1.12 | A sender can require a passphrase in addition to the link. | M2 |
| R-1.13 | A sender can create many gifts from one deposit (a drop) with a shared budget. | M3 |

### R-2 Waiting

| ID | Requirement | M1 |
|---|---|---|
| R-2.1 | Anyone holding the link can view the gift's sender, amount, unlock time, expiry and current state without connecting a wallet. | ✅ |
| R-2.2 | The message is decrypted in the recipient's browser and is never available to Ripen's servers. | ✅ |
| R-2.3 | The claim page shows a live countdown and ripeness indicator, and remains correct if opened offline-first from cache. | ✅ |
| R-2.4 | Times are displayed in the viewer's local timezone with an explicit approximation caveat, because Bitcoin block times vary. | ✅ |
| R-2.5 | The recipient can add the unlock moment to their calendar. | ✅ |
| R-2.6 | The recipient can opt into a reminder notification. | M2 |
| R-2.7 | The claim page displays accrued yield, updating live. | M3 |

### R-3 Claiming

| ID | Requirement | M1 |
|---|---|---|
| R-3.1 | A gift can be claimed only at or after unlock and strictly before expiry. | ✅ |
| R-3.2 | A claim requires a signature, made with the link's private key, over a message binding the gift id, the destination address, the contract and the chain. | ✅ |
| R-3.3 | The destination address is chosen by the link holder and is bound into the signature, so no observer — including Ripen's own relayer — can redirect a claim. | ✅ |
| R-3.4 | The claim transaction may be submitted by any party; the recipient is not required to hold STX or sign a Stacks transaction. | ✅ |
| R-3.5 | The recipient may instead submit the claim themselves from their own wallet, as a fallback when the relayer is unavailable. | ✅ |
| R-3.6 | A gift can be claimed at most once. | ✅ |
| R-3.7 | The recipient can obtain a destination address by connecting Leather or Xverse, or by pasting an address, with validation and a clear warning against exchange deposit addresses. | ✅ |
| R-3.8 | Claim confirmation states (submitted → in a Stacks block → Bitcoin-anchored) are surfaced honestly. | ✅ |
| R-3.9 | The recipient can create a wallet inside the flow without leaving the page. | M2 |
| R-3.10 | A claim pays principal plus the gift's share of accrued yield. | M3 |

### R-4 Reclaiming

| ID | Requirement | M1 |
|---|---|---|
| R-4.1 | After expiry, an unclaimed gift can be returned to its original sender. | ✅ |
| R-4.2 | The return is permissionless — any caller may trigger it — and the destination is always the stored sender. | ✅ |
| R-4.3 | A gift cannot be reclaimed before expiry or after it has been claimed. | ✅ |
| R-4.4 | The sender's dashboard surfaces reclaimable gifts prominently and offers a one-tap return. | ✅ |
| R-4.5 | Ripen operates an automatic sweeper that returns expired gifts without the sender doing anything. | M2 |
| R-4.6 | The sender is notified before and at expiry. | M2 |

### R-5 Sender dashboard and receipts

| ID | Requirement | M1 |
|---|---|---|
| R-5.1 | A connected sender sees every gift they have created, with status, countdown and share link where available. | ✅ |
| R-5.2 | Every gift has a permanent public receipt page showing its full lifecycle and linking to the explorer. | ✅ |
| R-5.3 | A public dashboard shows protocol totals: gifts created, claimed, reclaimed, and volume. | M2 |

### R-6 Trust, safety and operations

| ID | Requirement | M1 |
|---|---|---|
| R-6.1 | The app states plainly that anyone with the link can claim the gift, at the point the link is created and again at the point it is shared. | ✅ |
| R-6.2 | Creation can be paused by the contract owner; claiming and reclaiming can never be paused. | ✅ |
| R-6.3 | No administrative path exists that can move a user's funds to any address other than the claimant or the original sender. | ✅ |
| R-6.4 | The homepage offers a pre-funded, auto-replenishing demo gift that any visitor can claim on testnet without sourcing sBTC. | ✅ |
| R-6.5 | The app detects a zero testnet sBTC balance and guides the sender to a faucet. | ✅ |
| R-6.6 | Relayer sponsorship is rate-limited, budget-capped, and can serve each gift at most once. | ✅ |
| R-6.7 | Every contract version ever deployed remains reachable by the app for claim and reclaim, indefinitely. | ✅ |

## 9. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| N-1 | Claim page first contentful paint on a mid-range Android over 3G | < 2.5 s |
| N-2 | Claim page usable without a wallet extension installed | Always |
| N-3 | Mobile-first; every flow completable on a 360 px viewport | 100% |
| N-4 | Installable PWA; the countdown page works from cache when offline | Yes |
| N-5 | Contract test coverage across specified paths | 100% of the [test matrix](03-contract-spec.md#9-test-matrix) |
| N-6 | Accessibility | WCAG 2.2 AA; countdown not conveyed by colour alone |
| N-7 | Copy language | English at launch; all user-facing strings externalised for translation |
| N-8 | Chain read path | Degrades to a public Hiro endpoint if our indexer is down |
| N-9 | Terminology | "sBTC" in all product copy about on-chain amounts — never "sats" or "BTC" |
| N-10 | Analytics | No third-party script may receive a URL fragment |

## 10. Success metrics

### 10.1 Milestone 1 (prototype — qualitative gate)

An independent reviewer, given only the public URL, can create a time-locked gift, share it, claim it from a different browser with an empty wallet, and reclaim an expired one — without contacting us. That is the bar. Volume metrics are not meaningful on testnet and we will not report them as though they were.

### 10.2 Milestone 3 (grant target)

| Metric | Target | How measured |
|---|---|---|
| Gifts created (organic) | 300 | On-chain `gift-created` events, excluding team- and sponsor-funded gifts |
| New Stacks wallets created via claims | 50 | Claim recipient addresses with no prior transaction history at claim time |
| Recipients still holding sBTC 30 days after claiming | 30% | Balance snapshot at claim + 30 days |
| Gift volume (organic) | $1,000 equivalent | Sum of organic gift amounts |

These replace an earlier, inconsistent pair of target sets (one claiming 500 gifts and 300 new wallets, another claiming 300 gifts and 50 new wallets). 500 gifts producing 300 new wallets implies a 60% new-wallet rate, which we have no evidence for. The numbers above are the single committed set.

**Organic means user-funded.** Two categories of gift are excluded from every headline figure and reported separately: the pre-funded demo gift (R-6.4), and any sponsor-funded campaign. Every gift records its funding source at creation. No grant funds are used to create gifts.

### 10.3 Product health metrics (tracked from Milestone 1)

| Metric | Why it matters |
|---|---|
| Claim rate (claimed ÷ created, matured gifts only) | The single best signal that the link actually works for normal people |
| Link-open → claimed conversion, by funnel step | Tells us *where* it breaks: opened, address supplied, submitted, confirmed |
| Median time from unlock to claim | Measures whether the countdown creates anticipation or just gets forgotten |
| Reclaim rate | High means gifts are dying unclaimed; treat as a product failure, not a feature |
| Median wall-clock time of the claim flow | Directly tests the W3 bar |
| Relayer STX spend per claim | Determines whether free claims stay sustainable |

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| RK-1 | **Contract bug drains or freezes escrowed funds.** | Critical | Small surface; no upgrades; full test matrix; caps on per-gift and total value; external review before mainnet; testnet-only until M2. |
| RK-2 | **Links are bearer instruments** — forwarded, screenshotted or intercepted links are claimable by anyone. | High | Stated plainly in the UI at creation and share time; optional passphrase in M2; fragment-only secrets; expiry limits exposure window. |
| RK-3 | **Relayer abuse drains the STX fee budget.** | Medium | One relayed claim per gift; per-IP and global rate limits; a hard daily budget; a minimum gift size below which we do not relay. See [threat model T-7](06-threat-model.md). |
| RK-4 | **Nobody has testnet sBTC**, so reviewers cannot try the product. | High (grant-specific) | The pre-funded demo gift (R-6.4) plus in-app faucet guidance (R-6.5). |
| RK-5 | **Wallet ecosystem gaps** — e.g. sponsored-transaction signing is currently broken in Leather mobile. | Medium | The default claim path requires no wallet transaction at all, which routes around this entire class of bug. |
| RK-6 | **sBTC itself carries bridge and signer-set risk** we do not control. | Medium | Disclosed in-product; we hold no position and take no fee on principal. |
| RK-7 | **Yield is negligible for short locks** (reward cycles run roughly two weeks), making M3's promise feel hollow. | Medium | Show projected yield honestly at creation, including "this lock is too short to earn meaningfully"; never show unearned numbers. |
| RK-8 | **Founder is new to Clarity and Stacks tooling.** | Medium | Deliberately small contract; spec-first; heavy Clarinet coverage; external review budgeted before mainnet. |
| RK-9 | **Gifting is seasonal and may not retain.** | Medium | Why savings locks and prize pools are on the same rails — the escrow does not care what the occasion is. |
| RK-10 | **Regulatory exposure of a relayer that touches user transactions.** | Low–Medium | The relayer only pays fees and cannot redirect funds; funds never enter a Ripen-controlled account; document this distinction clearly. |

## 12. Assumption register

Written down so they can be falsified rather than quietly assumed.

| # | Assumption | Status | Cheapest test |
|---|---|---|---|
| A-1 | People want to give Bitcoin as a gift often enough to build a product on | **Unvalidated** | 10 conversations with sBTC holders before Milestone 2 |
| A-2 | A time-lock increases the emotional value of a gift rather than annoying people | **Unvalidated** | A/B the default: pre-selected time-lock vs "opens now" |
| A-3 | Gas-free claiming is the binding constraint on recipient conversion | **Partly evidenced** (GoodDrops experience) | Funnel instrumentation from day one (§10.3) |
| A-4 | Recipients who claim will keep holding sBTC | **Unvalidated — and it is a grant target** | 30-day balance snapshots from the first mainnet claim onward |
| A-5 | An existing Stacks sBTC yield source will accept pooled deposits on terms that work for small balances | **Unverified** | Read the target protocol's contracts and talk to them before committing Milestone 3 scope |
| A-6 | 10% of yield is a viable business model at our expected scale | **Unvalidated** | Model it against real APY and realistic lock durations before building the fee logic |

## 13. Open questions

1. **Which yield source?** StackingDAO is the working assumption. The decision needs deposit/withdrawal mechanics, unlock latency and small-balance economics checked against a gift that may be claimed at any moment (see [ADR-011](08-decisions.md#adr-011-yield-venue-deferred)). **Blocking Milestone 3 design, not Milestone 1.**
2. **What happens to yield on a reclaimed gift?** Sender gets principal + yield is the stated intent; confirm it survives the fee model.
3. **Mainnet caps at launch:** proposed 0.005 sBTC per gift and a protocol-wide cap, both raised deliberately. Needs a number the founder is willing to defend.
4. **Does the demo gift belong on mainnet too**, with a tiny amount, or is testnet enough?
5. **Licence:** MIT or Apache-2.0, decided before the first code commit.
6. **Domain and brand:** `ripen.*` availability drives the link format, which appears in every share.

---

*Next: [Architecture](02-architecture.md) · [Contract specification](03-contract-spec.md) · [Claim protocol](04-claim-protocol.md)*
