import { formatEther } from "viem";

import { BLOCK_TIME_MS } from "@/lib/presets";

/** Native RITUAL, trimmed to something a human wants to read. */
export function ritual(amount: bigint, decimals = 4): string {
  const asNumber = Number(formatEther(amount));
  if (asNumber === 0) return "0";
  if (asNumber < 0.0001) return "<0.0001";
  return asNumber.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function percent(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 10_000n) / whole) / 100;
}

/**
 * Blocks remaining, rendered as time. The chain runs at ~195ms, so a few hundred
 * blocks is a couple of minutes - a block count alone means nothing to a reader.
 */
export function blocksAsDuration(blocks: bigint): string {
  if (blocks <= 0n) return "now";
  const totalSeconds = Math.round((Number(blocks) * BLOCK_TIME_MS) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** "in 2m 5s" / "12 blocks ago", from a target block and the current head. */
export function relativeToBlock(target: bigint, head: bigint | undefined): string {
  if (head === undefined) return `block ${target}`;
  if (target > head) return `in ${blocksAsDuration(target - head)}`;
  return `${blocksAsDuration(head - target)} ago`;
}

/** Pari-mutuel: what one unit of stake on this side pays if the side wins. */
export function payoutMultiple(sidePool: bigint, otherPool: bigint): string {
  if (sidePool === 0n) return "n/a";
  const total = sidePool + otherPool;
  return `${(Number(total) / Number(sidePool)).toFixed(2)}x`;
}
