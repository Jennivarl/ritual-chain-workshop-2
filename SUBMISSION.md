# Bootcamp 2, Self Resolving Prediction Market

**Author:** varl999 · fork of [`cozfuttu/ritual-chain-workshop-2`](https://github.com/cozfuttu/ritual-chain-workshop-2)

`cd hardhat && npm install && npx hardhat test` gives **60 passing** (56 Solidity, 4 Node).
`cd web && npm install && npm run build` is clean, and so are `eslint` and `tsc --noEmit`.

---

## 1. What the starter gives you, and what it leaves open

The starter is a good piece of work. The whole shape of the market is already there:
storage layout, structs, enums, events, errors, betting, payouts, the read only views,
the fee funding, the address book in `RitualChain.sol`, seven scripts, and a README that
explains the design properly. Seventeen functions are written and working.

Five are left open, each with a `// we'll fill this up` body:

| Function | What it does |
|---|---|
| `createMarket` | creates the market and books its own resolution |
| `onScheduledResolve` | the Scheduler callback |
| `_scheduleResolution` | the `schedule()` booking |
| `_readOracle` | HTTP precompile (`0x0801`) then jq (`0x0803`) |
| `_pickExecutor` | picks the TEE executor |

Those five are the Ritual specific path. Everything that makes the market resolve itself
lives in exactly those holes, so that is where the work went. I checked upstream for a
finished branch like Bootcamp 1 had, and there is none, `main` is the only branch.

Three other things were missing or broken, and I fixed them:

- `hardhat/README.md` describes `contracts/RitualPredict.t.sol`,
  `contracts/mocks/RitualMocks.sol` and `test/RitualPredict.e2e.ts`, and says there are
  33 Solidity and 2 TypeScript tests. None of those files were in the repo.
- `npx hardhat test` failed on a fresh clone. The one test present, `test/Counter.ts`,
  deploys a `Counter` contract that is not in the repo, so both cases error out.
- There was no `web/` folder, even though `scripts/export-abi.ts` writes into
  `web/src/lib/predict-abi.ts` and `scripts/market-presets.ts` points at
  `web/src/lib/presets.ts`.

---

## 2. The five functions

Every ABI here came from
[`ritual-foundation/ritual-dapp-skills`](https://github.com/ritual-foundation/ritual-dapp-skills)
(`skills/ritual-dapp-http` and `skills/ritual-dapp-scheduler`). I did not guess any of it.

### `createMarket`

Checks the rule, turns human seconds into block numbers using the block time fixed at
deploy, stores the market, and books all three resolution attempts with the Scheduler in
the same transaction. Once it returns, nothing off chain needs to remember the market
exists.

### `_scheduleResolution`

```solidity
bytes memory data = abi.encodeWithSelector(
    this.onScheduledResolve.selector,
    uint256(0),   // the Scheduler overwrites bytes 4 to 35 with the real executionIndex
    marketId
);
```

Booked with `numCalls = 3`, `frequency = 200`, `ttl = 150`, and `payer = address(this)`.
The contract pays for its own resolution out of its own RitualWallet balance, not the
creator's. `frequency * numCalls` is 600, well under the Scheduler limit of 10,000.
`maxFeePerGas` is twice the base fee with a 1 gwei floor, so a market created in a quiet
block can still afford to resolve in a busy one.

### `_pickExecutor`

Calls `pickServiceByCapability(HTTP_CALL, true, seed, 8)`. The seed is rebuilt from the
previous block hash, the market id and the execution index, so a retry does not draw the
same unhealthy executor twice. Wrapped in `try` and `catch` returning `address(0)`, so a
registry that reverts counts as a failed attempt instead of killing the execution.

### `_readOracle`

Builds the 13 field HTTP request, then decodes the 5 field response through the
contract's own external `decodeHttpResponse`, so bad bytes come back as a caught failure
instead of a revert. Six different things count as failure, and none of them count as NO:
the precompile call reverting, an envelope it cannot decode, output that has not settled
yet, a status that is not 200, an error string from the executor, an empty body, and a
body jq cannot read.

### `onScheduledResolve`

Reverts only if the caller is not the Scheduler. Everything else returns quietly, because
a revert here would undo the attempt counter and the market could then never reach
`Invalid`. It is safe to call twice, so a leftover execution landing on a settled market
does nothing, and it cancels the remaining bookings once a read succeeds.

---

## 3. Decisions I would defend

**A failed read is never a NO.** This is the one that matters. A market nobody could read
is not a market that resolved negatively. Treating those two the same would let anyone who
can break your oracle mint a NO for free. So it retries three times, then goes `Invalid`,
and everyone takes their stake back. Every failure test asserts the outcome is still
`Unresolved`, not just that it did not settle YES.

**Nobody on the winning side means refunds, not a windfall.** Pari mutuel has no
denominator when nobody backed the winning answer. The outcome and the observed value are
still recorded, because the market did resolve, it just cannot pay. Then everyone refunds.

**Everything is a block number.** No `block.timestamp` anywhere. The Scheduler fires at a
block, so betting closes at a block too, and "betting is closed" can never disagree with
"the Scheduler woke us". On Ritual Chain `block.timestamp` is in milliseconds, which is a
second good reason to stay away from it.

**Payouts are pulled, not pushed.** `claimWinnings` works out one caller's share. Nothing
loops over participants, so no market can become impossible to settle just by growing.

---

## 4. Tests, 60 passing

```bash
cd hardhat
npm install
npx hardhat test        # 60 passing (56 solidity, 4 nodejs)
```

### Solidity, 56 tests, `contracts/RitualPredict.t.sol`

The Ritual system contracts and precompiles are etched onto their real addresses with
`vm.etch`, so the contract calls the same addresses it would on chain and never finds out
it is being tested. No network and no funded account needed.

Two mocks in `contracts/mocks/RitualMocks.sol` do real work:

- `MockScheduler.fire()` replays a booked execution the way the chain does, overwriting
  bytes 4 to 35 of the stored calldata with the real execution index. So that convention
  is actually exercised, not just assumed.
- `MockJqPrecompile` really reads the JSON. It walks to the top level key named by the
  query and parses the digits after the colon. That keeps "could not parse oracle body"
  honest, because the malformed JSON test feeds it real garbage and gets a real miss
  rather than a flag someone flipped.

Covered: creation and its checks, the exact Scheduler booking (gas, start block, retries,
ttl, payer, fee floor, placeholder index), betting, the view that reports `Closed` with no
transaction, every resolution failure branch, recovery on a retry, going `Invalid` on the
third failure, the empty winning side case, payouts, refunds, and fee funding.

### TypeScript, 4 tests, `test/RitualPredict.e2e.ts`

Real transactions from real accounts against a local Hardhat node, with real blocks mined
in between and balances actually moving. Mocks are deployed normally, then grafted onto
the real addresses with `setCode`.

Full settlement through the Scheduler callback with a payout, three failed reads going
`Invalid` and refunding both sides, two markets with opposite comparators settling
independently from one observed value, and prepaid fee funding.

---

## 5. Three things that caught me out

**Gas estimation is dangerous for callbacks like this.** `fire()` ignores whether the
callback succeeded, because the real Scheduler has to work that way. A failed run must not
undo the scheduled transaction. But that quietly breaks `eth_estimateGas`. The outer call
still succeeds at a gas limit where the inner call runs out, so the estimator settles on
that limit. The transaction comes back as success with nothing changed at all. No error,
no revert, no clue. It cost me about an hour. The fix is to set the gas yourself.

**One storage write in a `staticcall` target breaks everything silently.** `_jqUint`
reaches jq through `staticcall`. My jq mock had a call counter in its fallback, and a
counter writes to storage. So every oracle read reverted and every market went `Invalid`.
The nasty part is that all the failure tests still passed, because they only checked that
resolving failed. Only the success tests caught it.

**`abi.encode` of many flat values is not the same as encoding a struct.** The flat form
has no leading offset, so decoding it back into a struct needs `0x20` put in front. Worth
knowing, because the 13 field HTTP request is stack too deep as flat locals, so a struct
is the natural way to read it back.

---

## 6. The frontend

`web/` is Next.js 16, wagmi 3, viem and Tailwind 4.

The demo oracle at `/api/oracle/eth` is the endpoint a TEE executor fetches from inside
the enclave. It answers a flat `{"price": n}` and sends `no-store`, because a cached
response anywhere between the app and the executor would settle markets on stale data.
`POST` sets the price and `DELETE` resets it, so both outcomes can be shown without
waiting for a real price to move. The value is floored on the way in, since `uint256` is
what the chain reads anyway.

The market list shows the odds as a split bar with live payout multiples, and turns every
block deadline into a time using the measured block time of about 195ms. A raw block count
tells a reader nothing. Resolved markets say what the enclave saw and that nobody pressed
a button. Invalid ones show the reason and offer the refund.

The create form repeats the contract's own checks, so a bad market is caught before it
costs gas. That includes rejecting `localhost` oracle URLs, which the enclave cannot reach
and which would send every market they create to `Invalid` after three failed attempts.

Checked with the production server running: the page renders, the oracle returns 4123 by
default, `POST 3999.87` floors to 3999, bad input is rejected, `DELETE` resets, and
`Cache-Control: no-store` is there.

---

## 7. What I could not check

**Ritual Chain testnet is down, so nothing here is deployed.** Everything above was run
locally. The Solidity suite ran against etched mocks, the end to end suite against a local
Hardhat node, and the frontend against its own server. The deploy scripts are the
starter's and I have not changed them. I have not run them against a live chain, and I am
not going to claim an address I do not have.

What that really leaves unproven is the executor's behaviour at the moment the settled
output comes back. My mocks copy the response shape from Ritual's own documented ABI, and
the failure handling around it is thorough, but only a live TEE can confirm that path from
end to end. I would rather say so than show a green tick that has not earned it.

---

## 8. Running it

```bash
# contracts
cd hardhat
npm install                  # or pnpm install
npx hardhat build
npx hardhat test             # 60 passing

# frontend
cd ../web
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_PREDICT_ADDRESS once deployed
npm run dev

# when a chain is available
cd ../hardhat
npx hardhat run scripts/deploy.ts
# the executor cannot reach localhost, so expose the oracle first
cloudflared tunnel --url http://localhost:3000
```
