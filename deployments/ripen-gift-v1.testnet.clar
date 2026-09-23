;; ripen-gift-v1
;; Non-custodial sBTC gift escrow for Stacks.
;;
;; A sender locks sBTC against a one-time secp256k1 public key. Whoever holds the
;; matching private key signs a message binding the gift id and a destination
;; address; the contract verifies that signature and pays the bound destination.
;; Because authorisation lives in the signature rather than in the transaction
;; sender, ANY caller may submit a claim and the funds can still only reach the
;; address the claimant signed for. That is what allows a recipient to receive
;; sBTC without holding STX or signing a Stacks transaction.
;;
;; Unclaimed gifts return to the original sender after expiry. Reclaim is
;; permissionless because the destination is hard-wired to the stored sender.
;;
;; Specification: docs/03-contract-spec.md
;; Claim protocol: docs/04-claim-protocol.md
;; Invariants I-1..I-7 are stated in the spec and tested in tests/.

;; ---------------------------------------------------------------------------
;; sBTC token binding
;;
;; NETWORK-SPECIFIC. Clarity requires contract-call? to name a literal contract,
;; so this cannot be a constant. It appears in exactly the two private functions
;; below and nowhere else. Run `npm run check:network` before any deployment.
;;
;;   devnet/tests  .mock-sbtc-token
;;   testnet       'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token
;;   mainnet       'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
;;
;; The token is named literally rather than accepted as a SIP-010 trait argument
;; so that no caller can substitute a counterfeit token (ADR-003).
;; ---------------------------------------------------------------------------

(define-private (sbtc-transfer-in (amount uint) (from principal))
  (contract-call? 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token transfer amount from (as-contract tx-sender) none))

(define-private (sbtc-pay-out (amount uint) (to principal))
  (as-contract (contract-call? 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token transfer amount tx-sender to none)))

;; ---------------------------------------------------------------------------
;; Constants
;; ---------------------------------------------------------------------------

(define-constant CONTRACT-PRINCIPAL (as-contract tx-sender))

;; SIP-018 structured data signing. The prefix is ASCII "SIP018" and guarantees
;; the signed bytes can never also be a valid Stacks transaction.
(define-constant SIP018-PREFIX 0x534950303138)
(define-constant DOMAIN-HASH (sha256 (unwrap-panic (to-consensus-buff?
  { name: "Ripen", version: "1", chain-id: chain-id }))))

(define-constant STATUS-PENDING   u0)
(define-constant STATUS-CLAIMED   u1)
(define-constant STATUS-RECLAIMED u2)

(define-constant ERR-PAUSED             (err u100))
(define-constant ERR-NOT-AUTHORIZED     (err u101))
(define-constant ERR-NOT-FOUND          (err u102))
(define-constant ERR-NOT-PENDING        (err u103))
(define-constant ERR-STILL-LOCKED       (err u104))
(define-constant ERR-EXPIRED            (err u105))
(define-constant ERR-NOT-EXPIRED        (err u106))
(define-constant ERR-BAD-SIGNATURE      (err u107))
(define-constant ERR-INVALID-AMOUNT     (err u108))
(define-constant ERR-INVALID-SCHEDULE   (err u109))
(define-constant ERR-INVALID-PUBKEY     (err u110))
(define-constant ERR-PUBKEY-IN-USE      (err u111))
(define-constant ERR-CAP-EXCEEDED       (err u112))
(define-constant ERR-INVALID-RECIPIENT  (err u114))

;; ---------------------------------------------------------------------------
;; State
;; ---------------------------------------------------------------------------

(define-map gifts uint {
  sender:         principal,
  amount:         uint,
  unlock-height:  uint,   ;; burn-block-height, inclusive
  expiry-height:  uint,   ;; burn-block-height, exclusive
  claim-pubkey:   (buff 33),
  msg-commitment: (buff 32),
  status:         uint,
  recipient:      (optional principal),
  created-at:     uint
})

;; One public key is bound to one gift, permanently, including after settlement.
;; Never deleted: reuse would let an old signature apply to a new gift (I-4).
(define-map pubkey-gift (buff 33) uint)

(define-data-var gift-counter uint u0)
(define-data-var total-locked uint u0)

;; Configuration. Every one of these governs CREATION only. None can touch a
;; gift that already exists, and none can block a claim or a reclaim (I-5, I-6).
(define-data-var min-amount uint u1000)              ;; 0.00001 sBTC
(define-data-var max-amount uint u1000000)           ;; 0.01 sBTC
(define-data-var max-total-locked uint u100000000)   ;; 1 sBTC
(define-data-var max-duration uint u105120)          ;; ~2 years in Bitcoin blocks
(define-data-var paused bool false)
(define-data-var contract-owner principal tx-sender)

;; ---------------------------------------------------------------------------
;; Claim message (SIP-018)
;;
;; Public and read-only on purpose: any client, or anyone with a block explorer
;; and no trust in our documentation, can ask the contract itself what to sign.
;; Four bindings, each blocking a specific attack:
;;   gift-id    replay against another gift
;;   recipient  front-running; nobody can redirect a claim, including our relayer
;;   contract   replay against another Ripen version
;;   chain-id   replay of a testnet signature on mainnet (inside DOMAIN-HASH)
;; ---------------------------------------------------------------------------

(define-read-only (claim-message-hash (gift-id uint) (recipient principal))
  (sha256 (concat SIP018-PREFIX
          (concat DOMAIN-HASH
                  (sha256 (unwrap-panic (to-consensus-buff? {
                    contract:  CONTRACT-PRINCIPAL,
                    gift-id:   gift-id,
                    recipient: recipient
                  })))))))

;; ---------------------------------------------------------------------------
;; Read-only getters
;; ---------------------------------------------------------------------------

(define-read-only (get-gift (gift-id uint))
  (map-get? gifts gift-id))

(define-read-only (get-gift-id-by-pubkey (claim-pubkey (buff 33)))
  (map-get? pubkey-gift claim-pubkey))

(define-read-only (get-gift-state (gift-id uint))
  (match (map-get? gifts gift-id) gift
    (some {
      status: (get status gift),
      claimable: (and (is-eq (get status gift) STATUS-PENDING)
                      (>= burn-block-height (get unlock-height gift))
                      (< burn-block-height (get expiry-height gift))),
      reclaimable: (and (is-eq (get status gift) STATUS-PENDING)
                        (>= burn-block-height (get expiry-height gift))),
      blocks-until-unlock: (if (>= burn-block-height (get unlock-height gift))
                              u0 (- (get unlock-height gift) burn-block-height)),
      blocks-until-expiry: (if (>= burn-block-height (get expiry-height gift))
                              u0 (- (get expiry-height gift) burn-block-height))
    })
    none))

(define-read-only (get-config)
  {
    min-amount:       (var-get min-amount),
    max-amount:       (var-get max-amount),
    max-total-locked: (var-get max-total-locked),
    max-duration:     (var-get max-duration),
    total-locked:     (var-get total-locked),
    gift-count:       (var-get gift-counter),
    paused:           (var-get paused),
    contract-owner:   (var-get contract-owner)
  })

;; ---------------------------------------------------------------------------
;; create-gift
;; ---------------------------------------------------------------------------

(define-public (create-gift
    (amount uint)
    (unlock-height uint)
    (expiry-height uint)
    (claim-pubkey (buff 33))
    (msg-commitment (buff 32)))
  (let ((gift-id (+ (var-get gift-counter) u1))
        (sender tx-sender))
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (and (>= amount (var-get min-amount))
                   (<= amount (var-get max-amount))) ERR-INVALID-AMOUNT)
    (asserts! (<= (+ (var-get total-locked) amount)
                  (var-get max-total-locked)) ERR-CAP-EXCEEDED)
    ;; unlock may be in the past (an immediately-claimable gift), but a gift that
    ;; is born expired is only ever a support ticket.
    (asserts! (> expiry-height unlock-height) ERR-INVALID-SCHEDULE)
    (asserts! (> expiry-height burn-block-height) ERR-INVALID-SCHEDULE)
    (asserts! (<= (- expiry-height burn-block-height)
                  (var-get max-duration)) ERR-INVALID-SCHEDULE)
    ;; A malformed key would make the gift unclaimable until expiry.
    (asserts! (is-ok (principal-of? claim-pubkey)) ERR-INVALID-PUBKEY)
    (asserts! (is-none (map-get? pubkey-gift claim-pubkey)) ERR-PUBKEY-IN-USE)

    (try! (sbtc-transfer-in amount sender))

    (map-set gifts gift-id {
      sender: sender,
      amount: amount,
      unlock-height: unlock-height,
      expiry-height: expiry-height,
      claim-pubkey: claim-pubkey,
      msg-commitment: msg-commitment,
      status: STATUS-PENDING,
      recipient: none,
      created-at: burn-block-height
    })
    (map-set pubkey-gift claim-pubkey gift-id)
    (var-set gift-counter gift-id)
    (var-set total-locked (+ (var-get total-locked) amount))

    (print {
      event: "gift-created",
      gift-id: gift-id,
      sender: sender,
      amount: amount,
      unlock-height: unlock-height,
      expiry-height: expiry-height,
      claim-pubkey: claim-pubkey,
      msg-commitment: msg-commitment
    })
    (ok gift-id)))

;; ---------------------------------------------------------------------------
;; claim-gift
;;
;; Deliberately callable by anyone. Authorisation is the signature, not the
;; transaction sender, which is what makes gas-free claiming possible.
;; Never pausable.
;; ---------------------------------------------------------------------------

(define-public (claim-gift
    (gift-id uint)
    (recipient principal)
    (signature (buff 65)))
  (let ((gift (unwrap! (map-get? gifts gift-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get status gift) STATUS-PENDING) ERR-NOT-PENDING)
    (asserts! (>= burn-block-height (get unlock-height gift)) ERR-STILL-LOCKED)
    (asserts! (< burn-block-height (get expiry-height gift)) ERR-EXPIRED)
    ;; Paying the escrow itself would leave sBTC in the contract with no gift
    ;; accounting for it, breaking invariant I-1.
    (asserts! (not (is-eq recipient CONTRACT-PRINCIPAL)) ERR-INVALID-RECIPIENT)
    (asserts! (secp256k1-verify (claim-message-hash gift-id recipient)
                                signature
                                (get claim-pubkey gift)) ERR-BAD-SIGNATURE)

    ;; State before transfer. Clarity has no reentrancy; this is so a failed
    ;; transfer aborts the whole call atomically and leaves nothing half-done.
    (map-set gifts gift-id (merge gift {
      status: STATUS-CLAIMED,
      recipient: (some recipient)
    }))
    (var-set total-locked (- (var-get total-locked) (get amount gift)))

    (try! (sbtc-pay-out (get amount gift) recipient))

    (print {
      event: "gift-claimed",
      gift-id: gift-id,
      recipient: recipient,
      amount: (get amount gift),
      sender: (get sender gift)
    })
    (ok gift-id)))

;; ---------------------------------------------------------------------------
;; reclaim-gift
;;
;; Permissionless: any caller may trigger it, and the destination is always the
;; sender stored at creation. There is no destination to get wrong, so opening
;; it up adds no attack surface, and it lets a sweeper return forgotten gifts
;; without the sender doing anything (ADR-005). Never pausable.
;; ---------------------------------------------------------------------------

(define-public (reclaim-gift (gift-id uint))
  (let ((gift (unwrap! (map-get? gifts gift-id) ERR-NOT-FOUND)))
    (asserts! (is-eq (get status gift) STATUS-PENDING) ERR-NOT-PENDING)
    (asserts! (>= burn-block-height (get expiry-height gift)) ERR-NOT-EXPIRED)

    (map-set gifts gift-id (merge gift { status: STATUS-RECLAIMED }))
    (var-set total-locked (- (var-get total-locked) (get amount gift)))

    (try! (sbtc-pay-out (get amount gift) (get sender gift)))

    (print {
      event: "gift-reclaimed",
      gift-id: gift-id,
      sender: (get sender gift),
      amount: (get amount gift)
    })
    (ok gift-id)))

;; ---------------------------------------------------------------------------
;; Administration
;;
;; None of these can move sBTC, alter a gift record, change a schedule, or
;; affect claim-gift or reclaim-gift in any way (I-5, I-6).
;; ---------------------------------------------------------------------------

(define-public (set-paused (new-paused bool))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-AUTHORIZED)
    (var-set paused new-paused)
    (print { event: "paused-set", paused: new-paused })
    (ok true)))

(define-public (set-limits (new-min uint) (new-max uint) (new-cap uint) (new-dur uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-AUTHORIZED)
    (asserts! (<= new-min new-max) ERR-INVALID-AMOUNT)
    (var-set min-amount new-min)
    (var-set max-amount new-max)
    (var-set max-total-locked new-cap)
    (var-set max-duration new-dur)
    (print { event: "limits-set", min-amount: new-min, max-amount: new-max,
             max-total-locked: new-cap, max-duration: new-dur })
    (ok true)))

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-AUTHORIZED)
    (var-set contract-owner new-owner)
    (print { event: "ownership-transferred", new-owner: new-owner })
    (ok true)))
