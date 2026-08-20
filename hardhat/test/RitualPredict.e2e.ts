/**
 * End-to-end walkthroughs of the workshop flow against a local Hardhat node.
 *
 * The Solidity suite in contracts/RitualPredict.t.sol covers the branches. This file
 * covers the thing unit tests cannot: real transactions, from real accounts, with real
 * blocks being mined in between, and native balances actually moving.
 *
 * The Ritual system contracts and precompiles do not exist on a local node, so each
 * mock is deployed normally and its runtime code is then grafted onto the canonical
 * address with `setCode`, the TypeScript equivalent of `vm.etch`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { formatEther, parseEther, toHex } from "viem";

import { RITUAL } from "../scripts/ritual.ts";
import { COMPARATOR, MARKET_STATE, OUTCOME } from "../scripts/market-presets.ts";

const BLOCK_TIME_MS = 195n;
const ORACLE_URL = "https://oracle.example/api/oracle/eth";
const PRICE_4123 = toHex('{"price":4123}');

/** MockHttpPrecompile.Mode */
const HTTP_MODE = { ok: 0, revert: 1, unsettled: 2, garbage: 3 } as const;

/**
 * fire() deliberately ignores whether the callback succeeded, exactly as the real
 * Scheduler does - a failed execution must not revert the scheduled transaction. That
 * makes eth_estimateGas useless here: the outer call succeeds at a gas limit where the
 * inner call runs out, so the estimator happily settles on one, the callback silently
 * does nothing, and the market never advances. Always fund fire() explicitly.
 */
const FIRE_GAS = { gas: 5_000_000n } as const;

/**
 * A fresh local chain with the whole Ritual stack mocked into place and
 * RitualPredict deployed and funded on top of it.
 */
async function deployStack() {
  const connection = await network.create();
  const { viem, networkHelpers } = connection;

  const publicClient = await viem.getPublicClient();
  const [deployer, alice, bob] = await viem.getWalletClients();

  if (deployer === undefined || alice === undefined || bob === undefined) {
    throw new Error("expected at least three funded local accounts");
  }

  // Deploy the mock, read back its runtime code, and graft it onto the address the
  // contract has hardcoded. RitualPredict never learns it is talking to a mock.
  async function etch<T extends string>(contractName: T, address: string) {
    const deployed = await viem.deployContract(contractName);
    const code = await publicClient.getCode({ address: deployed.address });
    if (code === undefined) throw new Error(`no runtime code for ${contractName}`);
    await networkHelpers.setCode(address, code);
    return viem.getContractAt(contractName, address as `0x${string}`);
  }

  const scheduler = await etch("MockScheduler", RITUAL.scheduler);
  const ritualWallet = await etch("MockRitualWallet", RITUAL.ritualWallet);
  const registry = await etch("MockTEERegistry", RITUAL.teeServiceRegistry);
  const http = await etch("MockHttpPrecompile", RITUAL.httpPrecompile);
  await etch("MockJqPrecompile", RITUAL.jqPrecompile);

  const executor = "0x00000000000000000000000000000000000e7ec0" as const;
  await registry.write.setExecutors([[executor]]);
  await http.write.setResponse([200, PRICE_4123, ""]);

  // The constructor calls Scheduler.approveScheduler, so the mock must already be in
  // place at this point.
  const predict = await viem.deployContract("RitualPredict", [BLOCK_TIME_MS]);
  await predict.write.fundExecution([500_000n], { value: parseEther("0.5") });

  /** The same contract bound to a different signer. */
  const as = (client: typeof alice) =>
    viem.getContractAt("RitualPredict", predict.address, {
      client: { wallet: client },
    });

  return {
    connection,
    viem,
    networkHelpers,
    publicClient,
    deployer,
    alice,
    bob,
    scheduler,
    ritualWallet,
    registry,
    http,
    predict,
    as,
    executor,
  };
}

/** The shortest market the contract will accept, so tests mine ~230 blocks, not ~1200. */
async function createShortMarket(
  predict: Awaited<ReturnType<typeof deployStack>>["predict"],
  publicClient: Awaited<ReturnType<typeof deployStack>>["publicClient"],
) {
  const hash = await predict.write.createMarket([
    {
      question: "Will ETH/USD be at least $4,000 when this market resolves?",
      oracleUrl: ORACLE_URL,
      jsonPath: ".price",
      target: 4000n,
      comparator: COMPARATOR.gte,
      bettingSeconds: 30n,
      resolveDelaySeconds: 15n,
    },
  ]);
  await publicClient.waitForTransactionReceipt({ hash });
  return 1n;
}

async function mineTo(
  networkHelpers: Awaited<ReturnType<typeof deployStack>>["networkHelpers"],
  publicClient: Awaited<ReturnType<typeof deployStack>>["publicClient"],
  target: bigint,
) {
  const current = await publicClient.getBlockNumber();
  if (target > current) await networkHelpers.mine(Number(target - current));
}

/** Balance delta with gas added back, so the assertion is about the payout alone. */
async function spendAdjustedDelta(
  publicClient: Awaited<ReturnType<typeof deployStack>>["publicClient"],
  address: `0x${string}`,
  before: bigint,
  hash: `0x${string}`,
) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const gas = receipt.gasUsed * receipt.effectiveGasPrice;
  const after = await publicClient.getBalance({ address });
  return after - before + gas;
}

describe("RitualPredict end-to-end", async function () {
  it("settles a market from the Scheduler callback and pays the winners", async function () {
    const s = await deployStack();
    const id = await createShortMarket(s.predict, s.publicClient);

    const alice = await s.as(s.alice);
    const bob = await s.as(s.bob);

    await alice.write.bet([id, true], { value: parseEther("3") });
    await bob.write.bet([id, false], { value: parseEther("1") });

    let market = await s.predict.read.getMarket([id]);
    assert.equal(MARKET_STATE[market.state], "Open");
    assert.equal(market.totalYes, parseEther("3"));
    assert.equal(market.totalNo, parseEther("1"));

    // Betting closes on a block, so mine past it and check the view says so without
    // anyone having sent a transaction.
    await mineTo(s.networkHelpers, s.publicClient, market.closeBlock);
    market = await s.predict.read.getMarket([id]);
    assert.equal(MARKET_STATE[market.state], "Closed");

    await mineTo(s.networkHelpers, s.publicClient, market.resolveBlock);

    // Nobody presses resolve: replay the booked execution the way the chain would,
    // executionIndex injection and all.
    const fired = await s.scheduler.write.fire([market.scheduleId, 0n], FIRE_GAS);
    await s.publicClient.waitForTransactionReceipt({ hash: fired });

    market = await s.predict.read.getMarket([id]);
    assert.equal(MARKET_STATE[market.state], "Resolved");
    assert.equal(OUTCOME[market.outcome], "YES");
    assert.equal(market.observedValue, 4123n);
    assert.equal(market.attempts, 1);

    // The oracle really was read over the precompile, with the registry's executor.
    const request = await s.http.read.decodeLastRequest();
    assert.equal(request.url, ORACLE_URL);
    assert.equal(request.executor.toLowerCase(), s.executor);
    assert.equal(request.method, 1); // GET

    // Pari-mutuel: the whole 4 RITUAL pool goes to the only YES backer.
    const aliceAddress = s.alice.account.address;
    const before = await s.publicClient.getBalance({ address: aliceAddress });
    const claim = await alice.write.claimWinnings([id]);
    const gained = await spendAdjustedDelta(s.publicClient, aliceAddress, before, claim);

    assert.equal(
      gained,
      parseEther("4"),
      `expected the whole pool, got ${formatEther(gained)}`,
    );
    assert.equal(await s.publicClient.getBalance({ address: s.predict.address }), 0n);

    await s.connection.close();
  });

  it("invalidates the market after three failed reads and refunds both sides", async function () {
    const s = await deployStack();
    await s.http.write.setMode([HTTP_MODE.revert]);

    const id = await createShortMarket(s.predict, s.publicClient);
    const alice = await s.as(s.alice);
    const bob = await s.as(s.bob);

    await alice.write.bet([id, true], { value: parseEther("2") });
    await bob.write.bet([id, false], { value: parseEther("1") });

    const market = await s.predict.read.getMarket([id]);
    await mineTo(s.networkHelpers, s.publicClient, market.resolveBlock);

    // Three booked attempts, 200 blocks apart, exactly as createMarket booked them.
    for (let attempt = 0; attempt < 3; attempt++) {
      const hash = await s.scheduler.write.fire([market.scheduleId, BigInt(attempt)], FIRE_GAS);
      await s.publicClient.waitForTransactionReceipt({ hash });
      if (attempt < 2) {
        const midway = await s.predict.read.getMarket([id]);
        assert.equal(MARKET_STATE[midway.state], "Resolving");
        await s.networkHelpers.mine(200);
      }
    }

    const settled = await s.predict.read.getMarket([id]);
    assert.equal(MARKET_STATE[settled.state], "Invalid");
    // A failed read is never a NO.
    assert.equal(OUTCOME[settled.outcome], "Unresolved");
    assert.equal(settled.attempts, 3);
    assert.equal(settled.invalidReason, "http precompile reverted");

    const aliceAddress = s.alice.account.address;
    const before = await s.publicClient.getBalance({ address: aliceAddress });
    const refund = await alice.write.claimRefund([id]);
    const gained = await spendAdjustedDelta(s.publicClient, aliceAddress, before, refund);
    assert.equal(gained, parseEther("2"), "the loser of nothing gets their stake back");

    const bobRefund = await bob.write.claimRefund([id]);
    await s.publicClient.waitForTransactionReceipt({ hash: bobRefund });
    assert.equal(await s.publicClient.getBalance({ address: s.predict.address }), 0n);

    await s.connection.close();
  });

  it("keeps two markets independent on the same contract", async function () {
    const s = await deployStack();
    const alice = await s.as(s.alice);

    const first = await createShortMarket(s.predict, s.publicClient);

    // A second market with the opposite comparator, so one settles YES and one NO
    // from the very same observed value.
    const hash = await s.predict.write.createMarket([
      {
        question: "Will ETH/USD be under $4,000 when this market resolves?",
        oracleUrl: ORACLE_URL,
        jsonPath: ".price",
        target: 4000n,
        comparator: COMPARATOR.lt,
        bettingSeconds: 30n,
        resolveDelaySeconds: 15n,
      },
    ]);
    await s.publicClient.waitForTransactionReceipt({ hash });
    const second = 2n;

    await alice.write.bet([first, true], { value: parseEther("1") });
    await alice.write.bet([second, false], { value: parseEther("1") });

    const a = await s.predict.read.getMarket([first]);
    const b = await s.predict.read.getMarket([second]);
    assert.notEqual(a.scheduleId, b.scheduleId, "each market books its own schedule");

    await mineTo(s.networkHelpers, s.publicClient, b.resolveBlock);

    for (const m of [a, b]) {
      const fired = await s.scheduler.write.fire([m.scheduleId, 0n], FIRE_GAS);
      await s.publicClient.waitForTransactionReceipt({ hash: fired });
    }

    const resolvedFirst = await s.predict.read.getMarket([first]);
    const resolvedSecond = await s.predict.read.getMarket([second]);

    assert.equal(OUTCOME[resolvedFirst.outcome], "YES"); // 4123 >= 4000
    assert.equal(OUTCOME[resolvedSecond.outcome], "NO"); // 4123 < 4000 is false
    assert.equal(resolvedFirst.observedValue, 4123n);
    assert.equal(resolvedSecond.observedValue, 4123n);

    // Newest first, and both are listed.
    const all = await s.predict.read.getMarkets();
    assert.equal(all.length, 2);
    assert.equal(all[0]?.id, 2n);
    assert.equal(all[1]?.id, 1n);

    await s.connection.close();
  });

  it("prepays its own execution fees into RitualWallet", async function () {
    const s = await deployStack();

    assert.equal(await s.predict.read.executionBalance(), parseEther("0.5"));
    assert.equal(
      await s.ritualWallet.read.balanceOf([s.predict.address]),
      parseEther("0.5"),
      "the contract, not the market creator, is the payer of every scheduled run",
    );

    await s.predict.write.fundExecution([500_000n], { value: parseEther("0.25") });
    assert.equal(await s.predict.read.executionBalance(), parseEther("0.75"));

    await s.connection.close();
  });
});
