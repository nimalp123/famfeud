import type { NextConfig } from "next";
import { validateRoomBaseUrl } from "./lib/room-url.ts";

validateRoomBaseUrl(process.env.NEXT_PUBLIC_ROOM_BASE_URL);

const nextConfig: NextConfig = {
  webpack(config) {
    // The existing Sites build resolves this module inside Cloudflare Workers.
    // Vercel uses InsForge and never executes the Cloudflare fallback.
    config.externals.push("cloudflare:workers");
    return config;
  },
};

export default nextConfig;
