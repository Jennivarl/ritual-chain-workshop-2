/** Deployment-specific settings, all overridable from web/.env.local. */

export const predictAddress = (process.env.NEXT_PUBLIC_PREDICT_ADDRESS ?? "").trim() as
  | `0x${string}`
  | "";

export const ritualChainId = Number(process.env.NEXT_PUBLIC_RITUAL_CHAIN_ID ?? 1979);

export const ritualRpcUrl = (
  process.env.NEXT_PUBLIC_RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org"
).trim();

export const explorerUrl = "https://explorer.ritualfoundation.org";

/**
 * The oracle URL written into new markets. A TEE executor fetches this from the
 * public internet, so a localhost URL resolves to nothing and every market it
 * creates will fail all three attempts and go Invalid.
 */
export const demoOracleUrl = (process.env.NEXT_PUBLIC_DEMO_ORACLE_URL ?? "").trim();

export const isConfigured = predictAddress.startsWith("0x") && predictAddress.length === 42;

export function explorerAddress(address: string): string {
  return `${explorerUrl}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${explorerUrl}/tx/${hash}`;
}
