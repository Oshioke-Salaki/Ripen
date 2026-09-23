# Ripen — project context

## What Ripen is
Ripen makes sBTC grow until it's needed: lock sBTC, earn yield while it waits (via existing Stacks sBTC yield sources, e.g. StackingDAO), release it to yourself or someone else on a date or a claim.

**First product: gifting.** A user sends sBTC as a shareable link, optionally time-locked ("opens in 10 days", "opens on your birthday"). The gift earns yield until claimed. Recipients claim with no existing wallet or balance (fees sponsored). Unclaimed gifts return to the sender (with yield) after expiry.

**Later, on the same rails:** savings locks, trust funds, business payouts/vesting, prize pools for hackathons/bounties/events, sponsored campaigns, event and GPS drops, AI chat-to-gift (Telegram/WhatsApp; AI drafts, user always approves, AI never holds keys).

Audience: everyone who holds sBTC (or wants to) and wants a simple way to earn yield, save, or gift, especially people new to DeFi who don't want to deal with protocols and staking cycles. Global.

Always say "sBTC", not "sats" or "BTC", in product copy about on-chain amounts.

## Context
- Applying to Stacks Endowment Q3 2026 grants, Getting Started track, category Payments.
- Founder/lead dev: Oshioke (previously built GoodDrops, a GPS money-drop dApp on Celo; Solidity, Next.js, Wagmi/Viem/Privy background). New to Clarity/Stacks tooling, so explain Stacks-specific concepts briefly when first used.

## Milestones (grant)
1. **Testnet prototype (current focus):** Clarity gift escrow contract on Stacks testnet; public repo with Clarinet tests and docs; public web app where reviewers can send and claim a test gift; demo video (create → time-lock → share link → claim → reclaim).
2. **Mainnet gifts:** mainnet deploy (peer-reviewed, per-gift deposit caps), sponsored-fee claims, gift themes/messages, public on-chain dashboard (gifts, claims, volume).
3. **Yield + chat (final):** pooled yield vault connected to an existing sBTC yield source; principal + yield paid on claim; live "your gift has grown" counter; chat-to-gift beta; ≥1 sponsored campaign. Final metric: 500+ gifts, 300+ new Stacks wallets via claims, 30%+ of recipients holding sBTC 30 days after claiming.

## Technical design (Milestone 1)
### Escrow contract (Clarity)
- Holds sBTC (SIP-010 token) per gift: sender, amount, unlock-height (or time), expiry, claim-pubkey, status.
- **Claim by signature, not a revealed secret.** The link carries a one-time private key; the contract stores the matching public key. To claim, the recipient signs a message binding the gift-id + recipient address; the contract verifies with `secp256k1-verify`. This prevents mempool front-running (a plain hash-preimage secret would be visible and stealable when submitted).
- Functions (draft): `create-gift`, `claim-gift` (after unlock, before expiry, valid signature), `reclaim-gift` (sender only, after expiry, unclaimed), read-only getters.
- Use post-conditions in all frontend calls so users see exactly what leaves their wallet.
- Non-custodial: funds only ever in the contract, never in a Ripen-controlled wallet.
- Clarity contracts are not upgradeable → versioned deployments; existing gifts must always remain claimable/reclaimable on their original version.

### Yield (Milestone 3, not now)
- Single pooled vault with share accounting (like fund units). Each gift gets shares at deposit; claim redeems shares → principal + yield. Pooling amortizes fees; per-gift yield positions would cost more than they earn on small gifts.
- Staking reward cycles (~2 weeks) mean short locks may earn ~nothing; display honestly.
- Business model: 10% of yield earned, never principal.

### Claims UX
- Recipient needs zero balance: use Stacks sponsored transactions (a Ripen relayer pays fees).
- Wallets: Leather and Xverse via Stacks Connect; later an embedded/new-user wallet option.

## Stack (proposed)
- Contracts: Clarity + Clarinet (tests, devnet).
- Frontend: Next.js + TypeScript, @stacks/connect, @stacks/transactions, mobile-first PWA.
- Testnet sBTC: use the testnet sBTC token (or a mock SIP-010 in devnet/tests).

## Principles
- Honesty in copy and grant materials: never claim users, partners, audits, or interviews that don't exist.
- Small, shippable steps. Milestone 1 first; don't build yield or AI yet.
- Security first: deposit caps early, tests for every contract path (happy path, early claim, expired claim, bad signature, double claim, reclaim by non-sender, reclaim before expiry).
