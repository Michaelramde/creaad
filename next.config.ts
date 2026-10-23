import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Les Server Actions ne sont pas utilisées pour l'upload : tout passe par R2 présigné.
    serverActions: { bodySizeLimit: "1mb" },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
