"use client";

import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { Button } from "@/components/ui";
import { ritualChain } from "@/config/wagmi";
import { ritual, shortAddress } from "@/lib/format";

export function WalletConnect() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({ address });

  if (!isConnected) {
    // Several connectors can report the same injected wallet; one button each is
    // still clearer than guessing which one the visitor meant.
    return (
      <div className="flex flex-wrap gap-2">
        {connectors.map((connector) => (
          <Button
            key={connector.uid}
            onClick={() => connect({ connector })}
            disabled={isPending}
          >
            {connector.name}
          </Button>
        ))}
      </div>
    );
  }

  if (chainId !== ritualChain.id) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-amber-400">Wrong network</span>
        <Button onClick={() => switchChain({ chainId: ritualChain.id })}>
          Switch to Ritual Chain
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <div className="tnum text-sm text-white">{address && shortAddress(address)}</div>
        <div className="tnum text-xs text-[var(--color-muted)]">
          {balance ? `${ritual(balance.value)} RITUAL` : "…"}
        </div>
      </div>
      <Button tone="ghost" onClick={() => disconnect()}>
        Disconnect
      </Button>
    </div>
  );
}
