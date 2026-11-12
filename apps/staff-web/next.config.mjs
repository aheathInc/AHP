const buildDirectory = process.env.AHP_NEXT_DIST_DIR || '.next';
if (!/^\.next(?:-[a-z0-9-]+)?$/.test(buildDirectory)) {
  throw new Error('AHP_NEXT_DIST_DIR must be .next or .next-<suffix>.');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: buildDirectory,
  experimental: {
    webpackBuildWorker: false,
  },
};

export default nextConfig;
