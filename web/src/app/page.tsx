"use client";

import { CreateMarketForm } from "@/components/CreateMarketForm";
import { MarketCard } from "@/components/MarketCard";
import { OraclePanel } from "@/components/OraclePanel";
import { WalletConnect } from "@/components/WalletConnect";
import { Panel, Stat } from "@/components/ui";
import { explorerAddress, isConfigured, predictAddress } from "@/config/contract";
import { useExecutionBalance, useHead, useMarkets } from "@/hooks/usePredict";
import { ritual, shortAddress } from "@/lib/format";

export default function Home() {
  const head = useHead();
  const { markets, isLoading, error, refetch } = useMarkets();
  const executionBalance = useExecutionBalance();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Ritual Predict</h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--color-muted)]">
            A self-resolving binary prediction market. When the betting window closes,
            nobody presses a resolve button and no backend cron runs. The Ritual
            Scheduler wakes the contract at a block fixed when the market was created,
            it reads the oracle inside a TEE, and settles itself.
          </p>
        </div>
        <WalletConnect />
      </header>

      {!isConfigured ? (
        <Panel title="Not configured">
          <p className="text-sm text-[var(--color-muted)]">
            Set <code className="text-white">NEXT_PUBLIC_PREDICT_ADDRESS</code> in{" "}
            <code className="text-white">web/.env.local</code> to the address printed by{" "}
            <code className="text-white">hardhat/scripts/deploy.ts</code>, then reload.
          </p>
        </Panel>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-5 sm:grid-cols-4">
            <Stat
              label="Contract"
              value={
                <a
                  href={explorerAddress(predictAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {shortAddress(predictAddress)}
                </a>
              }
            />
            <Stat label="Head block" value={head?.toString() ?? "…"} />
            <Stat label="Markets" value={markets.length} />
            <Stat
              label="Prepaid fees"
              value={`${ritual(executionBalance)} RITUAL`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-6">
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-wide text-white uppercase">
                    Markets
                  </h2>
                  <button
                    onClick={() => void refetch()}
                    className="text-xs text-[var(--color-muted)] underline underline-offset-2"
                  >
                    Refresh
                  </button>
                </div>

                {isLoading && (
                  <p className="text-sm text-[var(--color-muted)]">Loading markets…</p>
                )}

                {error && (
                  <p className="text-sm text-red-400">
                    Could not read the contract. Check the address and the RPC URL.
                  </p>
                )}

                {!isLoading && !error && markets.length === 0 && (
                  <p className="text-sm text-[var(--color-muted)]">
                    No markets yet. Create the first one.
                  </p>
                )}

                {markets.map((market) => (
                  <MarketCard key={market.id.toString()} market={market} head={head} />
                ))}
              </section>
            </div>

            <div className="space-y-6">
              <OraclePanel />
              <CreateMarketForm onCreated={() => void refetch()} />
            </div>
          </div>
        </>
      )}

      <footer className="mt-12 border-t border-[var(--color-edge)] pt-6 text-xs text-[var(--color-muted)]">
        Every deadline here is a block number, not a timestamp. The Scheduler fires at a
        block, so betting closes at a block too. That way “betting is closed” and “the
        Scheduler woke us” can never disagree, whatever the chain’s block time does.
      </footer>
    </main>
  );
}
