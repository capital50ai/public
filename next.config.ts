import type { NextConfig } from "next";

// The site UI is the owner-approved static design in public/*.html, served verbatim.
const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/index.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [
      { source: "/auth/:path*", destination: "/auth.html", permanent: false },
      { source: "/login", destination: "/auth.html", permanent: false },
      { source: "/signup", destination: "/auth.html", permanent: false },
      { source: "/portal/:path*", destination: "/dashboard.html", permanent: false },
      { source: "/dashboard", destination: "/dashboard.html", permanent: false },
    ];
  },
};

export default nextConfig;
