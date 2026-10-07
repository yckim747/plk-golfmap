// PLK 골프장 CSV(기준) + 카카오 로컬 API(보강) → data/golf-courses.json
// 사용: npm run data:build [-- <CSV 경로>]
// 경로를 생략하면 data/source/에서 템플릿이 아닌 가장 최근 CSV(운영팀 골프장 마스터 원본 등)를 사용한다.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCsv, OPERATIONS_COLUMNS, parseCourseFile, parseOverrides, toCsv, type SkippedRow } from './lib/csv';
import { writeNationalWorkbook, type CourseMeta } from './lib/excel';
import { findExisting, nearestWithin, type ClusteredPlace, type ExistingCourse, type NationalCandidate } from './lib/national';
import { KakaoLocalClient } from './lib/kakao';
import { distanceKm, isGolfCourse, matchPlace, nameSimilarity, normalizeName, type KakaoPlace } from './lib/match';
import { mergeCourse, validateCourses } from './lib/merge';
import type { GolfCourse } from '../lib/types';

const root = process.cwd();
const sourceDir = path.join(root, 'data/source');
const overridesFile = path.join(sourceDir, 'overrides.csv');
const outputFile = path.join(root, 'data/golf-courses.json');
const reportFile = path.join(root, 'data/reports/match-report.csv');
const cacheFile = path.join(root, 'data/cache/kakao-local.json');

// 1km 안의 후보는 같은 골프장의 다른 등록명(예: "나인브릿지CC"·"클럽나인브릿지")으로 보고 경쟁 후보에서 뺀다.
function pickByName(name: string, places: KakaoPlace[]): KakaoPlace | null {
  const [best, ...rest] = places.filter(isGolfCourse).map((place) => ({ place, score: nameSimilarity(name, place.place_name) })).sort((a, b) => b.score - a.score);
  if (!best || best.score < 0.85) return null;
  const at = (place: KakaoPlace) => ({ lat: Number(place.y), lng: Number(place.x) });
  const rival = rest.find(({ place }) => distanceKm(at(best.place), at(place)) > 1);
  return !rival || best.score - rival.score >= 0.1 ? best.place : null;
}

function findInputFile(): string {
  if (process.argv[2]) return path.resolve(root, process.argv[2]);
  const candidates = existsSync(sourceDir) ? readdirSync(sourceDir)
    .filter((file) => file.toLowerCase().endsWith('.csv') && !file.includes('template') && file !== 'overrides.csv')
    .map((file) => path.join(sourceDir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : [];
  if (!candidates.length) throw new Error('data/source/에 골프장 CSV가 없습니다. 운영팀 골프장 마스터 CSV를 그대로 넣거나 템플릿(plk-golf-courses.template.csv) 형식으로 작성하세요.');
  return candidates[0];
}

async function main() {
  try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* 환경변수로 직접 줄 수도 있음 */ }
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error('.env.local에 KAKAO_REST_API_KEY(카카오 REST API 키)를 설정하세요.');
  const inputFile = findInputFile();
  if (!existsSync(inputFile)) throw new Error(`골프장 CSV가 없습니다: ${inputFile}`);

  const { format, rows, skipped } = parseCourseFile(decodeCsv(readFileSync(inputFile)));
  console.log(`입력: ${path.relative(root, inputFile)} (${format === 'operations' ? '운영팀 골프장 마스터' : '템플릿'} 형식, 대상 ${rows.length}곳, 제외 ${skipped.length}행)`);
  const overrides = existsSync(overridesFile) ? parseOverrides(decodeCsv(readFileSync(overridesFile))) : new Map();
  const kakao = new KakaoLocalClient(apiKey, cacheFile);
  const courses: GolfCourse[] = [];
  const report: Record<string, string | number>[] = skipped.map((row) => ({ plk_code: row.plkCode, name: row.name, address: row.address, status: 'skipped', note: row.reason }));
  const counts: Record<string, number> = {};
  const skippedCounts: Record<string, number> = {};

  try {
    for (const [index, sourceRow] of rows.entries()) {
      let row = sourceRow;
      const sourcePoint = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
      // 주소가 비어 있으면 이름으로 카카오 골프장을 찾아 그 주소를 쓴다(이름이 거의 같고 1위가 뚜렷할 때만).
      if (!row.address) {
        const found = pickByName(row.name, await kakao.searchPlaces(row.name, sourcePoint));
        if (!found) { report.push({ plk_code: row.plkCode, name: row.name, address: '', status: 'skipped', note: '주소 없음(카카오 미확인)' }); skippedCounts['주소 없음(카카오 미확인)'] = (skippedCounts['주소 없음(카카오 미확인)'] ?? 0) + 1; continue; }
        row = { ...row, address: found.road_address_name || found.address_name };
      }
      // 원본에 좌표가 있으면 지오코딩 호출을 생략하고 그 좌표를 장소 검색 기준점으로 쓴다.
      const addressPoint = sourcePoint ?? await kakao.geocode(row.address);
      let places = await kakao.searchPlaces(row.name, addressPoint);
      if (!places.some(isGolfCourse)) places = [...places, ...await kakao.searchPlaces(`${normalizeName(row.name)} 골프장`, addressPoint)];
      const match = matchPlace(row, places, addressPoint);
      const result = mergeCourse(row, overrides.get(row.plkCode), match, places, addressPoint);
      // 협의중 행은 원본 좌표나 카카오 확정 장소가 있을 때만 싣는다(사무실 주소 등 잘못된 행 방지).
      if (row.status && !sourcePoint && result.status !== 'confirmed' && result.status !== 'override') {
        report.push({ plk_code: row.plkCode, name: row.name, address: row.address, status: 'skipped', note: '협의중: 위치 확인 불가' });
        skippedCounts['협의중: 위치 확인 불가'] = (skippedCounts['협의중: 위치 확인 불가'] ?? 0) + 1;
        continue;
      }
      if (result.course) courses.push(result.course);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      const describe = (place: KakaoPlace) => `${place.id}:${place.place_name}:${place.address_name}`;
      report.push({
        plk_code: row.plkCode,
        name: row.name,
        address: row.address,
        status: result.status,
        match_status: match.status,
        score: match.best?.score ?? '',
        place_id: result.place?.id ?? '',
        place_name: result.place?.place_name ?? '',
        place_address: result.place?.address_name ?? '',
        candidates: match.candidates.map(({ place, score }) => `${describe(place)}(${score})`).join(' | '),
        note: result.note,
      });
      if ((index + 1) % 50 === 0) console.log(`  ${index + 1}/${rows.length} 처리`);
    }
  } finally {
    kakao.saveCache();
  }

  const meta = new Map<string, CourseMeta>(courses.map((course) => [course.id, { source: 'PLK 마스터', licenseNo: '', businessStatus: '', note: '' }]));
  // PLK 마스터에서 공개 불가·휴장으로 뺀 골프장은 전국 보완에서도 다시 넣지 않는다.
  const blocked = skipped.filter((row) => row.reason === '공개 불가' || row.reason === '휴장');
  const national = supplementNational(courses, overrides, report, meta, blocked);

  mkdirSync(path.dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, toCsv(report, ['plk_code', 'name', 'address', 'status', 'match_status', 'score', 'place_id', 'place_name', 'place_address', 'candidates', 'note']));
  const errors = validateCourses(courses);
  if (errors.length) throw new Error(`검증 실패로 ${path.relative(root, outputFile)}을 갱신하지 않았습니다:\n- ${errors.join('\n- ')}`);
  writeFileSync(outputFile, JSON.stringify(courses, null, 2) + '\n');
  const masterColumns = format === 'operations' ? decodeCsv(readFileSync(inputFile)).split(/\r?\n/, 1)[0].split(',').map((column) => column.trim()) : [...OPERATIONS_COLUMNS];
  const workbookFile = path.join(root, `data/reports/전국골프장_${new Date().toISOString().slice(2, 10).replaceAll('-', '')}.xlsx`);
  await writeNationalWorkbook(workbookFile, courses, meta, masterColumns, national);

  const reasons: Record<string, number> = { ...skippedCounts };
  for (const row of skipped) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  const partnerCount = (type: string) => courses.filter((course) => course.partnerType === type).length;
  console.log(`
완료: ${path.relative(root, outputFile)} (${courses.length}곳, 제휴 ${partnerCount('제휴')}곳, 이용협약 ${partnerCount('이용협약')}곳, 협의중 ${courses.filter((course) => course.status === '협의중').length}곳)
  카카오 장소 확정 ${counts.confirmed ?? 0} / 보정 적용 ${counts.override ?? 0} / 원본 좌표만 ${counts.source_coords ?? 0} / 주소 좌표 대체 ${counts.address_fallback ?? 0} / 좌표 없음·보정 제외 ${(counts.excluded ?? 0) + (counts.no_coords ?? 0)}
  원본에서 제외: ${Object.entries(reasons).map(([reason, count]) => `${reason} ${count}`).join(', ') || '없음'}
  카카오 API 호출 ${kakao.apiCalls}건 (나머지는 캐시)
  매칭 리포트: ${path.relative(root, reportFile)} — source_coords/address_fallback/no_coords 건은 data/source/overrides.csv로 보정할 수 있습니다.
  전국 보완: 공공데이터 신규 ${national.addedPublic}곳, 카카오 신규 ${national.addedKakao}곳 (후보 ${national.candidates}곳 중 기존과 같은 골프장 ${national.matched}곳, 공개 불가·휴장 차단 ${national.blocked}곳, 검토 필요 ${national.reviewNeeded}곳)
  엑셀: ${path.relative(root, workbookFile)}`);
}

// 전국 골프장 보완: 공공데이터(인허가) → 카카오 순으로, 지금 목록에 없는 골프장을 '협의중'으로 추가한다.
// data/source/public-golf.json, kakao-golf.json은 `npm run data:fetch`가 만든다(없으면 건너뜀).
function supplementNational(courses: GolfCourse[], overrides: Map<string, { exclude: boolean }>, report: Record<string, string | number>[], meta: Map<string, CourseMeta>, blocked: SkippedRow[]) {
  const load = <T,>(file: string, key: string): T[] => { const full = path.join(sourceDir, file); return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8'))[key] : []; };
  const publicItems = load<NationalCandidate>('public-golf.json', 'items');
  const kakaoPlaces = load<ClusteredPlace>('kakao-golf.json', 'places');
  const candidates: (NationalCandidate & { placeIds: string[] })[] = [
    ...publicItems.map((item) => ({ ...item, placeIds: [] })),
    ...kakaoPlaces.map((place) => ({ source: '카카오' as const, key: place.id, name: place.place_name, address: place.road_address_name || place.address_name, lat: Number(place.y), lng: Number(place.x), phone: place.phone, businessStatus: '', placeUrl: place.place_url.replace(/^http:/, 'https:'), placeIds: place.member_ids })),
  ];
  const placeIdOf = (url?: string) => url ? [url.split('/').pop()!] : [];
  const existing: ExistingCourse[] = [
    ...courses.map((course) => ({ id: course.id, name: course.name, lat: course.lat, lng: course.lng, placeIds: placeIdOf(course.kakaoPlaceUrl) })),
    ...blocked.map((row) => ({ id: `blocked:${row.name}`, name: row.name, lat: row.lat ?? null, lng: row.lng ?? null, placeIds: [], blocked: true })),
  ];
  const stats = { candidates: candidates.length, matched: 0, blocked: 0, addedPublic: 0, addedKakao: 0, reviewNeeded: 0, excludedByOverride: 0 };
  for (const candidate of candidates) {
    const hit = findExisting(candidate, existing);
    if (hit?.blocked) { stats.blocked += 1; report.push({ plk_code: `${candidate.source}:${candidate.key}`, name: candidate.name, address: candidate.address, status: 'skipped_national', note: `PLK 마스터 ${hit.name}(공개 불가·휴장)과 같은 골프장` }); continue; }
    if (hit) {
      stats.matched += 1;
      // 공공데이터로 추가된 골프장에 같은 골프장의 카카오 정보(전화·카카오맵 링크)를 채운다.
      const course = courses.find((item) => item.id === hit.id)!;
      if (candidate.source === '카카오' && meta.get(hit.id)?.source === '공공데이터') {
        if (!course.phone) course.phone = candidate.phone;
        if (!course.kakaoPlaceUrl && candidate.placeUrl) course.kakaoPlaceUrl = candidate.placeUrl;
        hit.placeIds.push(...candidate.placeIds);
      }
      continue;
    }
    const id = `${candidate.source === '공공데이터' ? 'KR' : 'KK'}-${candidate.key}`;
    if (overrides.get(id)?.exclude) { stats.excludedByOverride += 1; continue; }
    const near = nearestWithin(candidate, existing);
    const note = near ? `3km 안 기존 골프장: ${near.course.name} (${near.km.toFixed(1)}km)` : '';
    if (near) stats.reviewNeeded += 1;
    const course: GolfCourse = { id, name: candidate.name, address: candidate.address, lat: candidate.lat, lng: candidate.lng, holes: null, phone: candidate.phone, homepage: '', plkPartner: false, status: '협의중' };
    if (candidate.placeUrl) course.kakaoPlaceUrl = candidate.placeUrl;
    courses.push(course);
    existing.push({ id, name: candidate.name, lat: candidate.lat, lng: candidate.lng, placeIds: [...candidate.placeIds] });
    meta.set(id, { source: candidate.source, licenseNo: candidate.source === '공공데이터' ? candidate.key : '', businessStatus: candidate.businessStatus, note });
    report.push({ plk_code: id, name: candidate.name, address: candidate.address, status: candidate.source === '공공데이터' ? 'added_public' : 'added_kakao', note });
    if (candidate.source === '공공데이터') stats.addedPublic += 1; else stats.addedKakao += 1;
  }
  return stats;
}

main().catch((error: Error) => { console.error(`\n오류: ${error.message}`); process.exitCode = 1; });
