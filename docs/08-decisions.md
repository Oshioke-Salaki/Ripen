# Decision log

**Status:** Draft v1.0 · **Last updated:** 2026-09-23

Each entry records a decision, what it rules out, and what would make us change our mind. Superseded entries are marked, never deleted.

---

### ADR-001: Signature-based claims, not hash preimages

**Status:** Accepted · **Date:** 2026-09-23

**Context.** A claimable link needs some secret that authorises release. The common pattern is a hash preimage: the link carries a secret, the contract stores its hash, claiming reveals the secret.

**Decision.** The link carries a one-time secp256k1 private key. The contract stores the public key. Claiming means signing a message that binds the gift id, the destination address, the contract and the chain.

**Why.** A revealed preimage enters the mempool as plaintext. Anyone watching can copy it and submit a competing claim with a higher fee, and this is trivially automatable. A signature binding the destination is useless to a thief: it only ever authorises payment to the address it was signed for.

**Consequences.** Claims cannot be front-run (T-1). Claim submission is decoupled from claim authorisation, which is what makes [ADR-004](#adr-004-relayed-claims-instead-of-sponsored-transactions) possible. The cost is a longer link and a client-side signing step that must match the contract byte for byte — pinned by test H-1.

**Revisit if.** Never, for this product. This is the foundation.

---

### ADR-002: Bitcoin block height as the clock

**Status:** Accepted · **Date:** 2026-09-23

**Context.** Clarity has no wall clock. Clarity 3 offers `stacks-block-height` (~5 s, variable), `tenure-height`, and `burn-block-height` (Bitcoin, ~10 min). `block-height` was removed in Clarity 3.

**Decision.** Store unlock and expiry as `burn-block-height`.

**Why.** Bitcoin's clock is the most stable of the three, independent of Stacks block production and future consensus changes, and independently verifiable by a recipient against Bitcoin itself. For a Bitcoin product, it is also the right metaphor.

**Consequences.** Time is approximate — Bitcoin block intervals vary, so a "30 day" lock lands *near* 30 days. We handle this in copy rather than code: the UI never promises a minute, says "on or about", and shows the target block height for anyone who wants precision.

**Revisit if.** A future Clarity version exposes a trustworthy timestamp. Even then, existing gifts stay on block heights.

---

### ADR-003: Hard-code the sBTC contract

**Status:** Accepted · **Date:** 2026-09-23

**Context.** A contract can accept a SIP-010 trait parameter to be token-agnostic, or reference one token by constant.

**Decision.** Reference the sBTC token as a hard-coded constant per network. No entry point accepts a token argument.

**Why.** A trait parameter lets an attacker pass a counterfeit token contract they control, creating gifts that look real in our UI and escrow nothing. Ripen is an sBTC product; genericity buys us nothing and costs us a whole attack class (T-6).

**Consequences.** Supporting another asset means a new contract deployment. Acceptable — that is a deliberate product decision, not a configuration change.

**Revisit if.** Multi-asset support becomes a real requirement. Even then: a separate deployment with an allowlist, never an arbitrary caller-supplied trait.

---

### ADR-004: Relayed claims instead of sponsored transactions

**Status:** Accepted · **Date:** 2026-09-23 · **Supersedes** the sponsored-transaction approach in the original technical notes

**Context.** The product promise is that a recipient with nothing can claim. Stacks supports sponsored transactions natively: the user signs with `sponsored: true` and a zero fee, a sponsor attaches the fee and broadcasts. That was the original plan.

**Decision.** The relayer submits the entire claim transaction itself. The recipient signs only the off-chain claim message, in the browser, with the link key. They never sign a Stacks transaction.

**Why.** Because [ADR-001](#adr-001-signature-based-claims-not-hash-preimages) puts authorisation in the signature rather than in the transaction sender, `claim-gift` is safe to expose to any caller — the funds can only reach the address bound inside the signature. So the recipient does not need to be the transaction's origin at all.

This is strictly simpler and strictly better:

| | Sponsored transactions | Relayed claims |
|---|---|---|
| Recipient needs a wallet that can sign | Yes | **No** |
| Wallet prompts during claim | One | **Zero** |
| Recipient needs a Stacks account nonce | Yes | **No** |
| Depends on wallet sponsored-tx support | Yes — [broken in Leather mobile today](https://github.com/leather-io/mono/issues/2788) | **No** |
| Relayer can redirect funds | No | **No** |

**Consequences.** The claim path touches the fewest wallet code paths of any available design, which matters for a mobile-first product aimed at first-time users. Sponsored transactions stay documented and available for later flows where the user genuinely must be the origin. The relayer's trust bound is unchanged: it holds STX, it cannot redirect a claim.

**Revisit if.** A flow appears where the user must be the transaction origin. Then sponsorship is the right tool, for that flow.

---

### ADR-005: Permissionless reclaim

**Status:** Accepted · **Date:** 2026-09-23 · **Supersedes** "sender only" in the original technical notes

**Context.** After expiry, an unclaimed gift must go home. The obvious rule is that only the sender may trigger it.

**Decision.** Anyone may call `reclaim-gift`. The destination is always the sender stored at creation.

**Why.** There is no destination to get wrong, so opening the function adds no attack surface. It lets Ripen run a sweeper that returns expired gifts automatically, so a sender who forgot about a gift gets it back without doing anything. A "griefer" who calls it pays a fee to do the sender a favour.

**Consequences.** A sender cannot control *when* the return lands, which has tax-lot implications in some jurisdictions. Recorded and disclosed rather than designed around; the alternative is gifts that sit expired and forgotten indefinitely, which is worse for more people.

**Revisit if.** A user-visible problem emerges from uncontrolled timing. A future version could add an opt-in "only I can return this" flag, chosen at creation.

---

### ADR-006: No early cancellation

**Status:** Accepted · **Date:** 2026-09-23

**Context.** Should a sender be able to pull a gift back before it is claimed?

**Decision.** No. A sender's only route to their sBTC is expiry.

**Why.** The countdown page is the product. If a sender can cancel at will, the recipient's gift is revocable and the countdown means nothing — a gift you can take back is not a gift. Removing the option also removes an entire category of "my gift disappeared" dispute.

**Consequences.** A sender who makes a mistake — wrong amount, wrong date — waits until expiry. Mitigated by making expiry visible and adjustable at creation, and by the review step showing exactly what is being committed to.

**Revisit if.** Usage data shows senders routinely need it. The right shape would be a `revocable` flag set at creation and displayed prominently on the claim page, so the recipient always knows which kind of gift they hold — never a silent capability.

---

### ADR-007: Messages encrypted off-chain with an on-chain commitment

**Status:** Accepted · **Date:** 2026-09-23

**Context.** Gift messages are personal. Three options: plaintext on-chain, plaintext in our database, or encrypted.

**Decision.** Encrypt client-side under a key derived from the link secret. Store the ciphertext in our database, and a 32-byte `SHA256(ciphertext ‖ iv)` commitment on-chain.

**Why.** On-chain plaintext publishes "Happy 18th, love Dad" forever to everyone. Plaintext in our database makes us a reader of private messages and a target. Encryption gives privacy from both, and the on-chain commitment makes substitution detectable, so our database being compromised cannot change what a message says.

**Consequences.** If the metadata service is lost, messages are lost. Funds are not, and the UI says so plainly. Storing ciphertext on-chain instead would fix durability at meaningful cost per gift — reconsider if messages turn out to matter more than expected.

---

### ADR-008: Secret in the URL fragment

**Status:** Accepted · **Date:** 2026-09-23

**Context.** The link must carry the claim key to the recipient's browser without handing it to us.

**Decision.** `ripen.app/g/<public-id>#k=<secret>`. Public id in the path, secret in the fragment. The client cross-checks that the key's public key maps on-chain to the id in the path.

**Why.** Browsers never transmit a fragment to a server. The secret therefore misses our logs, CDN caches, referrer headers, and the link-preview crawlers that chat apps run on pasted URLs. The public id in the path is what lets us server-render a rich social card — the privacy property and the marketing surface stop competing.

**Consequences.** Analytics must never receive a full URL (N-10). Anything that reflects the fragment to a server is a security bug, and there is a test asserting nothing does. The cross-check defeats doctored links that pair a convincing preview with a different gift.

---

### ADR-009: Link recovery via deterministic re-derivation

**Status:** Proposed — not for Milestone 1 · **Date:** 2026-09-23

**Context.** If a sender loses the link, the gift is unclaimable until expiry. Milestone 1 mitigates with a forced save step and local caching, which does not survive a cleared browser.

**Decision (proposed).** Derive the claim key deterministically from a signature the sender's wallet makes over a domain-separated, gift-specific message: `claimKey = HKDF(walletSignature("ripen/link/v1" ‖ salt))`. secp256k1 signing is deterministic (RFC 6979), so the sender can regenerate any link from their wallet at any time.

**Why not yet.** It concentrates risk: a phishing site that persuades a user to sign that exact message derives every one of their gift links. Domain separation helps; it does not eliminate the exposure. This needs careful design and probably a wallet-level warning, so it is Milestone 2 work with its own ADR — not a Milestone 1 convenience.

**Alternative considered and rejected.** Encrypting the claim key to the sender's own public key and storing the ciphertext on-chain. Clean in principle, but wallets do not expose the decryption primitive needed to recover it.

---

### ADR-010: One shared implementation of the claim message

**Status:** Accepted · **Date:** 2026-09-23

**Context.** The claim message is constructed in the recipient's browser, re-validated by the relayer, and recomputed by the contract.

**Decision.** One TypeScript module, in `app/lib/ripen/`, used by the app, the relayer and the tests. The contract also exposes `claim-message-hash` as a public read-only function, and a test asserts the two agree over random inputs.

**Why.** A divergence between client and contract makes every gift silently unclaimable, and the failure is invisible until a real user tries to open one. Exposing the hash from the contract also means no one ever has to trust our documentation to construct a claim — the contract is the authority.

---

### ADR-011: Yield venue deferred

**Status:** Open — blocking Milestone 3 design · **Date:** 2026-09-23

**Context.** Milestone 3 routes idle principal into an existing Stacks sBTC yield source. StackingDAO is the working assumption.

**Decision.** Not made. Deliberately.

**What has to be true.** Deposits and withdrawals must work for a pool whose liabilities can be claimed at any moment; small balances must not be eaten by fees; withdrawal latency must be compatible with instant claims, which almost certainly means a liquidity buffer.

**Why deferred.** Designing the vault before the venue is known would bake in assumptions we have not checked. The venue decision is research, not construction, and it does not block Milestone 1 in any way.

**Next step.** Read the candidate protocols' contracts and talk to their teams before committing Milestone 3 scope. Assumption A-5.

---

### ADR-012: Gifts are addressed by (contract, gift-id) from day one

**Status:** Accepted · **Date:** 2026-09-23

**Context.** Clarity contracts are immutable. Any change means a new deployment, and gifts in old versions must stay claimable indefinitely.

**Decision.** Every gift reference — in the app, the database, and every URL — is a `(contractId, giftId)` pair. A registry of every deployed version ships with the app, and the relayer relays for all of them.

**Why.** Retrofitting multi-version addressing after v2 exists means migrating live links that people are holding in chat histories. Doing it from the first line of code costs almost nothing.

**Consequences.** Deprecating a version means blocking *creation* in the UI. It never means dropping claim support. This is a permanent operational commitment, and it should be stated publicly so users can rely on it.

---

## Rejected outright

| Idea | Why not |
|---|---|
| Custodial "we hold it for you" escrow | Destroys the only trust property that matters, and makes us a money transmitter |
| Gifts as NFTs | Adds a standard, a marketplace surface and gas cost; solves nothing the escrow does not |
| A Ripen token | No mechanism needs one |
| Sending directly to an address instead of a link | The recipient must already have a wallet — the exact problem we exist to solve. Worth adding *alongside* links later, never instead |
| Email or phone-number custody of claim keys | Makes us the custodian in all but name |
| Our own yield strategy | We are not a yield protocol. 10% of someone else's yield, or nothing |
| Recipient-pays-fee as the default | Breaks the core promise. It remains the documented fallback |
