import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it external so Next doesn't try to bundle it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
