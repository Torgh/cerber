import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF rendering and image resizing use native modules; keep them out of the bundle.
  serverExternalPackages: ["sharp", "@napi-rs/canvas", "unpdf"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};

export default nextConfig;
