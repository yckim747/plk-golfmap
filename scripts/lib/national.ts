// 대한민국 전체 골프장 보완: 공공데이터(인허가)·카카오 전국 검색 결과를 기존 목록과 중복 없이 합친다.
import proj4 from 'proj4';
import { distanceKm, nameSimilarity, normalizeName, type KakaoPlace } from './match';

export type Point = { lat: number; lng: number };
export interface NationalCandidate {
  source: '공공데이터' | '카카오';
  key: string; // 공공데이터 관리번호 또는 카카오 장소 ID
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  businessStatus: string; // 공공데이터 영업상태(영업/휴업), 카카오는 ''
  placeUrl: string;
}

// 대한민국 범위: 이 사각형을 격자로 나눠 카카오 '골프장'을 전수 검색한다.
export const KOREA_BOUNDS: [number, number, number, number] = [124.5, 33.0, 131.0, 38.7];

// 카테고리가 정확히 '골프장'인 곳만(스크린골프장·골프연습장 제외), 이름으로 파크골프·연습장 등을 한 번 더 거른다.
const NOT_A_COURSE = /예정|공사중|폐업|파크\s*골프|그라운드\s*골프|미니\s*골프|연습장|스크린|실내|인도어|아카데미|레슨|골프존\s*파크|GDR|프렌즈\s*스크린|주차장|정류장|매표소|사무소|사무실/i;
export function isNationalCourse(place: KakaoPlace): boolean {
  return /(^|> )골프장( >|$)/.test(place.category_name) && !NOT_A_COURSE.test(place.place_name);
}

// 이름 비교 후보: 원래 이름, 괄호를 뺀 이름, 괄호 안 이름("H1(에이치원클럽)" → 에이치원클럽, "(구.웅포)" → 웅포)
export function nameVariants(name: string): string[] {
  const inner = [...name.matchAll(/[(（]([^)）]*)[)）]/g)].map((match) => match[1].replace(/^\s*구\s*[.,]?\s*/, '').trim()).filter(Boolean);
  return [...new Set([name, name.replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').trim(), ...inner])];
}
export function bestNameSimilarity(a: string, b: string): number {
  let best = 0;
  for (const left of nameVariants(a)) for (const right of nameVariants(b)) best = Math.max(best, nameSimilarity(left, right));
  return best;
}

// 같은 골프장 판정: 이름이 비슷하고(0.8) 3km 이내이거나, 0.7km 이내이면서 이름이 어느 정도(0.5) 비슷할 때.
export function isSameCourse(a: { name: string } & Point, b: { name: string } & Point): boolean {
  const km = distanceKm(a, b);
  const similarity = bestNameSimilarity(a.name, b.name);
  return (similarity >= 0.8 && km <= 3) || (similarity >= 0.5 && km <= 0.7);
}

// 이름에 골프장 단서가 없는 등록(예: "만진집단", "에이펙스솔루션")은 운영 법인명인 경우가 많다.
export const GOLF_HINT = /C\.?C|G\.?C|컨트리|칸트리|골프|클럽|club|country|golf|links|링스|링크스|체력단련장|par\s*3|파3|퍼블릭|public|카운티|리조트|resort/i;
const pointOf = (place: KakaoPlace): Point => ({ lat: Number(place.y), lng: Number(place.x) });

// 카카오에 한 골프장이 여러 장소로 등록된 경우("OO CC", "OO CC 동코스", "OO CC 클럽하우스", 운영 법인명)를 하나로 묶는다.
// - 300m 이내는 이름과 관계없이 같은 골프장
// - 1km 이내이면서 이름이 비슷하거나 한쪽 이름이 다른 쪽을 포함하면 같은 골프장
// - 골프장 단서가 없는 이름은 1.5km 안에 다른 골프장이 있으면 법인 등록으로 보고 뺀다
// 대표는 골프장 단서가 있는 이름 중 가장 짧은 것.
export type ClusteredPlace = KakaoPlace & { member_ids: string[] };
export function clusterPlaces(places: KakaoPlace[]): ClusteredPlace[] {
  const unique = [...new Map(places.map((place) => [place.id, place])).values()];
  const sorted = unique.sort((a, b) => Number(!GOLF_HINT.test(a.place_name)) - Number(!GOLF_HINT.test(b.place_name)) || a.place_name.length - b.place_name.length);
  const kept: ClusteredPlace[] = [];
  for (const place of sorted) {
    const point = pointOf(place);
    const name = normalizeName(place.place_name);
    const hinted = GOLF_HINT.test(place.place_name);
    const group = kept.find((other) => {
      const km = distanceKm(point, pointOf(other));
      const otherName = normalizeName(other.place_name);
      return km <= 0.3 || (!hinted && km <= 1.5) || (km <= 1 && (nameSimilarity(place.place_name, other.place_name) >= 0.5 || (!!otherName && name.includes(otherName))));
    });
    if (group) group.member_ids.push(place.id);
    else kept.push({ ...place, member_ids: [place.id] });
  }
  return kept;
}

// 기존 목록에 이미 있는 골프장인지: 카카오 장소 ID가 같거나, isSameCourse이거나, 300m 이내이거나,
// 이름이 거의 같고(0.9) 15km 이내(원본 좌표가 몇 km 어긋난 경우 대비).
// blocked: PLK 마스터에서 '공개 불가'·'휴장'으로 뺀 골프장. 같은 골프장이면 지도에 다시 넣지 않는다.
// 좌표가 없는 차단 골프장은 이름(0.9 이상)만으로 판정한다.
export interface ExistingCourse { id: string; name: string; lat: number | null; lng: number | null; placeIds: string[]; blocked?: boolean }
export function findExisting(candidate: { name: string; placeIds: string[] } & Point, existing: ExistingCourse[]): ExistingCourse | null {
  return existing.find((course) => candidate.placeIds.some((id) => course.placeIds.includes(id)))
    ?? existing.find((course) => {
      const similarity = bestNameSimilarity(candidate.name, course.name);
      if (course.lat == null || course.lng == null) return similarity >= 0.9;
      const point = { lat: course.lat, lng: course.lng };
      const km = distanceKm(candidate, point);
      return isSameCourse(candidate, { name: course.name, ...point }) || km <= 0.3 || (similarity >= 0.9 && km <= 15);
    })
    ?? null;
}

// 검토용: 3km 안에서 가장 가까운 기존 골프장(중복 의심 확인용)
export function nearestWithin(point: Point, existing: ExistingCourse[], km = 3): { course: ExistingCourse; km: number } | null {
  let best: { course: ExistingCourse; km: number } | null = null;
  for (const course of existing) {
    if (course.blocked || course.lat == null || course.lng == null) continue;
    const distance = distanceKm(point, { lat: course.lat, lng: course.lng });
    if (distance <= km && (!best || distance < best.km)) best = { course, km: distance };
  }
  return best;
}

// 공공데이터 좌표: 보정계수 없는 Bessel 중부원점TM(EPSG:5174) → WGS84
proj4.defs('EPSG:5174', '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43');
export function tmToWgs84(x: number, y: number): Point | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !x || !y) return null;
  const [lng, lat] = proj4('EPSG:5174', 'WGS84', [x, y]);
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132 ? { lat, lng } : null;
}

// 운영팀 마스터 형식(한글 컬럼)의 신규 행: 지정한 컬럼만 채우고 나머지는 빈칸.
export function toMasterRow(columns: string[], course: { name: string; address: string; lat: number; lng: number; homepage: string; holes: number | null }): Record<string, string | number> {
  const [sido = '', sigun = ''] = course.address.split(/\s+/);
  const values: Record<string, string | number> = {
    골프장명: course.name, 국가코드: 'KR', 국가명: '대한민국', 시도: sido, 시군: sigun, 도로명주소: course.address, 전체주소: course.address,
    위도: course.lat, 경도: course.lng, 홈페이지: course.homepage, 홀수: course.holes ?? 0, 제휴구분: '비제휴', 사용여부: 'N',
  };
  return Object.fromEntries(columns.map((column) => [column, values[column] ?? '']));
}
