"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useBlockNumber, useReadContract } from "wagmi";

import { predictAddress, isConfigured } from "@/config/contract";
import { predictAbi } from "@/lib/predict-abi";

/** The shape RitualPredict.getMarket / getMarkets returns. */
export type Market = {
  id: bigint;
  creator: `0x${string}`;
  question: string;
  oracleUrl: string;
  jsonPath: string;
  target: bigint;
  comparator: number;
  closeBlock: bigint;
  resolveBlock: bigint;
  scheduleId: bigint;
  totalYes: bigint;
  totalNo: bigint;
  state: number;
  outcome: number;
  attempts: number;
  observedValue: bigint;
  invalidReason: string;
};

const contract = {
  address: predictAddress as `0x${string}`,
  abi: predictAbi,
} as const;

/**
 * The head block, polled.
 *
 * Every deadline in this app is a block number, so the head is the clock. At ~195ms
 * a block, watching every one would re-render several times a second for no gain, so
 * this polls on a human interval instead.
 */
export function useHead() {
  const { data } = useBlockNumber({ watch: false, query: { refetchInterval: 2_000 } });
  return data;
}

/**
 * Every market, newest first.
 *
 * Refetched whenever the head moves, because a market can change state with no
 * transaction from this user at all - that is the entire point of the contract.
 */
export function useMarkets() {
  const head = useHead();
  const queryClient = useQueryClient();

  const query = useReadContract({
    ...contract,
    functionName: "getMarkets",
    query: { enabled: isConfigured },
  });

  useEffect(() => {
    if (query.queryKey) queryClient.invalidateQueries({ queryKey: query.queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head]);

  return {
    markets: (query.data as readonly Market[] | undefined) ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/** This account's position in one market, plus what it can currently withdraw. */
export function useStakes(marketId: bigint | undefined) {
  const { address } = useAccount();
  const head = useHead();
  const queryClient = useQueryClient();

  const query = useReadContract({
    ...contract,
    functionName: "stakesOf",
    args: marketId !== undefined && address ? [marketId, address] : undefined,
    query: { enabled: isConfigured && marketId !== undefined && Boolean(address) },
  });

  useEffect(() => {
    if (query.queryKey) queryClient.invalidateQueries({ queryKey: query.queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head]);

  const data = query.data as readonly [bigint, bigint, boolean, bigint] | undefined;

  return {
    yes: data?.[0] ?? 0n,
    no: data?.[1] ?? 0n,
    settled: data?.[2] ?? false,
    claimable: data?.[3] ?? 0n,
    hasPosition: (data?.[0] ?? 0n) > 0n || (data?.[1] ?? 0n) > 0n,
  };
}

/** Prepaid balance that pays for every scheduled resolution. */
export function useExecutionBalance() {
  const head = useHead();
  const queryClient = useQueryClient();

  const query = useReadContract({
    ...contract,
    functionName: "executionBalance",
    query: { enabled: isConfigured },
  });

  useEffect(() => {
    if (query.queryKey) queryClient.invalidateQueries({ queryKey: query.queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head]);

  return (query.data as bigint | undefined) ?? 0n;
}
