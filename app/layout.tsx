import type { Metadata, Viewport } from 'next';
import './globals.css';
const title = 'PLK 골프장 지도';
const description = '전국 골프장과 PLK 제휴 골프장을 지도에서 찾아보세요.';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const metadata: Metadata = {
  title,
  description,
  // 게시판·카카오톡에 링크를 붙였을 때 보이는 미리보기 카드 (이미지는 app/opengraph-image.png, 경로에 basePath가 자동으로 붙음)
  ...(siteUrl && { metadataBase: new URL(siteUrl) }),
  openGraph: { title, description, type: 'website', locale: 'ko_KR', siteName: 'PLK', url: `${basePath}/` },
  twitter: { card: 'summary_large_image', title, description },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#ffffff' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><head><link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin=""/><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"/></head><body>{children}</body></html>;
}
