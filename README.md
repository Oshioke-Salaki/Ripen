# Ripen

[![tests](https://github.com/Oshioke-Salaki/Ripen/actions/workflows/ci.yml/badge.svg)](https://github.com/Oshioke-Salaki/Ripen/actions/workflows/ci.yml)

**Lock sBTC. Let it grow while it waits. Release it on a date, or to a link.**

Ripen is a non-custodial escrow on [Stacks](https://stacks.co) for sBTC that treats *time* as a feature instead of friction. The first product is gifting: you send sBTC as a shareable link that can be time-locked — "opens in 10 days", "opens on your birthday" — and the recipient opens it with nothing but a Stacks address. No wallet balance, no gas, no seed phrase to claim.

Later, the same escrow rails carry savings locks, trust funds, vesting and payouts, prize pools, and sponsored campaigns.

---

## Status

**Milestone 1 — testnet prototype — in progress.**

| | |
|---|---|
| Escrow contract | ✅ **Deployed to Stacks testnet** |
| Test suite | ✅ 52 tests, all passing |
| Documentation | ✅ This repo |
| Web app | Not yet |
| Relayer | Not yet |
| Demo video | Not yet |

**Testnet deployment**

| | |
|---|---|
| Contract | [`STXWNPMB6D6Y8F4GMSR66RVP4WTWN03B94XRMA31.ripen-gift-v1`](https://explorer.hiro.so/txid/STXWNPMB6D6Y8F4GMSR66RVP4WTWN03B94XRMA31.ripen-gift-v1?chain=testnet) |
| Deploy transaction | [`e0ed8fcf…ce370e`](https://explorer.hiro.so/txid/e0ed8fcff1e322e34efa289b0056ff6c468c5465cc3f93fbcd0eb73337ce370e?chain=testnet) |
| sBTC token | `SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token` |
| Exact deployed source | [`deployments/ripen-gift-v1.testnet.clar`](deployments/ripen-gift-v1.testnet.clar) |

Nothing is on mainnet. Nothing has been audited. There are no users, partners, or
integrations yet. This section is kept honest and updated as things actually ship.

## Running it

```bash
npm install
npm test                  # 52 tests against a simnet devnet
npm run check:contracts   # compile and analyse every contract
npm run check:network     # confirm which sBTC token the contract points at
npm run verify:testnet    # verify the LIVE testnet deployment — no wallet, no funds
```

`verify:testnet` needs nothing but network access. It confirms the contract is
deployed, that it is bound to the real testnet sBTC token and not a mock, that
claiming cannot be paused, and — the check that matters most — that
`lib/claim-message.ts` and the deployed contract produce identical SIP-018 claim
hashes. If those ever disagreed, every gift would become unclaimable.

The canonical contract source points at a devnet mock so the tests always run.
The deploy script substitutes the real sBTC token for the target network in
memory and writes the exact deployed bytes to `deployments/`, so what is on
chain can always be diffed against what is in the repo.

## Why it's interesting

- **Claim with just an address.** The escrow verifies a signature that binds *gift id + recipient address*, so anybody can submit the claim transaction on the recipient's behalf and the funds can still only reach the bound recipient. A first-time user needs no STX, no signing, and no wallet transaction — only somewhere to receive. See [Claim protocol](docs/04-claim-protocol.md).
- **The secret never touches a server.** The claim key lives in the URL fragment (`#...`), which browsers never send to the server — not to Ripen's, not to the link-preview crawler of whatever chat app forwarded it.
- **No front-running.** A claim is a signature, not a revealed secret, so watching the mempool buys an attacker nothing. See [Threat model](docs/06-threat-model.md).
- **Nothing gets stranded.** Unclaimed gifts return to the sender after expiry, and *anyone* can trigger that return because the funds are hard-wired to the original sender.
- **The wait pays for itself.** Milestone 3 routes idle principal into an existing Stacks sBTC yield source; the gift arrives worth more than it was sent.

## Documentation

Start at **[docs/README.md](docs/README.md)**, or jump to:

| Doc | What it answers |
|---|---|
| [01 — Product requirements](docs/01-prd.md) | What we are building, for whom, and what "done" means |
| [02 — Architecture](docs/02-architecture.md) | How the pieces fit: chain, app, relayer, indexer |
| [03 — Contract specification](docs/03-contract-spec.md) | The Clarity escrow: data, functions, errors, invariants, test matrix |
| [04 — Claim protocol](docs/04-claim-protocol.md) | The signature scheme and the relayed claim, end to end |
| [05 — UX flows and copy](docs/05-ux-flows.md) | Every screen and state, with the words on it |
| [06 — Threat model](docs/06-threat-model.md) | What can go wrong and what stops it |
| [07 — Roadmap and metrics](docs/07-roadmap-and-metrics.md) | Milestones, acceptance criteria, instrumentation |
| [08 — Decision log](docs/08-decisions.md) | Choices made, alternatives rejected, and why |
| [Glossary](docs/glossary.md) | Stacks, sBTC and Clarity terms used throughout |

## Stack

Clarity + Clarinet for the escrow. Next.js + TypeScript + Stacks.js for the app. Postgres for off-chain gift presentation and analytics. See [Architecture](docs/02-architecture.md).

## Context

Built for the Stacks Endowment Q3 2026 grant programme, Getting Started track, category Payments.

## Licence

[MIT](LICENSE).
