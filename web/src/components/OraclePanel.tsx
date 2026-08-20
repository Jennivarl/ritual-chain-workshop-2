"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button, Input, Panel } from "@/components/ui";

type OracleReading = { price: number; source: string; updatedAt?: string };

async function readOracle(): Promise<OracleReading> {
  const response = await fetch("/api/oracle/eth", { cache: "no-store" });
  if (!response.ok) throw new Error(`oracle returned ${response.status}`);
  return (await response.json()) as OracleReading;
}

/**
 * The bundled demo oracle, and a way to steer it.
 *
 * This exists so a market can be demonstrated settling both ways without waiting for
 * a real price to move. It reads and writes the same route a TEE executor fetches, so
 * what you see here is exactly what the enclave will see.
 */
export function OraclePanel() {
  const [draft, setDraft] = useState("");

  const reading = useQuery({
    queryKey: ["demo-oracle"],
    queryFn: readOracle,
    refetchInterval: 5_000,
  });

  const update = useMutation({
    mutationFn: async (method: "POST" | "DELETE") => {
      await fetch("/api/oracle/eth", {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ price: Number(draft) }) : undefined,
      });
    },
    onSuccess: () => reading.refetch(),
  });

  return (
    <Panel
      title="Demo oracle"
      subtitle="The endpoint your markets read. Whatever it reports here is what the enclave will observe."
    >
      <div className="mb-4 flex items-baseline gap-3">
        <span className="tnum text-3xl font-semibold text-white">
          {reading.data ? reading.data.price.toLocaleString() : "…"}
        </span>
        {reading.data && (
          <span className="text-xs text-[var(--color-muted)]">
            {reading.data.source === "override" ? "overridden" : "default"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <Input
            type="number"
            placeholder="4123"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button
          onClick={() => update.mutate("POST")}
          disabled={update.isPending || draft.trim() === ""}
        >
          Set price
        </Button>
        <Button
          tone="ghost"
          onClick={() => update.mutate("DELETE")}
          disabled={update.isPending}
        >
          Reset
        </Button>
      </div>

      {reading.error && (
        <p className="mt-2 text-xs text-red-400">
          {reading.error instanceof Error
            ? reading.error.message
            : "could not reach the oracle"}
        </p>
      )}

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        The contract reads this as a uint256 through the jq precompile, so decimals are
        dropped. Remember that the executor fetches it from the public internet, and a
        localhost URL is unreachable from inside the enclave.
      </p>
    </Panel>
  );
}
