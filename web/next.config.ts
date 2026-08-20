import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo oracle is read by a TEE executor over the public internet, so the
  // response must never be cached anywhere between here and the enclave.
  async headers() {
    return [
      {
        source: "/api/oracle/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
