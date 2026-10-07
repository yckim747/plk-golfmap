import type { NextConfig } from 'next';

// 정적 파일로 내보내 Apache 등 일반 웹서버 폴더에 그대로 업로드한다.
// BASE_PATH는 .env.production에서만 지정하므로 `npm run dev`는 루트(/)에서 동작한다.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: process.env.BASE_PATH || '',
};

export default nextConfig;
