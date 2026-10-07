import Link from 'next/link';
import { ArrowLeft, Grid2X2 } from 'lucide-react';
// 웹 배포에서는 지도 화면이 첫 화면이므로 ← 버튼이 Mini App 홈 대신 PLK 메인 사이트로 간다.
// 테스트 배포(GitHub Pages)처럼 사이트 주소와 돌아갈 주소가 다르면 NEXT_PUBLIC_BACK_URL로 지정한다.
const siteUrl = process.env.NEXT_PUBLIC_WEB_ENTRY === 'map' ? process.env.NEXT_PUBLIC_BACK_URL || process.env.NEXT_PUBLIC_SITE_URL : undefined;
export default function AppHeader({ map = false }: { map?: boolean }) {
  const content = <>{map ? <ArrowLeft size={22}/> : <span className="brand-symbol">p.</span>}<span>PLK <b>mini</b></span></>;
  return <header className="app-header">{map && siteUrl ? <a href={siteUrl} aria-label="PLK 홈페이지로" className="brand">{content}</a> : <Link href="/" aria-label={map ? 'Mini App 홈으로' : 'PLK Mini 홈'} className="brand">{content}</Link>}<span className="header-label">{map ? 'GOLF MAP' : 'YOUR GOLF, CONNECTED'}</span><Grid2X2 size={20} aria-hidden="true"/></header>;
}
