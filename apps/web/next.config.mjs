/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  transpilePackages: [
    '@messagetodo/design-system',
    '@messagetodo/db',
    '@messagetodo/logging',
    '@messagetodo/nagging',
    '@messagetodo/notifications',
    '@messagetodo/rate-limit',
    '@messagetodo/recurrence'
  ]
};
export default nextConfig;
