/**
 * Enum mirrors and the preset workshop market.
 * Kept in step with hardhat/scripts/market-presets.ts.
 */

/** RitualPredict.Comparator */
export const COMPARATOR = {
  gt: 0,
  gte: 1,
  lt: 2,
  lte: 3,
} as const;

export type ComparatorKey = keyof typeof COMPARATOR;

export const COMPARATOR_LABEL: Record<ComparatorKey, string> = {
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
};

export const COMPARATOR_SYMBOL: Record<number, string> = {
  0: ">",
  1: ">=",
  2: "<",
  3: "<=",
};

/** RitualPredict.MarketState */
export const MARKET_STATE = ["Open", "Closed", "Resolving", "Resolved", "Invalid"] as const;
export type MarketStateName = (typeof MARKET_STATE)[number];

/** RitualPredict.Outcome */
export const OUTCOME = ["Unresolved", "YES", "NO"] as const;
export type OutcomeName = (typeof OUTCOME)[number];

/** Measured on Ritual Chain and fixed into the contract at deploy time. */
export const BLOCK_TIME_MS = 195;

/**
 * The preset workshop market: short enough to demo end-to-end in a few minutes.
 * Mirrors DEMO_MARKET in hardhat/scripts/market-presets.ts.
 */
export const DEMO_MARKET = {
  question: "Will ETH/USD be at least $4,000 when this market resolves?",
  jsonPath: ".price",
  target: 4000,
  comparator: "gte" as ComparatorKey,
  bettingSeconds: 180,
  resolveDelaySeconds: 60,
} as const;

/** Contract-side bounds, so the form can reject bad input before it costs gas. */
export const LIMITS = {
  minBettingSeconds: 30,
  minResolveDelaySeconds: 15,
  maxMarketSeconds: 86_400,
} as const;
