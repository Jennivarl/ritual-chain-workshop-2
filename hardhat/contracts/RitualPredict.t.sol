// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {RitualPredict} from "./RitualPredict.sol";
import {RitualChain} from "./ritual/RitualChain.sol";
import {
    MockScheduler,
    MockRitualWallet,
    MockTEERegistry,
    MockHttpPrecompile,
    MockJqPrecompile
} from "./mocks/RitualMocks.sol";

/**
 * Unit tests for RitualPredict.
 *
 * The Ritual system contracts and precompiles are etched onto their canonical
 * addresses, so the contract under test calls exactly the addresses it would on chain
 * and never learns it is in a test. No network access and no funded account needed.
 */
contract RitualPredictTest is Test {
    uint256 constant BLOCK_TIME_MS = 195;

    /// {"price":4123}, the demo oracle's shape.
    bytes constant BODY_4123 = bytes('{"price":4123}');
    bytes constant BODY_3999 = bytes('{"price":3999}');

    RitualPredict predict;

    MockScheduler scheduler;
    MockRitualWallet ritualWallet;
    MockTEERegistry registry;
    MockHttpPrecompile http;
    MockJqPrecompile jq;

    address executor = makeAddr("tee-executor");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        // Somewhere past genesis so blockhash(block.number - 1) is meaningful.
        vm.roll(1_000);

        vm.etch(RitualChain.SCHEDULER, address(new MockScheduler()).code);
        vm.etch(
            RitualChain.RITUAL_WALLET,
            address(new MockRitualWallet()).code
        );
        vm.etch(
            RitualChain.TEE_SERVICE_REGISTRY,
            address(new MockTEERegistry()).code
        );
        vm.etch(
            RitualChain.HTTP_PRECOMPILE,
            address(new MockHttpPrecompile()).code
        );
        vm.etch(RitualChain.JQ_PRECOMPILE, address(new MockJqPrecompile()).code);

        scheduler = MockScheduler(RitualChain.SCHEDULER);
        ritualWallet = MockRitualWallet(RitualChain.RITUAL_WALLET);
        registry = MockTEERegistry(RitualChain.TEE_SERVICE_REGISTRY);
        http = MockHttpPrecompile(RitualChain.HTTP_PRECOMPILE);
        jq = MockJqPrecompile(RitualChain.JQ_PRECOMPILE);

        address[] memory executors = new address[](1);
        executors[0] = executor;
        registry.setExecutors(executors);
        http.setResponse(200, BODY_4123, "");

        // Etched last is fine; the constructor only calls the Scheduler.
        predict = new RitualPredict(BLOCK_TIME_MS);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    function _params()
        internal
        pure
        returns (RitualPredict.NewMarket memory p)
    {
        p = RitualPredict.NewMarket({
            question: "Will ETH/USD be at least $4,000 when this market resolves?",
            oracleUrl: "https://oracle.example/api/oracle/eth",
            jsonPath: ".price",
            target: 4000,
            comparator: RitualPredict.Comparator.GTE,
            bettingSeconds: 180,
            resolveDelaySeconds: 60
        });
    }

    function _create() internal returns (uint256 id) {
        id = predict.createMarket(_params());
    }

    function _bet(address who, uint256 id, bool isYes, uint256 amount) internal {
        vm.prank(who);
        predict.bet{value: amount}(id, isYes);
    }

    /// Advance to the market's resolve block and run one scheduled attempt.
    function _resolveAt(uint256 id, uint256 executionIndex) internal {
        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.resolveBlock);
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(executionIndex, id);
    }

    function _rollPastClose(uint256 id) internal {
        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.closeBlock);
    }

    // ═════════════════════════ createMarket ════════════════════════════

    function test_CreateMarket_StoresTheRule() public {
        uint256 id = _create();
        RitualPredict.Market memory m = predict.getMarket(id);

        assertEq(m.id, 1);
        assertEq(m.creator, address(this));
        assertEq(m.oracleUrl, "https://oracle.example/api/oracle/eth");
        assertEq(m.jsonPath, ".price");
        assertEq(m.target, 4000);
        assertEq(uint8(m.comparator), uint8(RitualPredict.Comparator.GTE));
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Open));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Unresolved));
        assertEq(m.attempts, 0);
    }

    function test_CreateMarket_ConvertsSecondsToBlocks() public {
        uint256 id = _create();
        RitualPredict.Market memory m = predict.getMarket(id);

        // 180s / 195ms = 923 blocks, 60s / 195ms = 307 blocks.
        assertEq(m.closeBlock, uint64(block.number + 923));
        assertEq(m.resolveBlock, m.closeBlock + 307);
        assertGt(m.resolveBlock, m.closeBlock);
    }

    function test_CreateMarket_BooksAllThreeAttempts() public {
        uint256 id = _create();
        RitualPredict.Market memory m = predict.getMarket(id);
        MockScheduler.Call memory c = scheduler.getCall(m.scheduleId);

        assertEq(c.target, address(predict));
        assertEq(c.startBlock, uint32(m.resolveBlock));
        assertEq(c.numCalls, predict.MAX_ATTEMPTS());
        assertEq(c.frequency, predict.RETRY_INTERVAL_BLOCKS());
        assertEq(c.ttl, predict.SCHEDULER_TTL_BLOCKS());
        assertEq(c.gas, predict.RESOLVE_GAS_LIMIT());
        assertEq(c.value, 0);
        // The contract pays for its own resolution, not the market creator.
        assertEq(c.payer, address(predict));
    }

    function test_CreateMarket_StaysUnderSchedulerLifespan() public {
        _create();
        assertLe(
            uint256(predict.RETRY_INTERVAL_BLOCKS()) *
                uint256(predict.MAX_ATTEMPTS()),
            10_000
        );
    }

    function test_CreateMarket_CallbackCarriesPlaceholderIndex() public {
        uint256 id = _create();
        RitualPredict.Market memory m = predict.getMarket(id);
        bytes memory data = scheduler.getCall(m.scheduleId).data;

        assertEq(data.length, 4 + 32 + 32);

        bytes4 selector;
        uint256 placeholder;
        uint256 encodedId;
        assembly {
            selector := mload(add(data, 32))
            placeholder := mload(add(data, 36))
            encodedId := mload(add(data, 68))
        }
        assertEq(selector, RitualPredict.onScheduledResolve.selector);
        // Bytes 4-35 are overwritten by the Scheduler, so a zero belongs here.
        assertEq(placeholder, 0);
        assertEq(encodedId, id);
    }

    function test_CreateMarket_EnforcesMinimumFeeFloor() public {
        vm.fee(1); // basefee * 2 would be 2 wei
        uint256 id = _create();
        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(
            scheduler.getCall(m.scheduleId).maxFeePerGas,
            predict.MIN_MAX_FEE_PER_GAS()
        );
    }

    function test_CreateMarket_IncrementsIds() public {
        assertEq(_create(), 1);
        assertEq(_create(), 2);
        assertEq(predict.marketCount(), 2);
    }

    function test_CreateMarket_RevertsOnEmptyQuestion() public {
        RitualPredict.NewMarket memory p = _params();
        p.question = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnEmptyOracleUrl() public {
        RitualPredict.NewMarket memory p = _params();
        p.oracleUrl = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnEmptyJsonPath() public {
        RitualPredict.NewMarket memory p = _params();
        p.jsonPath = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnTooShortBetting() public {
        RitualPredict.NewMarket memory p = _params();
        p.bettingSeconds = predict.MIN_BETTING_SECONDS() - 1;
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnTooShortResolveDelay() public {
        RitualPredict.NewMarket memory p = _params();
        p.resolveDelaySeconds = predict.MIN_RESOLVE_DELAY_SECONDS() - 1;
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnTooLongMarket() public {
        RitualPredict.NewMarket memory p = _params();
        p.bettingSeconds = predict.MAX_MARKET_SECONDS();
        p.resolveDelaySeconds = 60;
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_BubblesSchedulerRejection() public {
        scheduler.setScheduleReverts(true);
        vm.expectRevert(bytes("scheduler: rejected"));
        predict.createMarket(_params());
    }

    function test_Constructor_RevertsOnZeroBlockTime() public {
        vm.expectRevert(RitualPredict.BadDuration.selector);
        new RitualPredict(0);
    }

    // ═══════════════════════════ betting ═══════════════════════════════

    function test_Bet_AccumulatesBothSides() public {
        uint256 id = _create();
        _bet(alice, id, true, 3 ether);
        _bet(bob, id, false, 1 ether);
        _bet(alice, id, true, 2 ether);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(m.totalYes, 5 ether);
        assertEq(m.totalNo, 1 ether);
        assertEq(predict.yesStake(id, alice), 5 ether);
        assertEq(predict.noStake(id, bob), 1 ether);
        assertEq(address(predict).balance, 6 ether);
    }

    function test_Bet_RevertsOnZeroStake() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(RitualPredict.ZeroStake.selector);
        predict.bet{value: 0}(id, true);
    }

    function test_Bet_RevertsAtCloseBlock() public {
        uint256 id = _create();
        _rollPastClose(id);
        vm.prank(alice);
        vm.expectRevert(RitualPredict.BettingClosed.selector);
        predict.bet{value: 1 ether}(id, true);
    }

    function test_Bet_RevertsOnUnknownMarket() public {
        vm.prank(alice);
        vm.expectRevert(RitualPredict.UnknownMarket.selector);
        predict.bet{value: 1 ether}(99, true);
    }

    function test_Bet_RevertsOnceResolved() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);

        vm.prank(bob);
        vm.expectRevert(RitualPredict.BettingClosed.selector);
        predict.bet{value: 1 ether}(id, false);
    }

    function test_GetMarket_ReportsClosedWithoutATransaction() public {
        uint256 id = _create();
        assertEq(
            uint8(predict.getMarket(id).state),
            uint8(RitualPredict.MarketState.Open)
        );
        _rollPastClose(id);
        // Nothing was mined to flip it; the view derives it from the block number.
        assertEq(
            uint8(predict.getMarket(id).state),
            uint8(RitualPredict.MarketState.Closed)
        );
    }

    function test_GetMarket_RevertsOnUnknownMarket() public {
        vm.expectRevert(RitualPredict.UnknownMarket.selector);
        predict.getMarket(1);
    }

    function test_GetMarkets_ReturnsNewestFirst() public {
        _create();
        _create();
        RitualPredict.Market[] memory all = predict.getMarkets();
        assertEq(all.length, 2);
        assertEq(all[0].id, 2);
        assertEq(all[1].id, 1);
    }

    // ═════════════════════ resolution: authorisation ═══════════════════

    function test_Resolve_RevertsForNonScheduler() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(RitualPredict.OnlyScheduler.selector);
        predict.onScheduledResolve(0, id);
    }

    function test_Resolve_UnknownMarketIsSilentNoop() public {
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(0, 42); // must not revert
    }

    function test_Resolve_IsIdempotentAfterSettlement() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);

        uint256 callsBefore = http.callCount();
        // A leftover execution from the booked batch lands late.
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(1, id);

        assertEq(http.callCount(), callsBefore, "must not re-read the oracle");
        assertEq(predict.getMarket(id).attempts, 1);
    }

    // ═══════════════════════ resolution: success ═══════════════════════

    function test_Resolve_YesWhenObservedMeetsTarget() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes));
        assertEq(m.observedValue, 4123);
        assertEq(m.attempts, 1);
    }

    function test_Resolve_NoWhenObservedMissesTarget() public {
        http.setResponse(200, BODY_3999, "");
        uint256 id = _create();
        _bet(alice, id, false, 1 ether);
        _resolveAt(id, 0);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.No));
        assertEq(m.observedValue, 3999);
    }

    function test_Resolve_HonoursEveryComparator() public {
        // observed 4123 against target 4000
        _assertComparator(RitualPredict.Comparator.GT, RitualPredict.Outcome.Yes);
        _assertComparator(RitualPredict.Comparator.GTE, RitualPredict.Outcome.Yes);
        _assertComparator(RitualPredict.Comparator.LT, RitualPredict.Outcome.No);
        _assertComparator(RitualPredict.Comparator.LTE, RitualPredict.Outcome.No);
    }

    function _assertComparator(
        RitualPredict.Comparator comparator,
        RitualPredict.Outcome expected
    ) private {
        RitualPredict.NewMarket memory p = _params();
        p.comparator = comparator;
        uint256 id = predict.createMarket(p);
        // Back both sides so the market can actually settle either way.
        _bet(alice, id, true, 1 ether);
        _bet(bob, id, false, 1 ether);
        _resolveAt(id, 0);
        assertEq(uint8(predict.getMarket(id).outcome), uint8(expected));
    }

    function test_Resolve_BuildsTheHttpRequestCorrectly() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);

        MockHttpPrecompile.HttpRequest memory r = http.decodeLastRequest();
        assertEq(r.executor, executor);
        assertEq(r.url, "https://oracle.example/api/oracle/eth");
        assertEq(r.method, RitualChain.HTTP_GET);
        assertEq(r.ttl, predict.HTTP_TTL_BLOCKS());
        assertEq(r.body.length, 0, "GET carries no body");
        assertEq(r.encryptedSecrets.length, 0);
        assertEq(r.secretSignatures.length, 0);
        assertEq(r.headerKeys.length, 0);
        assertEq(r.headerValues.length, 0);
        assertEq(r.userPublicKey.length, 0);
        assertEq(r.dkmsKeyIndex, 0);
        assertEq(r.piiEnabled, false);
    }

    function test_Resolve_CancelsTheRemainingAttempts() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        uint256 scheduleId = predict.getMarket(id).scheduleId;

        _resolveAt(id, 0);

        assertEq(scheduler.cancelCount(), 1);
        assertEq(scheduler.lastCancelledId(), scheduleId);
        assertEq(scheduler.getCallState(scheduleId), 3); // CANCELLED
    }

    function test_Resolve_RunsThroughTheSchedulerCalldataPath() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.resolveBlock);

        // Not a prank: the mock replays the real calldata, executionIndex injection
        // and all, from the canonical Scheduler address.
        (bool ok, ) = scheduler.fire(m.scheduleId, 0);
        assertTrue(ok);
        assertEq(
            uint8(predict.getMarket(id).state),
            uint8(RitualPredict.MarketState.Resolved)
        );
    }

    // ═══════════════════ resolution: failure is never NO ═══════════════

    function _expectAttemptFailed(uint256 id) private {
        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolving));
        assertEq(
            uint8(m.outcome),
            uint8(RitualPredict.Outcome.Unresolved),
            "a failed read must never settle as NO"
        );
        assertEq(m.attempts, 1);
    }

    function test_Resolve_FailsWhenNoExecutorIsRegistered() public {
        registry.setExecutors(new address[](0));
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsWhenRegistryReverts() public {
        registry.setRegistryReverts(true);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsWhenHttpPrecompileReverts() public {
        http.setMode(MockHttpPrecompile.Mode.Revert);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsOnUndecodableEnvelope() public {
        http.setMode(MockHttpPrecompile.Mode.Garbage);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsWhenAsyncOutputHasNotSettled() public {
        http.setMode(MockHttpPrecompile.Mode.Unsettled);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsOnNon200() public {
        http.setResponse(503, BODY_4123, "");
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsOnExecutorErrorMessage() public {
        http.setResponse(200, BODY_4123, "dns lookup failed");
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsOnEmptyBody() public {
        http.setResponse(200, bytes(""), "");
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsOnMalformedJson() public {
        http.setResponse(200, bytes("not json at all"), "");
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_FailsWhenJqReturnsWrongOutputType() public {
        // A wrong outputType returns ok = true with a zero-length result, so the
        // length check in _jqUint is the only thing standing between that and a 0.
        jq.setReturnEmpty(true);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        _expectAttemptFailed(id);
    }

    function test_Resolve_ThirdFailureInvalidatesTheMarket() public {
        http.setMode(MockHttpPrecompile.Mode.Revert);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);

        _resolveAt(id, 0);
        assertEq(
            uint8(predict.getMarket(id).state),
            uint8(RitualPredict.MarketState.Resolving)
        );

        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(1, id);
        assertEq(
            uint8(predict.getMarket(id).state),
            uint8(RitualPredict.MarketState.Resolving)
        );

        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(2, id);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));
        assertEq(m.attempts, predict.MAX_ATTEMPTS());
        assertEq(m.invalidReason, "http precompile reverted");
    }

    function test_Resolve_RecoversOnASecondAttempt() public {
        http.setMode(MockHttpPrecompile.Mode.Revert);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);

        // The executor comes back before the booked retries run out.
        http.setResponse(200, BODY_4123, "");
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(1, id);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));
        assertEq(m.attempts, 2);
    }

    function test_Resolve_EmptyWinningSideInvalidates() public {
        // Observed 4123 >= 4000 settles YES, but everyone backed NO.
        uint256 id = _create();
        _bet(alice, id, false, 1 ether);
        _bet(bob, id, false, 2 ether);
        _resolveAt(id, 0);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));
        // The outcome is still recorded, it just cannot be paid out.
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes));
        assertEq(m.observedValue, 4123);
        assertEq(m.invalidReason, "no winning stake");
    }

    // ═══════════════════════════ payouts ═══════════════════════════════

    function test_Claim_PaysProportionalShareOfWholePool() public {
        uint256 id = _create();
        _bet(alice, id, true, 3 ether);
        _bet(bob, id, true, 1 ether);
        _bet(carol, id, false, 4 ether);
        _resolveAt(id, 0);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        predict.claimWinnings(id);
        // 3/4 of the winning pool, whole pool is 8 → 6 ether.
        assertEq(alice.balance - aliceBefore, 6 ether);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        predict.claimWinnings(id);
        assertEq(bob.balance - bobBefore, 2 ether);

        assertEq(address(predict).balance, 0);
    }

    function test_Claim_LoserGetsNothing() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _bet(bob, id, false, 1 ether);
        _resolveAt(id, 0);

        vm.prank(bob);
        vm.expectRevert(RitualPredict.NothingToClaim.selector);
        predict.claimWinnings(id);
    }

    function test_Claim_RevertsBeforeResolution() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        vm.prank(alice);
        vm.expectRevert(RitualPredict.NotResolved.selector);
        predict.claimWinnings(id);
    }

    function test_Claim_CannotBeClaimedTwice() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);

        vm.prank(alice);
        predict.claimWinnings(id);
        vm.prank(alice);
        vm.expectRevert(RitualPredict.AlreadySettled.selector);
        predict.claimWinnings(id);
    }

    function test_Refund_ReturnsStakeOnInvalidMarket() public {
        http.setMode(MockHttpPrecompile.Mode.Revert);
        uint256 id = _create();
        _bet(alice, id, true, 2 ether);
        _bet(bob, id, false, 1 ether);

        _resolveAt(id, 0);
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(1, id);
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(2, id);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        predict.claimRefund(id);
        assertEq(alice.balance - aliceBefore, 2 ether);

        vm.prank(bob);
        predict.claimRefund(id);
        assertEq(address(predict).balance, 0);
    }

    function test_Refund_RevertsOnResolvedMarket() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);

        vm.prank(alice);
        vm.expectRevert(RitualPredict.NotInvalid.selector);
        predict.claimRefund(id);
    }

    function test_Refund_RevertsForANonParticipant() public {
        http.setMode(MockHttpPrecompile.Mode.Revert);
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _resolveAt(id, 0);
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(1, id);
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(2, id);

        vm.prank(carol);
        vm.expectRevert(RitualPredict.NothingToClaim.selector);
        predict.claimRefund(id);
    }

    function test_StakesOf_ReportsClaimableBeforeAndAfter() public {
        uint256 id = _create();
        _bet(alice, id, true, 3 ether);
        _bet(carol, id, false, 1 ether);

        (uint256 yes, uint256 no, bool done, uint256 claimable) = predict
            .stakesOf(id, alice);
        assertEq(yes, 3 ether);
        assertEq(no, 0);
        assertFalse(done);
        assertEq(claimable, 0, "nothing is claimable while the market is open");

        _resolveAt(id, 0);
        (, , , claimable) = predict.stakesOf(id, alice);
        assertEq(claimable, 4 ether);

        vm.prank(alice);
        predict.claimWinnings(id);
        (, , done, claimable) = predict.stakesOf(id, alice);
        assertTrue(done);
        assertEq(claimable, 0);
    }

    // ══════════════════════ execution funding ══════════════════════════

    function test_FundExecution_DepositsIntoRitualWallet() public {
        vm.deal(address(this), 5 ether);
        predict.fundExecution{value: 2 ether}(500_000);

        assertEq(predict.executionBalance(), 2 ether);
        assertEq(ritualWallet.balanceOf(address(predict)), 2 ether);
        assertEq(
            ritualWallet.lockUntil(address(predict)),
            block.number + 500_000
        );
    }

    function test_FundExecution_RevertsOnZero() public {
        vm.expectRevert(RitualPredict.ZeroStake.selector);
        predict.fundExecution{value: 0}(500_000);
    }

    function test_Constructor_ApprovesTheScheduler() public view {
        assertEq(
            scheduler.approvedBy(address(predict)),
            RitualChain.SCHEDULER
        );
    }
}
