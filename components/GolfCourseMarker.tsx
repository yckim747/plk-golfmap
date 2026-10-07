import type { GolfCourse } from '@/lib/types';
export type MarkerKind = 'partner' | 'agreement' | 'regular' | 'pending';
export const MARKER_COLORS: Record<MarkerKind, string> = { partner: '#10b26c', agreement: '#5b5bf6', regular: '#ffffff', pending: '#d5d9e0' };
export function markerKind(course: GolfCourse): MarkerKind {
  if (course.status === '협의중') return 'pending';
  if (!course.plkPartner) return 'regular';
  return course.partnerType === '이용협약' ? 'agreement' : 'partner';
}
// SVG 핀은 Kakao MarkerClusterer와 함께 쓸 수 있다. 모든 핀에 골프 깃발을 넣고 구분은 색으로만 한다
// (제휴 그린 · 이용협약 인디고 · 일반 흰색 · 협의중 반투명 회색). 'P'는 퍼블릭으로 오해될 수 있어 쓰지 않는다.
const FLAG_INK: Record<MarkerKind, string> = { partner: '#ffffff', agreement: '#ffffff', regular: '#0b1220', pending: '#8a94a6' };
export function markerImageUrl(kind: MarkerKind) {
  const fill = MARKER_COLORS[kind];
  const stroke = kind === 'regular' ? '#9aa3b2' : '#ffffff';
  const ink = FLAG_INK[kind];
  // 깃대 + 삼각 깃발 + 홀컵(작은 타원)
  const flag = `<g transform="translate(0.4 3.6)"><path d="M15.5 8.5v15" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M16.2 8.6l7.3 3.1-7.3 3.1z" fill="${ink}"/><ellipse cx="15.5" cy="23.6" rx="3.4" ry="1.1" fill="${ink}" opacity=".55"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><defs><filter id="s" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#0b1220" flood-opacity=".28"/></filter></defs><g opacity="${kind === 'pending' ? 0.7 : 1}"><path filter="url(#s)" d="M18 41c-1-2.6-3.4-5.4-6.4-8.1A14 14 0 1 1 24.4 32.9C21.4 35.6 19 38.4 18 41Z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${flag}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
