"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount } from "wagmi";

import { Badge, Button, Input, Stat, TxStatus } from "@/components/ui";
import { explorerTx, predictAddress } from "@/config/contract";
import { useStakes, type Market } from "@/hooks/usePredict";
import { useWriteTx } from "@/hooks/useWriteTx";
import { predictAbi } from "@/lib/predict-abi";
import { COMPARATOR_SYMBOL, MARKET_STATE, OUTCOME } from "@/lib/presets";
import { payoutMultiple, percent, relativeToBlock, ritual } from "@/lib/format";

export function MarketCard({ market, head }: { market: Market; head: bigint | undefined }) {
  const { isConnected } = useAccount();
  const stakes = useStakes(market.id);
  const tx = useWriteTx();
  const [amount, setAmount] = useState("0.05");

  const state = MARKET_STATE[market.state] ?? "Open";
  const outcome = OUTCOME[market.outcome] ?? "Unresolved";
  const pool = market.totalYes + market.totalNo;
  const isOpen = state === "Open";
  const canBet = isConnected && isOpen;

  async function bet(isYes: boolean) {
    let value: bigint;
    try {
      value = parseEther(amount || "0");
    } catch {
      return;
    }
    if (value <= 0n) return;
    await tx.send({
      address: predictAddress as `0x${string}`,
      abi: predictAbi,
      functionName: "bet",
      args: [market.id, isYes],
      value,
    });
  }

  async function settleUp() {
    await tx.send({
      address: predictAddress as `0x${string}`,
      abi: predictAbi,
      functionName: state === "Invalid" ? "claimRefund" : "claimWinnings",
      args: [market.id],
    });
  }

  return (
    <article className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="tnum text-xs text-[var(--color-muted)]">#{market.id}</span>
            <Badge label={state} />
            {state === "Resolved" && <Badge label={outcome} />}
          </div>
          <h3 className="text-base font-medium text-white">{market.question}</h3>
          <p className="tnum mt-1 text-xs text-[var(--color-muted)]">
            Settles YES when {market.jsonPath} {COMPARATOR_SYMBOL[market.comparator]}{" "}
            {market.target.toString()}
          </p>
        </div>
      </header>

      {/* Pari-mutuel odds: the share of the pool each side currently holds. */}
      <div className="mb-4">
        <div className="mb-1 flex h-2 overflow-hidden rounded-full bg-black/50">
          <div
            className="bg-[var(--color-yes)]"
            style={{ width: `${pool === 0n ? 50 : percent(market.totalYes, pool)}%` }}
          />
          <div
            className="bg-[var(--color-no)]"
            style={{ width: `${pool === 0n ? 50 : percent(market.totalNo, pool)}%` }}
          />
        </div>
        <div className="tnum flex justify-between text-xs">
          <span className="text-[var(--color-yes)]">
            YES {ritual(market.totalYes)} · {payoutMultiple(market.totalYes, market.totalNo)}
          </span>
          <span className="text-[var(--color-no)]">
            {payoutMultiple(market.totalNo, market.totalYes)} · NO {ritual(market.totalNo)}
          </span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pool" value={`${ritual(pool)} RITUAL`} />
        <Stat
          label="Betting closes"
          value={
            isOpen ? relativeToBlock(market.closeBlock, head) : `block ${market.closeBlock}`
          }
        />
        <Stat
          label="Resolves"
          value={
            state === "Resolved" || state === "Invalid"
              ? `block ${market.resolveBlock}`
              : relativeToBlock(market.resolveBlock, head)
          }
        />
        <Stat
          label="Attempts"
          value={`${market.attempts} / 3`}
        />
      </div>

      {state === "Resolved" && (
        <p className="tnum mb-4 rounded-lg border border-[var(--color-edge)] bg-black/30 px-3 py-2 text-xs text-[var(--color-muted)]">
          The enclave read <span className="text-white">{market.observedValue.toString()}</span>{" "}
          and settled <span className="text-white">{outcome}</span>. Nobody pressed a button.
        </p>
      )}

      {state === "Invalid" && (
        <p className="mb-4 rounded-lg border border-[var(--color-edge)] bg-black/30 px-3 py-2 text-xs text-[var(--color-muted)]">
          Invalid: {market.invalidReason || "unknown"}. Every stake is refundable, because a read
          that fails is never treated as NO.
        </p>
      )}

      {stakes.hasPosition && (
        <div className="tnum mb-4 flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
          <span>
            Your position: <span className="text-[var(--color-yes)]">{ritual(stakes.yes)} YES</span>{" "}
            · <span className="text-[var(--color-no)]">{ritual(stakes.no)} NO</span>
          </span>
          {stakes.settled ? (
            <span className="text-emerald-400">Already withdrawn</span>
          ) : (
            stakes.claimable > 0n && (
              <span className="text-white">Claimable: {ritual(stakes.claimable)} RITUAL</span>
            )
          )}
        </div>
      )}

      {canBet && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button tone="yes" onClick={() => bet(true)} disabled={tx.isBusy}>
            Back YES
          </Button>
          <Button tone="no" onClick={() => bet(false)} disabled={tx.isBusy}>
            Back NO
          </Button>
        </div>
      )}

      {!canBet && stakes.claimable > 0n && !stakes.settled && (
        <Button onClick={settleUp} disabled={tx.isBusy}>
          {state === "Invalid"
            ? `Refund ${ritual(stakes.claimable)} RITUAL`
            : `Claim ${ritual(stakes.claimable)} RITUAL`}
        </Button>
      )}

      <TxStatus {...tx} explorer={explorerTx} />
    </article>
  );
}
