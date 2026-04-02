import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "prisma", "@prisma/client"],
};

export default nextConfig;
