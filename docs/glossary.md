# Glossary

Stacks, Clarity and sBTC terms as Ripen uses them. Written for someone arriving from an EVM background.

---

**sBTC** — A 1:1 Bitcoin-backed token on Stacks, implemented as a SIP-010 fungible token. Ripen escrows sBTC and nothing else. Eight decimals, so one sBTC is 100,000,000 base units. Always written "sBTC" in product copy, never "sats" or "BTC".

| Network | Contract |
|---|---|
| Mainnet | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| Testnet | `SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token` |

**SIP-010** — The Stacks fungible-token standard. Roughly ERC-20's role, with `transfer`, `get-balance`, `get-decimals` and friends. The key difference: `transfer` takes an explicit `sender` argument, so there is no approve/allowance dance.

**SIP-018** — The standard for signing structured data on Stacks, analogous to EIP-712. A signed payload is `sha256(0x534950303138 ‖ domainHash ‖ messageHash)`, where the domain binds an app name, version and chain id. The `"SIP018"` prefix guarantees the signed bytes can never also be a valid transaction. Ripen's claim signature follows it exactly.

**Clarity** — Stacks' smart contract language. Interpreted (not compiled), decidable, with no reentrancy and no dynamic dispatch by default. You can tell what a Clarity contract does by reading it, which is the point.

**Clarinet** — The Clarity development toolchain: local devnet, a simnet for fast unit tests, deployment plans. Tests are written in TypeScript against the Clarinet SDK with Vitest.

**`tx-sender` vs `contract-caller`** — Not `msg.sender`. `tx-sender` is the principal that signed the transaction and does **not** change as calls nest between contracts. `contract-caller` is the immediate caller. `(as-contract tx-sender)` temporarily switches the sender context to the contract's own principal, which is how a contract holds and moves tokens.

**Principal** — A Stacks address. Either *standard* (a user account, `SP…` on mainnet, `ST…` on testnet) or *contract* (`SP….contract-name`). Ripen pays claims only to standard principals.

**Post-condition** — A wallet-enforced assertion about what a transaction may move, checked by the node independently of the contract. With `postConditionMode: 'deny'`, any asset movement not explicitly permitted aborts the transaction. This is Stacks' best safety feature and has no EVM equivalent: the user's *wallet* guarantees what leaves their account, so they are not relying on the contract being honest. Ripen uses one on every create call.

**`burn-block-height`** — The current Bitcoin block height, readable from Clarity. Ripen's clock. Roughly 144 blocks a day.

**`stacks-block-height`** — The current Stacks block height. Post-Nakamoto these arrive every few seconds and at a variable rate, which is why Ripen does not use it for time-locks.

**`tenure-height`** — The number of Stacks tenures elapsed; one tenure per Bitcoin block.

**`block-height`** — Removed in Clarity 3, replaced by `stacks-block-height`. Mentioned only because older tutorials still use it.

**Nakamoto** — The Stacks upgrade that brought fast blocks and Bitcoin finality. The reason `block-height` split into three separate keywords.

**`secp256k1-verify`** — Clarity's signature check: `(secp256k1-verify message-hash signature public-key)`, taking a 32-byte hash, a 64- or 65-byte signature, and a 33-byte compressed public key. **It does not enforce canonical low-S form**, despite documentation to the contrary: we tested it, and `(r, n-s)` verifies exactly as `(r, s)` does, in both 64- and 65-byte form, with the recovery byte ignored. Claim signatures are therefore malleable. This is harmless for Ripen because the recipient is bound inside the signed message, so a malleated signature still only pays the address it was signed for — but any idempotency must be keyed on gift id, never on signature bytes. Verified by test L-11.

**`principal-of?`** — Derives the Stacks principal from a 33-byte public key, returning `(err u1)` for a malformed key. Ripen uses it as a validity guard when a gift's claim key is registered.

**`to-consensus-buff?`** — Serialises a Clarity value into its canonical byte representation, so a contract can hash exactly the same bytes a client hashed. The contract-side counterpart to Stacks.js's `serializeCV`. They must agree byte for byte.

**Sponsored transaction** — A native Stacks feature where the user signs a transaction and a *sponsor* attaches the fee and broadcasts it. Ripen documents it but does not need it for claims: because authorisation lives in a signature rather than in the transaction sender, the relayer can simply submit the claim itself. See [ADR-004](08-decisions.md#adr-004-relayed-claims-instead-of-sponsored-transactions).

**Relayer** — Ripen's service that submits claim transactions and pays their fees. Holds STX only. Cannot redirect a claim, because the destination address is bound inside the claimant's signature.

**Stacks Connect** — The browser library for talking to Leather and Xverse. Version 8 uses `connect()` and `request(method, params)` — for example `request('stx_callContract', …)` — replacing the older callback-based API.

**Chainhook** — Stacks' event-streaming tool: define predicates over chain events and receive matching ones by webhook. Ripen's Milestone 2 indexing path; Milestone 1 polls the Hiro API instead.

**Hiro API** — The public Stacks API used for reads, balances and transaction history. Ripen treats it as replaceable and never as a dependency for anything financial.

**Stacking cycle** — The roughly two-week reward period underlying most Stacks yield. It is why a short lock may earn approximately nothing, and why Ripen commits to saying that out loud before a sender commits.
