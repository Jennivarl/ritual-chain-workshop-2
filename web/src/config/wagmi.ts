import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected, metaMask, walletConnect } from "wagmi/connectors";

import { explorerUrl, ritualChainId, ritualRpcUrl } from "@/config/contract";

/**
 * Ritual Chain. Note the block time: ~195ms, which is why every deadline in this
 * app is a block number rather than a timestamp.
 */
export const ritualChain = defineChain({
  id: ritualChainId,
  name: "Ritual Chain",
  nativeCurrency: { name: "Ritual", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: { http: [ritualRpcUrl] },
  },
  blockExplorers: {
    default: { name: "Ritual Explorer", url: explorerUrl },
  },
});

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

// Injected and MetaMask are enough for a workshop. WalletConnect throws without a
// project id, so it is only added when one is configured.
const connectors = [
  injected({ shimDisconnect: true }),
  metaMask(),
  ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : []),
];

export const config = createConfig({
  chains: [ritualChain],
  connectors,
  ssr: true,
  transports: {
    [ritualChain.id]: http(ritualRpcUrl),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
