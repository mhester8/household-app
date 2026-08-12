import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to dev-only assets/endpoints (JS
  // chunks, RSC payloads, HMR) unless the requesting origin is allowlisted —
  // "localhost" is allowed by default, a LAN IP is not. Without this, loading
  // the dev server from a phone over Wi-Fi renders the initial HTML (so
  // "Checking session..." appears) but the client JS bundle never loads, so
  // the auth-check useEffect never runs and the page hangs there forever.
  // Update this if the machine's LAN IP changes.
  allowedDevOrigins: ["10.0.0.122"],
};

export default nextConfig;
