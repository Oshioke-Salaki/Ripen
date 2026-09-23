# Ripen documentation

**Status:** Draft v1.0 · **Last updated:** 2026-09-23

Everything here is a plan, not a description of shipped software. Milestone 1 is in progress; nothing is deployed.

## Read in this order

| # | Document | Read it for |
|---|---|---|
| 01 | **[Product requirements](01-prd.md)** | What Ripen is, who it is for, what it must do, how we will know it worked. Requirement IDs (`R-x.y`) are referenced by everything else. |
| 02 | **[Architecture](02-architecture.md)** | The components, why time is measured in Bitcoin blocks, and how the system degrades when each piece fails. |
| 03 | **[Contract specification](03-contract-spec.md)** | `ripen-gift-v1.clar` in full: data model, functions, errors, invariants, and the test matrix that gates Milestone 1. |
| 04 | **[Claim protocol](04-claim-protocol.md)** | The heart of the product — how a stranger with nothing claims a gift, and why it cannot be front-run or redirected. |
| 05 | **[UX flows and copy](05-ux-flows.md)** | Every screen and state, with shipping copy. |
| 06 | **[Threat model](06-threat-model.md)** | What can go wrong, what stops it, and what residual risk we accept on purpose. |
| 07 | **[Roadmap and metrics](07-roadmap-and-metrics.md)** | Milestones, acceptance criteria, build order, and how every number is measured. |
| 08 | **[Decision log](08-decisions.md)** | Decisions with their rationale, their rejected alternatives, and what would change our minds. |
| — | **[Glossary](glossary.md)** | Stacks, Clarity and sBTC terms, for an EVM-shaped brain. |

## If you have five minutes

Read [claim protocol §1](04-claim-protocol.md#1-the-core-idea) and [ADR-004](08-decisions.md#adr-004-relayed-claims-instead-of-sponsored-transactions). Between them they explain the one idea the product is built on: because a claim is authorised by a signature that names the destination, anyone can submit the transaction, and so a recipient needs no wallet balance, no gas and no signature to receive Bitcoin.

## Conventions

- **Requirement IDs** — `R-3.4` is [PRD §8](01-prd.md#8-functional-requirements), requirement group 3, item 4. Test IDs (`L-8`, `C-12`) are rows of the [test matrix](03-contract-spec.md#9-test-matrix).
- **Open decisions** are marked `[OPEN]` or carry an ADR with status *Proposed* or *Open*. Nothing is quietly undecided.
- **Honesty** — no claimed user, partner, audit, integration or interview appears anywhere in this repository unless it exists. Assumptions are listed as assumptions, in [PRD §12](01-prd.md#12-assumption-register).

## Verified facts

Checked against live sources on 2026-09-23, since a specification built on half-remembered APIs is worse than none:

- sBTC token contract identifiers, mainnet and testnet — queried directly from the Hiro node APIs.
- Clarity 3 block-height keywords, and the removal of `block-height`.
- `secp256k1-verify` argument sizes and its rejection of high-S signatures.
- SIP-018 structured-data hashing and its `0x534950303138` prefix.
- The Stacks sponsored-transaction flow, and the current state of wallet support for it.
