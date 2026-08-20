"use client";

import { useCallback, useState } from "react";
import { BaseError } from "viem";
import { useWriteContract } from "wagmi";
import { useWaitForTransactionReceipt } from "wagmi";

/** A contract write, described structurally so payable calls keep their `value`. */
export type WriteRequest = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

/**
 * One transaction's lifecycle, flattened into something a button can render.
 *
 * wagmi already exposes the pieces; this keeps every call site from re-deriving
 * "pending vs mining vs done" and from printing a wall of RPC error text at the user.
 */
export function useWriteTx() {
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | undefined>();

  const { writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash });

  const send = useCallback(
    async (request: WriteRequest) => {
      setError(undefined);
      setHash(undefined);
      try {
        // `Parameters<>` of a generic function instantiates it with its defaults,
        // which collapses payability and pins `value` to `undefined`. `bet` is
        // payable, so the request is described structurally above and narrowed here
        // rather than casting at every call site.
        const sent = await writeContractAsync(
          request as unknown as Parameters<typeof writeContractAsync>[0],
        );
        setHash(sent);
        return sent;
      } catch (caught) {
        // BaseError.shortMessage is the one line worth showing; the rest is a stack
        // trace of the RPC call, which helps nobody standing at a demo.
        setError(
          caught instanceof BaseError
            ? (caught.shortMessage ?? caught.message)
            : caught instanceof Error
              ? caught.message
              : "Transaction failed",
        );
        return undefined;
      }
    },
    [writeContractAsync],
  );

  const reset = useCallback(() => {
    setHash(undefined);
    setError(undefined);
  }, []);

  return {
    send,
    reset,
    hash,
    error,
    isPending,
    isMining,
    isSuccess,
    isBusy: isPending || isMining,
  };
}
