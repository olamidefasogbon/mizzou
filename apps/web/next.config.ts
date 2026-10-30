import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Bundle the workspace package so Turbopack/webpack resolve
  // @mizzou/core and @mizzou/core/voice during `next build`.
  transpilePackages: ["@mizzou/core"],
  // Cache Components is off: every /app screen reads the per-browser anon
  // cookie, so static prerendering hits "uncached data during prerendering".
  // partialPrefetching requires Cache Components, so it goes off too.
  // Re-enable both with Suspense boundaries after the demo if static shells pay off.
  cacheComponents: false,
  partialPrefetching: false,
};

export default nextConfig;
