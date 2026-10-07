import Link from 'next/link';
import { ArrowLeft, Grid2X2 } from 'lucide-react';
// 웹 배포에서는 지도 화면이 첫 화면이므로 ← 버튼이 Mini App 홈 대신 PLK 메인 사이트로 간다.
// 테스트 배포(GitHub Pages)처럼 사이트 주소와 돌아갈 주소가 다르면 NEXT_PUBLIC_BACK_URL로 지정한다.
const siteUrl = process.env.NEXT_PUBLIC_WEB_ENTRY === 'map' ? process.env.NEXT_PUBLIC_BACK_URL || process.env.NEXT_PUBLIC_SITE_URL : undefined;
const Logo = () => <span className="logo-mark" aria-hidden="true">P</span>;
export default function AppHeader({ map = false, children }: { map?: boolean; children?: React.ReactNode }) {
  if (!map) return <header className="app-header"><Link href="/" aria-label="PLK Mini 홈" className="brand"><Logo/><span>PLK <b>mini</b></span></Link><span className="header-label">YOUR GOLF, CONNECTED</span><Grid2X2 size={20} aria-hidden="true"/></header>;
  const back = <><ArrowLeft size={18}/></>;
  return <header className="topbar">
    {siteUrl ? <a href={siteUrl} aria-label="PLK 홈페이지로" className="icon-button">{back}</a> : <Link href="/" aria-label="Mini App 홈으로" className="icon-button">{back}</Link>}
    <span className="brand"><Logo/><span>PLK <b>Golf Map</b></span></span>
    <div className="topbar-end">{children}</div>
  </header>;
}
