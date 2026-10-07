import type { GolfCourse } from '../../lib/types';
import type { OverrideRow, PlkCourseRow } from './csv';
import type { KakaoPlace, MatchResult } from './match';

export type ReportStatus = 'confirmed' | 'override' | 'source_coords' | 'address_fallback' | 'excluded' | 'no_coords';
export interface MergeResult { course: GolfCourse | null; status: ReportStatus; place: KakaoPlace | null; note: string }

export function normalizeHomepage(value: string): string {
  if (!value) return '';
  const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try { const parsed = new URL(url); return parsed.hostname.includes('.') ? parsed.href : ''; } catch { return ''; }
}

// 우선순위: 보정 CSV > PLK 파일 > 카카오. PLK 값이 있으면 덮어쓰지 않고 빈 값만 채운다.
export function mergeCourse(row: PlkCourseRow, override: OverrideRow | undefined, match: MatchResult, places: KakaoPlace[], addressPoint: { lat: number; lng: number } | null): MergeResult {
  if (override?.exclude) return { course: null, status: 'excluded', place: null, note: '보정 CSV에서 제외' };
  const notes: string[] = [];
  let place: KakaoPlace | null = null;
  let status: ReportStatus = 'address_fallback';
  if (override?.kakaoPlaceId) {
    place = places.find((candidate) => candidate.id === override.kakaoPlaceId) ?? null;
    if (place) status = 'override';
    else notes.push(`보정 kakao_place_id ${override.kakaoPlaceId}를 검색 결과에서 찾지 못함`);
  } else if (match.status === 'confirmed' && match.best) {
    place = match.best.place;
    status = 'confirmed';
  }
  // 좌표 우선순위: 보정 CSV > 원본 위·경도 > 카카오 확정 장소 > 주소 지오코딩
  const sourcePoint = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
  let point = sourcePoint ?? (place ? { lat: Number(place.y), lng: Number(place.x) } : addressPoint);
  if (override?.lat != null && override.lng != null) { point = { lat: override.lat, lng: override.lng }; status = 'override'; }
  if (!point) return { course: null, status: 'no_coords', place, note: [...notes, '좌표를 찾지 못해 제외'].join(' / ') };
  if (status === 'address_fallback' && sourcePoint) status = 'source_coords';
  if (status === 'address_fallback') notes.push('장소 매칭 미확정: 주소 좌표 사용');
  if (status === 'source_coords') notes.push('카카오 장소 미확정: 원본 좌표 사용 (전화·카카오맵 링크 없음)');
  const homepage = normalizeHomepage(row.homepage);
  if (row.homepage && !homepage) notes.push(`홈페이지 형식 오류: ${row.homepage}`);
  const course: GolfCourse = {
    id: row.plkCode,
    name: row.name,
    address: row.address,
    lat: point.lat,
    lng: point.lng,
    holes: row.holes,
    phone: row.phone || place?.phone || '',
    homepage,
    plkPartner: row.partnerType !== null,
  };
  if (row.partnerType) course.partnerType = row.partnerType;
  if (row.partnerNote) course.partnerNote = row.partnerNote;
  if (place?.place_url) course.kakaoPlaceUrl = place.place_url.replace(/^http:/, 'https:');
  return { course, status, place, note: notes.join(' / ') };
}

export function validateCourses(courses: GolfCourse[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const course of courses) {
    const label = `${course.id} ${course.name}`;
    if (ids.has(course.id)) errors.push(`${label}: id 중복`);
    ids.add(course.id);
    if (!course.id || !course.name || !course.address) errors.push(`${label}: 필수값 누락`);
    if (!(course.lat >= 33 && course.lat <= 39 && course.lng >= 124 && course.lng <= 132)) errors.push(`${label}: 좌표가 대한민국 범위를 벗어남 (${course.lat}, ${course.lng})`);
    if (course.holes !== null && !(Number.isInteger(course.holes) && course.holes > 0)) errors.push(`${label}: 홀 수 오류`);
    if (course.homepage && !/^https?:\/\//.test(course.homepage)) errors.push(`${label}: 홈페이지는 http(s)만 허용`);
  }
  return errors;
}
