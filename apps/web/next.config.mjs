import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@runner/core'],
  outputFileTracingRoot: root,
  experimental: {
    optimizePackageImports: ['three'],
  },
};

export default nextConfig;
