import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Self-contained server output. `next build` writes a runnable
  // .next/standalone/server.js with a trimmed node_modules tree — exactly
  // what we ship inside the Electron app. The Electron main process
  // launches it as a child node process on a free port; in pure-Next dev
  // (`next dev`) this setting is a no-op.
  output: "standalone",
  // pdfjs-dist dynamically imports its worker via `import(this.workerSrc)`
  // with `webpackIgnore: true`. Next's standalone tracer can't see that,
  // so we tell it explicitly to include the worker file in the bundle.
  // Same for the codex platform binary, which lives in optionalDeps.
  outputFileTracingIncludes: {
    "**/*": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      "./node_modules/@openai/codex/bin/codex.js",
    ],
  },
  // Allow longer payloads for PDF uploads (default body limit is 1 MB).
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  // Pin pdfjs and the Codex SDK as external packages so their native /
  // platform-specific assets (pdfjs workers, codex binary in vendor/)
  // resolve from node_modules at runtime instead of being inlined by
  // webpack.
  serverExternalPackages: ["pdfjs-dist", "@openai/codex-sdk", "@openai/codex"],
};

export default nextConfig;
