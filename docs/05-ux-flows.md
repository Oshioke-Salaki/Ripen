# UX flows and copy

**Status:** Draft v1.0 · **Last updated:** 2026-09-23 · **Scope:** Milestone 1 screens

Copy in this document is the shipping copy, not a placeholder for it. Where a decision is still open it is marked **[OPEN]**.

---

## 1. Voice

Warm, plain, and never excited on the user's behalf. We are handling somebody's money and somebody's birthday at the same time, so the tone is a good bank teller rather than a crypto launch.

Rules:

- **Say "sBTC".** Never "sats", never "BTC", never "$BTC" for on-chain amounts (N-9). A fiat equivalent may appear alongside, always as a secondary, greyed figure with "approx".
- **No jargon on the recipient's path.** A first-time recipient should never read "escrow", "principal", "post-condition", "burn block", "non-custodial" or "SIP-010". Those words are allowed on `/create`, in the receipt's detail drawer, and in these docs.
- **Never promise a minute.** Times are approximate because Bitcoin blocks are. "Opens on or about 25 December."
- **Bad news arrives first and plainly.** "This gift has already been opened" comes before any explanation of what to do next.
- **No exclamation marks in error states.** Ever.

## 2. Sender flow — `/create`

### Step 0 · Landing

```
                    Give Bitcoin that grows
        Send sBTC as a link. Choose when it opens.
             If it's never opened, it comes back.

                   [ Send a gift ]
              Try it: open a demo gift →
```

The "Try it" link claims a real testnet gift and is the single most important element on this page for a grant reviewer (R-6.4). It is not buried in a footer.

### Step 1 · Connect

Leather and Xverse, side by side. Beneath: "New to Stacks? Here's how to get a wallet →"

If the connected wallet holds no sBTC, we do not fail — we show the balance as zero and link the testnet faucet inline (R-6.5), because a reviewer's first visit is very likely to be exactly this state.

### Step 2 · Amount

Large numeric input, denominated in sBTC, with an approximate fiat figure underneath. Quick chips for common values. Inline, live validation against `min-amount`, `max-amount`, the wallet balance and the protocol cap — each with its own message, never a generic "invalid amount".

> Testnet banner, always visible: **This is testnet. These aren't real bitcoin.**

### Step 3 · When it opens

```
   Opens        [ Right away ]  [ In a week ]  [ In a month ]  [ Pick a date ]

   ┌────────────────────────────────────────────────────────┐
   │  🎄  Opens on or about  Friday 25 December 2026        │
   │      That's about 92 days — roughly 13,248 Bitcoin     │
   │      blocks from now.                                   │
   └────────────────────────────────────────────────────────┘

   Comes back to you if unopened by   ~23 June 2027   [change]
```

Three deliberate choices here:

1. **"On or about"** is in the primary line, not a footnote. We are honest about block-time variance from the first moment, not at the point of complaint.
2. **The block count is shown**, not hidden. It teaches the mechanism to anyone curious and gives a precise number to anyone who wants one.
3. **Expiry is shown by default**, not tucked into an "advanced" section. The safety net is a feature; hiding it wastes it.

**[OPEN]** Whether the default is "Right away" or "In a week". Assumption A-2 — worth A/B testing, since it decides whether Ripen is a gifting product or a transfer product.

### Step 4 · Message and card

Message up to 500 characters; theme picker. Under the field, in small text:

> Only the person with the link can read this. It's encrypted on your device — we can't read it, and it isn't published on the blockchain.

That is a true statement about a real property ([architecture §4](02-architecture.md#4-the-message-encrypted-off-chain-committed-on-chain)), and it is exactly the sort of thing users assume is false about crypto apps. Say it.

### Step 5 · Review

```
   You're locking          0.0025 sBTC      (~$260)
   Opens                   on or about 25 Dec 2026
   Returns to you if unopened by  23 Jun 2027

   Exactly 0.0025 sBTC will leave your wallet. Your wallet
   enforces this — not us.

   Anyone who has the link can open this gift. Share it
   like cash.

                     [ Lock it ]
```

Two warnings, both load-bearing. The post-condition line (R-1.9) explains a genuine security property in one sentence. The bearer warning (R-6.1) appears here and again at the share step, because it is the single most likely way a user loses money and it is not obvious.

### Step 6 · Sealed

Transaction pending → confirmed, with an honest state machine (§6). Then:

```
              Your gift is sealed 🌱

    ┌────────────────────────────────────┐
    │   [ ripening gift card preview ]   │
    │   0.0025 sBTC · opens 25 Dec       │
    └────────────────────────────────────┘

       ripen.app/g/8f3k2a#k=9c1f...

    [ Copy link ]  [ Share ]  [ Save to my device ]

    ⚠  This link is the gift. We don't keep a copy.
       If you lose it, the sBTC comes back to you on
       23 June 2027 — but nobody can open it before then.

              [ I've saved it → Done ]
```

**"Done" is disabled until the sender copies, shares or downloads** (R-1.10). This is a friction we are adding on purpose: the alternative is a user closing the tab and quietly losing access to their own gift for six months. The warning says exactly what happens rather than "keep this safe".

## 3. Recipient flow — `/g/[id]`

### The social preview

Before anything is opened, the card in the chat already reads:

> **Ada sent you sBTC** · 🌱 Opens 25 December · ripen.app

Server-rendered from public on-chain data. The secret is in the fragment and never reaches the crawler ([claim protocol §2](04-claim-protocol.md#2-the-link)).

### State A · Still ripening

```
              Ada sent you a gift

         ┌──────────────────────────┐
         │      🌱  62% ripe        │
         │    ╭────────────────╮    │
         │    │   0.0025 sBTC  │    │
         │    ╰────────────────╯    │
         └──────────────────────────┘

              Opens in 34 days
        on or about 25 December 2026

     "Happy birthday kid. Don't spend it all at once."

         [ Remind me ]   [ What is sBTC? ]
```

No wallet prompt. No "connect to continue". The recipient sees what they have been given, from whom, and when it opens, having done nothing (R-2.1). Everything else on the page is optional.

The countdown is live; the ripeness ring fills over the whole lock period, so returning visitors see visible movement. Ripeness is never conveyed by colour alone (N-6) — the percentage and the ring's fill both carry it.

### State B · Ripe

```
              Ada sent you a gift

         ┌──────────────────────────┐
         │      🍑  Ready           │
         │        0.0025 sBTC       │
         └──────────────────────────┘

     "Happy birthday kid. Don't spend it all at once."

             [ Open my gift ]

     No fees. You don't need anything to receive this.
```

One button. The line underneath is the product's whole promise and it should not be decorated.

### State B2 · Where should it go

```
        Where should we send your sBTC?

     [ Connect Leather ]   [ Connect Xverse ]

     ─────────────  or  ─────────────

     Paste a Stacks address
     [ SP...                                    ]

     ⚠  Don't use an exchange deposit address.
        Send it to a wallet you control.

     Don't have a wallet yet? Get one — takes a minute →
```

Connecting a wallet here reads an address. It does not authorise a transaction, and the copy says so, because users have learned that "connect wallet" means "something is about to be taken".

The exchange-address warning is not boilerplate: sBTC sent to an exchange deposit address that does not support sBTC is gone, and this is the most likely irreversible mistake on the recipient path (R-3.7).

### State C · Opening

```
              Opening your gift…

        [ animation: the card breaks open ]

         Submitted · waiting for the
         Stacks network (a few seconds)
```

Then:

```
                   It's yours 🎉

                   0.0025 sBTC
              is now in your wallet

           [ See it on the explorer ]
           [ What can I do with sBTC? ]
           [ Send a gift back ]

    This is real Bitcoin, held on Stacks. Nobody can
    take it back — it's yours.
```

"Send a gift back" is the only growth loop in Milestone 1, and it appears at the single highest-intent moment the product has.

### State D · Already opened

```
            This gift has already been opened

                on 3 November 2026
              → SP2J6ZY...  [explorer]

    If that wasn't you, whoever had the link opened it
    first. Links work like cash.
```

Factual, not accusatory, and it explains the mechanism rather than implying a fault.

### State E · Expired

```
              This gift went back to Ada

     It wasn't opened before 23 June 2027, so the sBTC
     returned to the person who sent it. Nothing was lost.

                 [ Ask Ada about it ]
```

### State F · Broken or wrong link

```
                 We can't find this gift

   The link may be incomplete. Links end with a long code
   after a # — chat apps sometimes cut it off.

   Try opening the link from where you first received it,
   or ask the sender to resend it.
```

Names the actual most common cause. A truncated fragment from a chat client that mangles long URLs will be the top support issue, and a generic "not found" would send users hunting in the wrong place.

## 4. Sender dashboard — `/dashboard`

Gifts grouped by what the sender can act on:

| Group | Sorted by | Action |
|---|---|---|
| **Needs your attention** | Expiry ascending | Return to me — one tap (R-4.4) |
| **Ripening** | Unlock ascending | Copy link, share |
| **Ready to open** | Unlock descending | Nudge the recipient |
| **Opened** | Claim date descending | View receipt |
| **Returned** | Date descending | — |

The link is shown only for gifts whose key is still cached in this browser. Where it is not, we say so plainly rather than showing a broken control:

> We don't have this gift's link on this device — links are only stored where they were created. The sBTC returns to you on 23 June 2027.

## 5. Receipt — `/r/[id]`

A permanent, public, shareable page: amount, sender, sealed date, opened date, recipient, transaction links, and the full timeline. Works for both parties and for anyone who is handed the URL. A detail drawer exposes the contract address, gift id, unlock and expiry block heights, and the message commitment, for anyone who wants to verify rather than trust.

## 6. Confirmation states

Never say "done" before it is done (R-3.8):

| Stage | Copy | Typical |
|---|---|---|
| Submitted | "Sent to the network" | instant |
| In a Stacks block | "Confirmed" | seconds |
| Bitcoin-anchored | "Settled on Bitcoin" (detail drawer only) | ~10–30 min |
| Failed | The specific reason, from §7 | — |

"Confirmed" is the headline state, because it is the point at which the funds have moved and the user can act. Bitcoin anchoring is shown to the curious, not used to keep a first-time recipient staring at a spinner for twenty minutes.

## 7. Error copy

A raw contract error code must never reach a user.

| Code | Constant | What the user reads |
|---|---|---|
| `u100` | `ERR-PAUSED` | "New gifts are paused right now while we check something. Existing gifts are unaffected — you can still open and return them." |
| `u102` | `ERR-NOT-FOUND` | State F copy above |
| `u103` | `ERR-NOT-PENDING` | State D copy above |
| `u104` | `ERR-STILL-LOCKED` | "Not quite ready — this opens on or about 25 December." |
| `u105` | `ERR-EXPIRED` | State E copy above |
| `u106` | `ERR-NOT-EXPIRED` | "This gift hasn't expired yet. You can return it to yourself after 23 June 2027." |
| `u107` | `ERR-BAD-SIGNATURE` | "This link doesn't match this gift. Check you copied the whole link, including everything after the #." |
| `u108` | `ERR-INVALID-AMOUNT` | The specific bound: "Gifts start at 0.00001 sBTC" / "Gifts are capped at 0.01 sBTC while we're on testnet." |
| `u112` | `ERR-CAP-EXCEEDED` | "Ripen is holding as much sBTC as it's set up to hold right now. Try a smaller amount, or come back shortly." |

The `u100` copy deliberately mentions that claims still work, because a user who sees "paused" will assume their money is frozen. It isn't — pausing cannot block a claim ([invariant I-5](03-contract-spec.md#6-invariants)) — and that is a promise worth spending a sentence on.

## 8. Ripeness

One visual, everywhere: claim page, dashboard card, social preview, receipt.

| Stage | Visual | Meaning |
|---|---|---|
| 0–99% | 🌱 filling ring, green → gold | Time elapsed between creation and unlock |
| 100% | 🍑 full, gentle pulse | Claimable |
| Claimed | Opened card | Settled |
| Expired | Muted, fallen | Returned to sender |

Ripeness is **elapsed time only**. When yield arrives in Milestone 3 it gets its own number and its own motion. Conflating "how long it has waited" with "how much it has earned" would make the most honest-looking part of the UI the least honest ([principle 7](01-prd.md#5-product-principles)).

## 9. Accessibility

- Countdown and ripeness carry text and shape, never colour alone (N-6).
- `prefers-reduced-motion` disables the opening animation; the state change is instant and still legible.
- Every flow completes at 360 px (N-3), and the claim page's primary action stays in thumb reach.
- Amounts have a screen-reader-friendly form: "zero point zero zero two five sBTC".
- Address fields accept pasted whitespace and mixed case without complaint.

---

*Next: [Threat model](06-threat-model.md) · [Roadmap and metrics](07-roadmap-and-metrics.md)*
