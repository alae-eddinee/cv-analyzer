import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Load pdf-parse as a native Node module (avoids Turbopack bundling issues)
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
