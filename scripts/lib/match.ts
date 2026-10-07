export interface KakaoPlace {
  id: string;
  place_name: string;
  category_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
}

export interface ScoredPlace { place: KakaoPlace; score: number }
export type MatchStatus = 'confirmed' | 'ambiguous' | 'unmatched';
export interface MatchResult { status: MatchStatus; best: ScoredPlace | null; candidates: ScoredPlace[] }

export const CONFIRM_SCORE = 0.75;
export const CANDIDATE_SCORE = 0.5;
export const CONFIRM_MARGIN = 0.1;

// 긴 표현부터 제거해야 "골프앤컨트리클럽"이 "컨트리클럽"보다 먼저 지워진다.
const NAME_NOISE = ['골프앤컨트리클럽', '골프앤드컨트리클럽', '컨트리클럽', '골프앤리조트', '골프리조트', '골프클럽', '골프장', '컨트리', 'country club', 'golf club', 'golf', 'resort', 'cc', 'gc', '골프', '리조트', '클럽'];

export function normalizeName(name: string): string {
  let value = name.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '');
  for (const noise of NAME_NOISE) value = value.replaceAll(noise, '');
  return value.replace(/[^0-9a-z가-힣]/g, '');
}

function bigrams(value: string): string[] {
  return value.length < 2 ? [value] : Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  const pool = bigrams(right);
  let overlap = 0;
  for (const gram of bigrams(left)) {
    const index = pool.indexOf(gram);
    if (index >= 0) { overlap += 1; pool.splice(index, 1); }
  }
  return (2 * overlap) / (bigrams(left).length + bigrams(right).length);
}

// "경기도 용인시 처인구 ..." → ["용인시", "처인구"]: 시·도 표기(경기도/경기)는 출처마다 달라 비교에서 뺀다.
export function districtTokens(address: string): string[] {
  return address.split(/\s+/).slice(1, 3).filter((token) => /(시|군|구)$/.test(token));
}

export function sameDistrict(plkAddress: string, placeAddress: string): boolean {
  const tokens = districtTokens(plkAddress);
  return tokens.length > 0 && tokens.every((token) => placeAddress.split(/\s+/).includes(token));
}

import { distanceKm } from '../../lib/geo';
export { distanceKm };

export function isGolfCourse(place: KakaoPlace): boolean {
  return place.category_name.includes('골프장');
}

// 이름 60% + 시·군·구 일치 25% + 주소 좌표와의 거리 15%. 주소 좌표가 없으면 거리 항목은 중간값으로 둔다.
export function scorePlace(course: { name: string; address: string }, place: KakaoPlace, addressPoint: { lat: number; lng: number } | null): number {
  const name = nameSimilarity(course.name, place.place_name);
  const district = sameDistrict(course.address, `${place.address_name} ${place.road_address_name}`) ? 1 : 0;
  let distance = 0.5;
  if (addressPoint) {
    const km = distanceKm(addressPoint, { lat: Number(place.y), lng: Number(place.x) });
    distance = km <= 2 ? 1 : Math.max(0, 1 - (km - 2) / 18);
  }
  return Math.round((0.6 * name + 0.25 * district + 0.15 * distance) * 1000) / 1000;
}

export function matchPlace(course: { name: string; address: string }, places: KakaoPlace[], addressPoint: { lat: number; lng: number } | null): MatchResult {
  const unique = [...new Map(places.filter(isGolfCourse).map((place) => [place.id, place])).values()];
  const candidates = unique.map((place) => ({ place, score: scorePlace(course, place, addressPoint) })).sort((a, b) => b.score - a.score).slice(0, 3);
  const [best, second] = candidates;
  if (!best || best.score < CANDIDATE_SCORE) return { status: 'unmatched', best: null, candidates };
  const clear = !second || best.score - second.score >= CONFIRM_MARGIN;
  return { status: best.score >= CONFIRM_SCORE && clear ? 'confirmed' : 'ambiguous', best, candidates };
}
