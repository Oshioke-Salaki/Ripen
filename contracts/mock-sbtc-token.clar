;; mock-sbtc-token
;; A minimal SIP-010 test double for the sBTC token.
;;
;; DEVNET AND TESTS ONLY. This contract is never deployed to testnet or mainnet;
;; there, ripen-gift-v1 points at the real sBTC token contract instead. See
;; scripts/check-network-constant.mjs.

(define-fungible-token sbtc-token)

(define-constant ERR-NOT-AUTHORIZED (err u4))

(define-read-only (get-name) (ok "sBTC"))
(define-read-only (get-symbol) (ok "sBTC"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance sbtc-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply sbtc-token)))
(define-read-only (get-token-uri) (ok none))

;; Mirrors the real sBTC token's authorisation check: the sender must either be
;; the transaction signer, or the contract making the call on their behalf.
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? sbtc-token amount sender recipient))
    (ok true)))

;; Test-only faucet.
(define-public (mint (amount uint) (recipient principal))
  (ft-mint? sbtc-token amount recipient))
