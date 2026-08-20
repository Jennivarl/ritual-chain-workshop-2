"use client";

import { useState } from "react";
import { useAccount } from "wagmi";

import { Button, Field, Input, Panel, Select, TxStatus } from "@/components/ui";
import { demoOracleUrl, explorerTx, predictAddress } from "@/config/contract";
import { useWriteTx } from "@/hooks/useWriteTx";
import { predictAbi } from "@/lib/predict-abi";
import {
  COMPARATOR,
  COMPARATOR_LABEL,
  DEMO_MARKET,
  LIMITS,
  type ComparatorKey,
} from "@/lib/presets";
import { blocksAsDuration } from "@/lib/format";
import { BLOCK_TIME_MS } from "@/lib/presets";

export function CreateMarketForm({ onCreated }: { onCreated?: () => void }) {
  const { isConnected } = useAccount();
  const tx = useWriteTx();

  const [question, setQuestion] = useState<string>(DEMO_MARKET.question);
  const [oracleUrl, setOracleUrl] = useState<string>(demoOracleUrl);
  const [jsonPath, setJsonPath] = useState<string>(DEMO_MARKET.jsonPath);
  const [target, setTarget] = useState<string>(String(DEMO_MARKET.target));
  const [comparator, setComparator] = useState<ComparatorKey>(DEMO_MARKET.comparator);
  const [bettingSeconds, setBettingSeconds] = useState<string>(
    String(DEMO_MARKET.bettingSeconds),
  );
  const [resolveDelaySeconds, setResolveDelaySeconds] = useState<string>(
    String(DEMO_MARKET.resolveDelaySeconds),
  );

  const betting = Number(bettingSeconds);
  const delay = Number(resolveDelaySeconds);

  // Mirror the contract's own guards, so a bad market is caught before it costs gas.
  const problems: string[] = [];
  if (!question.trim()) problems.push("A question is required.");
  if (!oracleUrl.trim()) problems.push("An oracle URL is required.");
  if (!jsonPath.trim()) problems.push("A jq path is required.");
  if (!Number.isFinite(betting) || betting < LIMITS.minBettingSeconds)
    problems.push(`Betting must run at least ${LIMITS.minBettingSeconds}s.`);
  if (!Number.isFinite(delay) || delay < LIMITS.minResolveDelaySeconds)
    problems.push(`The resolve delay must be at least ${LIMITS.minResolveDelaySeconds}s.`);
  if (betting + delay > LIMITS.maxMarketSeconds)
    problems.push("A market cannot span more than 24 hours.");
  if (/localhost|127\.0\.0\.1/i.test(oracleUrl))
    problems.push(
      "A TEE executor fetches this URL from the public internet, so localhost will never resolve. Expose it with a tunnel first.",
    );

  const closeBlocks = Math.max(1, Math.round((betting * 1000) / BLOCK_TIME_MS));
  const resolveBlocks = Math.max(1, Math.round((delay * 1000) / BLOCK_TIME_MS));

  async function submit() {
    const sent = await tx.send({
      address: predictAddress as `0x${string}`,
      abi: predictAbi,
      functionName: "createMarket",
      args: [
        {
          question: question.trim(),
          oracleUrl: oracleUrl.trim(),
          jsonPath: jsonPath.trim(),
          target: BigInt(Math.floor(Number(target) || 0)),
          comparator: COMPARATOR[comparator],
          bettingSeconds: BigInt(Math.floor(betting)),
          resolveDelaySeconds: BigInt(Math.floor(delay)),
        },
      ],
    });
    if (sent) onCreated?.();
  }

  return (
    <Panel
      title="Create a market"
      subtitle="The resolution rule is fixed at creation. There is no setter, and no one can change it later, not even you."
    >
      <div className="grid gap-4">
        <Field label="Question">
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Oracle URL"
            hint="Fetched inside the enclave over the public internet."
          >
            <Input
              value={oracleUrl}
              placeholder="https://your-tunnel.example/api/oracle/eth"
              onChange={(e) => setOracleUrl(e.target.value)}
            />
          </Field>
          <Field label="jq path" hint="One number, extracted as uint256.">
            <Input value={jsonPath} onChange={(e) => setJsonPath(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Settles YES when the value is">
            <Select
              value={comparator}
              onChange={(e) => setComparator(e.target.value as ComparatorKey)}
            >
              {(Object.keys(COMPARATOR) as ComparatorKey[]).map((key) => (
                <option key={key} value={key}>
                  {COMPARATOR_LABEL[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target">
            <Input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Betting window (s)" hint={`≈ ${closeBlocks} blocks`}>
            <Input
              type="number"
              value={bettingSeconds}
              onChange={(e) => setBettingSeconds(e.target.value)}
            />
          </Field>
          <Field label="Resolve delay (s)" hint={`≈ ${resolveBlocks} blocks after close`}>
            <Input
              type="number"
              value={resolveDelaySeconds}
              onChange={(e) => setResolveDelaySeconds(e.target.value)}
            />
          </Field>
        </div>

        <p className="text-xs text-[var(--color-muted)]">
          Betting closes about {blocksAsDuration(BigInt(closeBlocks))} from now, and the
          Scheduler wakes the contract {blocksAsDuration(BigInt(resolveBlocks))} after
          that. Three attempts are booked up front, 200 blocks apart.
        </p>

        {problems.length > 0 && (
          <ul className="space-y-1 text-xs text-amber-400">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        )}

        <div>
          <Button
            onClick={submit}
            disabled={!isConnected || problems.length > 0 || tx.isBusy}
          >
            {tx.isBusy ? "Creating…" : "Create market"}
          </Button>
          <TxStatus {...tx} explorer={explorerTx} />
        </div>
      </div>
    </Panel>
  );
}
