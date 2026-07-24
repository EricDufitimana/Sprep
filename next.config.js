/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Leave these to Node's own resolver instead of bundling them.
   *
   * @napi-rs/canvas loads a platform-specific `.node` binary, and pdfjs/
   * pdf-parse reach for files at runtime. Bundlers can't follow either, so
   * without this the PDF figure extractor dies with
   * "Cannot find module './skia.darwin-arm64.node'" even though the binary is
   * installed.
   */
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist', 'pdf-parse'],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
        port: '',
        pathname: '/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          }
        ]
      }
    ]
  },

  // Performance optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  productionBrowserSourceMaps: false,

  experimental: {
    serverActions: {
      bodySizeLimit: '50mb'
    },
    scrollRestoration: true,
  },

  compress: true,
  poweredByHeader: false,

  output: 'standalone',
}

module.exports = nextConfig
