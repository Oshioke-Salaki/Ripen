# Threat model

**Status:** Draft v1.0 · **Last updated:** 2026-09-23 · **Scope:** Milestone 1

---

## 1. What we are protecting

| Asset | Why it matters |
|---|---|
| **Escrowed sBTC** | Real value. The only thing whose loss is unrecoverable. |
| **Claim keys** | Whoever holds one can take the gift it opens. |
| **Gift messages** | Personal content. Private by design, and we promise as much in the UI. |
| **Relayer STX** | Operational. Losing it stops free claims; it can never cause loss of user funds. |
| **Contract ownership key** | Governs creation limits only. Cannot move funds. |

## 2. Who we are defending against

| Actor | Capability | Motive |
|---|---|---|
| **Mempool observer** | Sees every pending transaction before confirmation | Steal a gift mid-claim |
| **Link interceptor** | Reads a chat, a shared screen, a forwarded message, a backup | Claim a gift they were not given |
| **Malicious claimant** | Holds a legitimate link | Extract more than the gift |
| **Hostile sender** | Creates arbitrary gifts | Grief the protocol or drain the relayer |
| **Compromised Ripen** | Full control of our servers, frontend and relayer key | Steal escrowed funds |
| **Compromised owner key** | Can call every admin function | Steal escrowed funds |
| **Network-level attacker** | Sees traffic, runs a malicious CDN or a poisoned DNS answer | Harvest secrets in transit |

The last two rows are the ones that decide the architecture. A design that is safe only while Ripen is honest and uncompromised is not a design worth shipping.

## 3. Threats

### T-1 · Front-running a claim in the mempool
**Attack.** An observer sees a pending claim, extracts whatever authorises it, and submits their own with a higher fee.
**Why it fails.** The claim is a signature over a message that binds the destination address ([claim protocol §1](04-claim-protocol.md#1-the-core-idea)). A copied signature only ever authorises payment to the address it was signed for. The attacker can rebroadcast a claim that pays the rightful recipient — which is not an attack.
**Had we chosen otherwise.** A hash-preimage secret would be published to the world the instant a claim entered the mempool, and stealing it would be trivial and automatable. This is the single most important design decision in the product.
**Test.** L-8.
**Residual.** An attacker can attempt censorship by fee competition. They cannot profit, and the claim simply confirms later.

### T-2 · Link interception
**Attack.** The link leaks — a forwarded chat, a screenshot in a group, a shared device, a cloud backup — and someone else claims the gift.
**Why it partly succeeds.** It does. A link is a bearer instrument. This is inherent to "claimable by someone with no account", which is the product.
**Controls.** The secret is in the URL fragment, so it is never in a server log, a CDN cache, a referrer header or a chat app's preview crawl ([claim protocol §2](04-claim-protocol.md#2-the-link)). We state the bearer property plainly at creation *and* at share time (R-6.1). Expiry bounds the exposure window. Milestone 2 adds an optional passphrase, mixed into the claim key, so the link alone is insufficient.
**Residual.** Accepted and disclosed. Mitigated further in M2, never eliminated.

### T-3 · Ripen's servers steal the funds
**Attack.** We are compromised, or we turn hostile. The relayer receives every claim request before broadcasting it.
**Why it fails.** The relayer holds STX and nothing else. It cannot construct a claim to an address the claimant did not sign for, because the address is inside the signature. It cannot create, modify or reclaim a gift. sBTC never enters a Ripen-controlled account at any point in any flow.
**Worst case.** Claims stop; users fall back to self-submitted claims (R-3.5) or to the contract directly ([claim protocol §7](04-claim-protocol.md#7-claiming-without-ripen)). No funds move.
**Test.** L-12 proves a third-party submitter cannot redirect.

### T-4 · A malicious frontend harvests claim keys
**Attack.** Our build pipeline or CDN is compromised and the claim page exfiltrates the fragment. This is the strongest realistic attack on the whole system, because the fragment is handled by code we ship.
**Controls.** A strict CSP with no inline script and a tight `connect-src` allowlist; Subresource Integrity on anything external; no third-party analytics on `/create` or `/g/*` (N-10); dependency pinning with lockfile review; reproducible builds; a test asserting no code path sends fragment-derived material to any origin.
**Residual.** **This is our highest residual risk and it should be treated as such.** The honest mitigation is that the on-chain protocol does not depend on our frontend: [claim protocol §7](04-claim-protocol.md#7-claiming-without-ripen) exists so a user can bypass us entirely. Milestone 2 should add a published build hash and, if practical, an IPFS mirror of the claim page.

### T-5 · Compromised contract-owner key
**Attack.** An attacker takes the deployer key.
**Why it fails.** The administrative surface is: pause creation, change creation limits, transfer ownership. Nothing else. No owner call can move escrowed sBTC, alter a gift, change a schedule, or interfere with `claim-gift` or `reclaim-gift` ([invariants I-5, I-6](03-contract-spec.md#6-invariants)).
**Worst case.** Denial of *new* gifts. Every existing gift remains fully claimable and reclaimable.
**Test.** A-7 explicitly searches for an owner-call sequence that moves funds to a third address.
**Control.** Owner key on hardware from mainnet onward; multisig once it is worth the operational cost.

### T-6 · Counterfeit token
**Attack.** A caller passes a fake SIP-010 contract that mints freely, creating a gift that looks real in our UI but escrows nothing.
**Why it fails.** The sBTC contract is a hard-coded constant, not a trait parameter ([ADR-003](08-decisions.md#adr-003-hard-code-the-sbtc-contract)). There is no entry point that accepts a token argument.
**Test.** A-9.

### T-7 · Relayer fee drain
**Attack.** Someone creates thousands of minimum-size gifts to themselves and claims each one, making Ripen pay every fee, until the budget is gone and real claims stop.
**Controls.** One relayed claim per gift id, ever, recorded durably and checked atomically. A minimum gift size below which we do not relay, set so the fee is a small fraction of the gift. Per-IP and global rate limits. A hard daily STX budget with alerting. Graceful degradation to self-submitted claims when the budget is exhausted — the product gets worse, it does not break.
**Economics.** The attacker pays a `create-gift` fee for every claim fee they extract, so the attack costs them roughly what it costs us and yields them nothing. That asymmetry is the real defence; the rate limits are for accidents and bugs.
**Residual.** Accepted. Monitored via relayer spend per claim (PRD §10.3).

### T-8 · Time-lock manipulation
**Attack.** Influence `burn-block-height` to unlock a gift early or expire one late.
**Why it fails.** It is Bitcoin's block height. Manipulating it means attacking Bitcoin.
**Residual.** Genuine imprecision, not manipulation: block intervals vary, so a "30 day" lock may land days off. Handled in copy, everywhere, by never promising an exact time ([UX §1](05-ux-flows.md#1-voice)).

### T-9 · Message tampering or snooping
**Attack.** Our metadata service is compromised and substitutes or reads gift messages.
**Why it fails.** Messages are encrypted client-side under a key derived from the claim secret, which the service never sees. The recipient's browser verifies the ciphertext against an on-chain commitment before decrypting, so substitution is detected ([architecture §4](02-architecture.md#4-the-message-encrypted-off-chain-committed-on-chain)).
**Residual.** Availability. Losing the service loses messages. Funds are unaffected, and the UI says so rather than pretending the message was never there.

### T-10 · Claim race between honest parties
**Attack.** Not an attack — two devices with the same link claim to different addresses simultaneously.
**Behaviour.** First confirmation wins; the second aborts with `ERR-NOT-PENDING` and no funds move twice. The UI renders this as "already opened, here's where it went" rather than as a failure ([UX state D](05-ux-flows.md#state-d--already-opened)).
**Test.** L-6.

### T-11 · Dust and griefing gifts
**Attack.** Flood the contract with minimum-size gifts to bloat state or make our dashboards useless.
**Controls.** `min-amount` makes each one cost real sBTC plus a fee. `max-total-locked` bounds aggregate exposure. Gifts are link-delivered, so nobody can be spammed with unwanted gifts they did not ask for — there is no "send to any address" surface to abuse.

### T-12 · Recipient sends to an unusable destination
**Attack.** Not an attack — the most likely way a real user loses money. They claim to an exchange deposit address that does not support sBTC, or to a contract.
**Controls.** Address validation with network checking; an explicit, prominent warning against exchange deposit addresses (R-3.7); rejecting contract principals as claim destinations; favouring wallet connection over pasting.
**Residual.** Real, and irreversible when it happens. Worth more design attention than most of the cryptographic threats on this page, because it is the one that will actually occur.

### T-13 · sBTC protocol risk
**Attack.** Outside our control: the sBTC peg, bridge or signer set fails.
**Position.** We hold no position and take no fee on principal. Disclosed in-product. If sBTC breaks, gifts denominated in it break, and no design of ours prevents that.

### T-14 · Phishing with a fake Ripen
**Attack.** A lookalike domain collects claim links, or a fake "claim" page asks a sender to sign something harmful.
**Controls.** One canonical domain, used consistently in every share; the social card reinforces it; documentation of what Ripen will never ask for (we never ask for a seed phrase, and a claim never requires a wallet signature — so any "Ripen" page asking for either is fake). SIP-018 domain separation means a Ripen claim signature is useless to any other contract.
**Residual.** Ecosystem-wide. Mitigated by consistency and by the fact that our real flow asks for remarkably little.

## 4. Security practices

**Contract.** Spec-first; the [test matrix](03-contract-spec.md#9-test-matrix) is a completion gate, not a nice-to-have. Adversarial tests for every invariant. External review before mainnet, findings published. No mainnet deployment carrying a known unresolved finding.

**Frontend.** Strict CSP; no third-party scripts on secret-handling routes; SRI on external assets; lockfile-pinned dependencies with review on change; an automated test that the fragment never leaves the device.

**Relayer.** Key in a managed secret store, never in the repository or an environment file in an image. Least privilege — it can sign transactions and nothing else. Full request logging *excluding* signatures. Budget alerting.

**Operations.** Monitoring on `total-locked`, claim failure rate and relayer balance. An incident runbook whose first step is **pause creation**, because claims and reclaims can never be paused and therefore never need to be part of an incident response.

**Disclosure.** A `SECURITY.md` with a contact address and a commitment to respond, published before the testnet app goes live.

## 5. Open security questions

1. Should a contract principal be rejected as a claim destination at the contract level, or only in the UI? Contract-level is safer and cheap; it forecloses future contract-to-contract integrations. **Decide before mainnet** (test L-16).
2. Passphrase design for M2: mixing the passphrase into the claim key derivation is stronger than checking it client-side, but makes a forgotten passphrase unrecoverable until expiry. Needs a decision recorded as an ADR.
3. Is a published build hash plus an IPFS mirror of the claim page worth the operational cost in M2? It is the only real mitigation for T-4.
4. What is the minimum gift size below which relaying is uneconomic? Needs measurement against real fees, not a guess.

---

*Next: [Roadmap and metrics](07-roadmap-and-metrics.md) · [Decision log](08-decisions.md)*
