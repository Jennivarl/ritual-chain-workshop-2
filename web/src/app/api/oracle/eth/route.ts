/**
 * The demo oracle the markets read.
 *
 * This is the endpoint a TEE executor fetches from inside the enclave when the
 * Scheduler wakes RitualPredict, so two things matter:
 *
 *  - It must be reachable from the public internet. `localhost:3000` is not; expose
 *    it with a tunnel (`cloudflared tunnel --url http://localhost:3000`) and put the
 *    public URL in NEXT_PUBLIC_DEMO_ORACLE_URL.
 *  - The shape must stay flat and boring. The contract extracts exactly one number
 *    with the jq precompile at `.price`, as uint256 - so no decimals survive, and a
 *    nested or renamed field means the read fails and the market retries.
 *
 * POST { price } overrides the reported value, which is how you demo both outcomes
 * without waiting for a real market to move. The override lives in module scope, so
 * it resets whenever the dev server restarts.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_PRICE = Number(process.env.DEMO_ORACLE_PRICE ?? 4123);

let override: number | null = null;

export async function GET() {
  const price = override ?? DEFAULT_PRICE;

  return NextResponse.json(
    {
      price,
      source: override === null ? "default" : "override",
      updatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const raw = (body as { price?: unknown } | null)?.price;
  const price = typeof raw === "string" ? Number(raw) : raw;

  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return NextResponse.json(
      { error: "price must be a non-negative number" },
      { status: 400 },
    );
  }

  // The contract reads this as uint256, so anything after the decimal point would be
  // dropped on chain. Drop it here too, rather than showing a number the market can
  // never observe.
  override = Math.floor(price);

  return NextResponse.json({ price: override, source: "override" });
}

export async function DELETE() {
  override = null;
  return NextResponse.json({ price: DEFAULT_PRICE, source: "default" });
}
