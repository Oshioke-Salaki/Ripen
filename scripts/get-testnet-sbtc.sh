#!/usr/bin/env bash
# Retry the Hiro testnet sBTC faucet until sBTC actually lands.
# The faucet's own account runs dry periodically, so a 200 response with a txid
# does not mean funds arrived — the transfer can abort afterwards. We poll the
# balance, not the faucet's reply. Bounded so it always terminates.
set -u
ADDR="${1:-STXWNPMB6D6Y8F4GMSR66RVP4WTWN03B94XRMA31}"
API="https://api.testnet.hiro.so"
for i in $(seq 1 18); do
  curl -s --max-time 25 -X POST "$API/extended/v1/faucets/sbtc?address=$ADDR" >/dev/null 2>&1
  sleep 50
  BAL=$(curl -s --max-time 25 "$API/extended/v1/address/$ADDR/balances" | python3 -c "
import json,sys
try:
    ft=json.load(sys.stdin).get('fungible_tokens',{})
    for k,v in ft.items():
        if 'sbtc' in k.lower() and int(v['balance'])>0: print(v['balance']); break
    else: print(0)
except Exception: print(0)
" 2>/dev/null)
  echo "attempt $i: sBTC balance = ${BAL:-0}"
  if [ "${BAL:-0}" != "0" ]; then echo "SBTC_ARRIVED=${BAL}"; exit 0; fi
done
echo "FAUCET_STILL_DRY after 18 attempts"
exit 1
