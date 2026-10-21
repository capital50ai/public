import type { NextConfig } from "next";

// The UI is the owner-approved design in templates/*.html, served by app/p/[page]
// with returns filled in from the database.
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/p/[page]": ["./templates/**/*"],
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/p/index" },
        { source: "/index.html", destination: "/p/index" },
        { source: "/auth.html", destination: "/p/auth" },
        { source: "/dashboard.html", destination: "/p/dashboard" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [
      { source: "/auth/:path*", destination: "/auth.html", permanent: false },
      { source: "/login", destination: "/auth.html", permanent: false },
      { source: "/signup", destination: "/auth.html#signup", permanent: false },
      { source: "/portal/:path*", destination: "/dashboard.html", permanent: false },
      { source: "/dashboard", destination: "/dashboard.html", permanent: false },
    ];
  },
};

export default nextConfig;
