import type { GolfCourse } from '@/lib/types';
export type MarkerKind = 'partner' | 'agreement' | 'regular';
export const MARKER_COLORS: Record<MarkerKind, string> = { partner: '#10b26c', agreement: '#5b5bf6', regular: '#ffffff' };
export function markerKind(course: GolfCourse): MarkerKind {
  if (!course.plkPartner) return 'regular';
  return course.partnerType === '이용협약' ? 'agreement' : 'partner';
}
// SVG 핀은 Kakao MarkerClusterer와 함께 쓸 수 있다. 제휴(그린)·이용협약(인디고)은 P, 일반은 흰 핀에 점.
export function markerImageUrl(kind: MarkerKind) {
  const fill = MARKER_COLORS[kind];
  const stroke = kind === 'regular' ? '#9aa3b2' : '#ffffff';
  const mark = kind === 'regular' ? '<circle cx="18" cy="16" r="4" fill="#0b1220"/>' : '<text x="18" y="21" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="800" fill="#ffffff">P</text>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><defs><filter id="s" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#0b1220" flood-opacity=".28"/></filter></defs><path filter="url(#s)" d="M18 41c-1-2.6-3.4-5.4-6.4-8.1A14 14 0 1 1 24.4 32.9C21.4 35.6 19 38.4 18 41Z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${mark}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
