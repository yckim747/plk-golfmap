// PLK 골프장 CSV(기준) + 카카오 로컬 API(보강) → data/golf-courses.json
// 사용: npm run data:build [-- <CSV 경로>]
// 경로를 생략하면 data/source/에서 템플릿이 아닌 가장 최근 CSV(운영팀 골프장 마스터 원본 등)를 사용한다.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCsv, OPERATIONS_COLUMNS, parseCourseFile, parseOverrides, toCsv, type OverrideRow, type SkippedRow } from './lib/csv';
import { writeNationalWorkbook, type CourseMeta } from './lib/excel';
import { bestNameSimilarity, findExisting, GOLF_HINT, nearestWithin, type ClusteredPlace, type ExistingCourse, type NationalCandidate } from './lib/national';
import { KakaoLocalClient } from './lib/kakao';
import { distanceKm, isGolfCourse, matchPlace, nameSimilarity, normalizeName, type KakaoPlace } from './lib/match';
import { mergeCourse, validateCourses } from './lib/merge';
import type { GolfCourse } from '../lib/types';
import type { ReviewData, ReviewItem } from '../lib/review';

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
  const coordNotes = new Map<string, string>();
  // 검수용: 골프장별 위치 근거, 마스터 원본 좌표
  const coordSources = new Map<string, string>();
  const masterPoints = new Map<string, { lat: number; lng: number }>();

  try {
    for (const [index, sourceRow] of rows.entries()) {
      let row = sourceRow;
      let sourcePoint = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
      if (sourcePoint) masterPoints.set(row.plkCode, sourcePoint);
      // 주소가 비어 있으면 이름으로 카카오 골프장을 찾아 그 주소를 쓴다(이름이 거의 같고 1위가 뚜렷할 때만).
      if (!row.address) {
        const found = pickByName(row.name, await kakao.searchPlaces(row.name, sourcePoint));
        if (!found) { report.push({ plk_code: row.plkCode, name: row.name, address: '', status: 'skipped', note: '주소 없음(카카오 미확인)' }); skippedCounts['주소 없음(카카오 미확인)'] = (skippedCounts['주소 없음(카카오 미확인)'] ?? 0) + 1; continue; }
        row = { ...row, address: found.road_address_name || found.address_name };
      }
      // 원본 좌표 검증: 주소 위치와 5km 넘게 다르면(예: 여주 페럼클럽 좌표가 화성) 원본 좌표를 쓰지 않고
      // 카카오 확정 장소 또는 주소 좌표를 쓴다. 엑셀·리포트 비고에 남긴다.
      const geocoded = await kakao.geocode(row.address);
      let coordNote = '';
      if (sourcePoint && geocoded && distanceKm(sourcePoint, geocoded) > 5) {
        coordNote = `마스터 좌표 오류 의심(주소와 ${distanceKm(sourcePoint, geocoded).toFixed(0)}km 차이) → 카카오·주소 좌표 사용`;
        row = { ...row, lat: null, lng: null };
        sourcePoint = null;
        coordNotes.set(row.plkCode, coordNote);
      }
      const addressPoint = sourcePoint ?? geocoded;
      let places = await kakao.searchPlaces(row.name, addressPoint);
      if (!places.some(isGolfCourse)) places = [...places, ...await kakao.searchPlaces(`${normalizeName(row.name)} 골프장`, addressPoint)];
      const match = matchPlace(row, places, addressPoint);
      const result = mergeCourse(row, overrides.get(row.plkCode), match, places, addressPoint);
      // 협의중 행은 원본 좌표나 카카오 확정 장소가 있을 때만 싣는다(사무실 주소 등 잘못된 행 방지).
      if (row.status && !sourcePoint && !coordNote && result.status !== 'confirmed' && result.status !== 'override') {
        report.push({ plk_code: row.plkCode, name: row.name, address: row.address, status: 'skipped', note: '협의중: 위치 확인 불가' });
        skippedCounts['협의중: 위치 확인 불가'] = (skippedCounts['협의중: 위치 확인 불가'] ?? 0) + 1;
        continue;
      }
      if (result.course) {
        courses.push(result.course);
        coordSources.set(result.course.id, { confirmed: '카카오 장소', override: '보정 CSV', source_coords: '마스터 좌표', address_fallback: '주소 좌표' }[result.status as string] ?? '');
      }
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
        note: [coordNote, result.note].filter(Boolean).join(' / '),
      });
      if ((index + 1) % 50 === 0) console.log(`  ${index + 1}/${rows.length} 처리`);
    }
  } finally {
    kakao.saveCache();
  }

  const meta = new Map<string, CourseMeta>(courses.map((course) => [course.id, { source: 'PLK 마스터', licenseNo: '', businessStatus: '', note: coordNotes.get(course.id) ?? '' }]));
  // 모든 골프장을 표시하는 것이 원칙이라 지금은 전국 보완에서 막는 골프장이 없다.
  // (특정 골프장을 지도에서 빼려면 관리 화면에서 '지도에서 제외'한다. 차단이 다시 필요하면 skipped에서 골라 넣는다.)
  const blocked: SkippedRow[] = [];
  const duplicates: DuplicateRecord[] = [];
  const merged: MergedRecord[] = [];
  const national = supplementNational(courses, overrides, report, meta, blocked, coordSources, duplicates, merged);

  mkdirSync(path.dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, toCsv(report, ['plk_code', 'name', 'address', 'status', 'match_status', 'score', 'place_id', 'place_name', 'place_address', 'candidates', 'note']));
  const errors = validateCourses(courses);
  if (errors.length) throw new Error(`검증 실패로 ${path.relative(root, outputFile)}을 갱신하지 않았습니다:\n- ${errors.join('\n- ')}`);
  writeFileSync(outputFile, JSON.stringify(courses, null, 2) + '\n');
  const masterColumns = format === 'operations' ? decodeCsv(readFileSync(inputFile)).split(/\r?\n/, 1)[0].split(',').map((column) => column.trim()) : [...OPERATIONS_COLUMNS];
  const workbookFile = path.join(root, `data/reports/전국골프장_${new Date().toISOString().slice(2, 10).replaceAll('-', '')}.xlsx`);
  const unlocatedPublic = existsSync(path.join(sourceDir, 'public-golf.json')) ? JSON.parse(readFileSync(path.join(sourceDir, 'public-golf.json'), 'utf8')).unlocated ?? [] : [];
  await writeNationalWorkbook(workbookFile, courses, meta, masterColumns, national, { coordSources, masterPoints, unlocatedPublic, duplicates });
  // 관리 화면(/admin)의 검수 목록. 지도에서 빠진 골프장은 다시 넣을 수 있도록 골프장 정보를 함께 저장한다.
  const reviewItems: ReviewItem[] = [];
  // 마스터 공개형태 '불가': 지도에는 협의중으로 표시. 노출하면 안 되는 곳은 관리 화면에서 '지도에서 제외'한다.
  const undisclosedIds = new Set(rows.filter((row) => row.undisclosed).map((row) => row.plkCode));
  for (const course of courses.filter((item) => undisclosedIds.has(item.id))) reviewItems.push({ key: `undisclosed:${course.id}`, type: 'undisclosed', courseId: course.id, title: course.name, detail: '운영팀 마스터 공개형태 "불가" → 협의중으로 표시 중(PLK 제휴 정보는 숨김). 노출하면 안 되면 "지도에서 제외"하세요.' });
  for (const course of courses) {
    const master = masterPoints.get(course.id);
    const moved = master ? distanceKm(master, course) : 0;
    if (moved >= 0.3) reviewItems.push({ key: `moved:${course.id}`, type: 'moved', courseId: course.id, title: course.name, detail: `마스터 좌표에서 ${moved.toFixed(1)}km 옮김 (근거: ${coordSources.get(course.id) ?? '-'})` });
    if (!course.kakaoPlaceUrl) reviewItems.push({ key: `unlinked:${course.id}`, type: 'unlinked', courseId: course.id, title: course.name, detail: `위치 근거: ${coordSources.get(course.id) ?? '-'} · 카카오맵 링크·전화 없음` });
    const nearby = meta.get(course.id)?.note.match(/3km 안 기존 골프장: [^/]+/)?.[0];
    if (nearby && meta.get(course.id)?.source !== 'PLK 마스터') reviewItems.push({ key: `nearby:${course.id}`, type: 'nearby', courseId: course.id, title: course.name, detail: `${meta.get(course.id)?.source} 신규 · ${nearby.trim()}` });
  }
  for (const record of merged) reviewItems.push({ key: `merged:${record.candidate.id}`, type: 'merged', courseId: record.keptId, title: record.candidate.name, detail: `${record.keptName}과 같은 골프장으로 통합 (${record.km.toFixed(1)}km)`, candidate: record.candidate });
  for (const record of duplicates) reviewItems.push({ key: `duplicate:${record.removedId}`, type: 'duplicate', courseId: record.keptId, title: record.removedName, detail: `${record.keptName}과 같은 자리 ${(record.km * 1000).toFixed(0)}m → ${record.action}`, candidate: record.removedCourse });
  for (const [index, item] of (unlocatedPublic as { name: string; address: string; status: string }[]).entries()) reviewItems.push({ key: `unlocated:${item.name}:${index}`, type: 'unlocated', title: item.name, detail: `${item.address} · 영업상태 ${item.status} · 위치를 지정하면 지도에 추가할 수 있음`, candidate: { id: `KR-UNLOCATED-${index + 1}`, name: item.name, address: item.address, lat: 0, lng: 0, holes: null, phone: '', homepage: '', plkPartner: false, status: '협의중' } });
  writeFileSync(path.join(root, 'data/review.json'), JSON.stringify({ generatedAt: new Date().toISOString(), items: reviewItems } satisfies ReviewData, null, 1) + '\n');

  const reasons: Record<string, number> = { ...skippedCounts };
  for (const row of skipped) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  const partnerCount = (type: string) => courses.filter((course) => course.partnerType === type).length;
  console.log(`
완료: ${path.relative(root, outputFile)} (${courses.length}곳, 제휴 ${partnerCount('제휴')}곳, 이용협약 ${partnerCount('이용협약')}곳, 협의중 ${courses.filter((course) => course.status === '협의중').length}곳)
  카카오 장소 확정 ${counts.confirmed ?? 0} / 보정 적용 ${counts.override ?? 0} / 원본 좌표만 ${counts.source_coords ?? 0} / 주소 좌표 대체 ${counts.address_fallback ?? 0} / 좌표 없음·보정 제외 ${(counts.excluded ?? 0) + (counts.no_coords ?? 0)}
  원본에서 제외: ${Object.entries(reasons).map(([reason, count]) => `${reason} ${count}`).join(', ') || '없음'}
  카카오 API 호출 ${kakao.apiCalls}건 (나머지는 캐시)
  매칭 리포트: ${path.relative(root, reportFile)} — source_coords/address_fallback/no_coords 건은 data/source/overrides.csv로 보정할 수 있습니다.
  전국 보완: 공공데이터 신규 ${national.addedPublic}곳, 카카오 신규 ${national.addedKakao}곳 (후보 ${national.candidates}곳 중 기존과 같은 골프장 ${national.matched}곳, 휴장 차단 ${national.blocked}곳, 이름만 다른 동일 골프장 ${national.mergedByProximity}곳, 같은 자리 중복 정리 ${national.duplicates}곳, 검토 필요 ${national.reviewNeeded}곳)
  엑셀: ${path.relative(root, workbookFile)}`);
}

// 전국 골프장 보완: 공공데이터(인허가) → 카카오 순으로, 지금 목록에 없는 골프장을 '협의중'으로 추가한다.
// data/source/public-golf.json, kakao-golf.json은 `npm run data:fetch`가 만든다(없으면 건너뜀).
interface MergedRecord { candidate: GolfCourse; keptId: string; keptName: string; km: number }
function supplementNational(courses: GolfCourse[], overrides: Map<string, OverrideRow>, report: Record<string, string | number>[], meta: Map<string, CourseMeta>, blocked: SkippedRow[], coordSources: Map<string, string>, duplicates: DuplicateRecord[], merged: MergedRecord[]) {
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
  const stats = { candidates: candidates.length, matched: 0, mergedByProximity: 0, duplicates: 0, blocked: 0, addedPublic: 0, addedKakao: 0, reviewNeeded: 0, excludedByOverride: 0 };
  for (const candidate of candidates) {
    const hit = findExisting(candidate, existing);
    if (hit?.blocked) { stats.blocked += 1; report.push({ plk_code: `${candidate.source}:${candidate.key}`, name: candidate.name, address: candidate.address, status: 'skipped_national', note: `PLK 마스터 ${hit.name}(휴장)과 같은 골프장` }); continue; }
    if (hit) {
      stats.matched += 1;
      const course = courses.find((item) => item.id === hit.id)!;
      // 위치 보강: 카카오 장소가 없는 골프장은 같은 골프장으로 판정된 카카오 장소(없으면 공공데이터 인허가) 좌표로 옮긴다.
      // 지도 바탕이 카카오맵이라 카카오 좌표가 가장 우선이다. 5km 넘게 떨어진 후보는 오판 가능성이 있어 옮기지 않는다.
      const manual = overrides.get(hit.id)?.lat != null;
      const current = coordSources.get(hit.id) ?? '';
      // 이름이 거의 같은 카카오 장소는 15km까지 옮긴다(마스터 좌표가 크게 어긋난 경우, 예: 유성CC 5km).
      const km = distanceKm(course, candidate);
      const sameName = bestNameSimilarity(course.name, candidate.name) >= 0.9;
      const canMove = !manual && !course.kakaoPlaceUrl && (km <= 5 || (candidate.source === '카카오' && sameName && km <= 15));
      if (canMove && (candidate.source === '카카오' || (candidate.source === '공공데이터' && current !== '공공데이터 인허가'))) {
        course.lat = candidate.lat;
        course.lng = candidate.lng;
        coordSources.set(hit.id, candidate.source === '카카오' ? '카카오 장소' : '공공데이터 인허가');
      }
      // 같은 골프장의 카카오 정보(전화·카카오맵 링크)를 채운다. 위치를 옮기지 못한 경우엔 링크도 붙이지 않는다(핀과 링크 불일치 방지).
      if (candidate.source === '카카오' && (canMove || course.kakaoPlaceUrl || manual)) {
        if (!course.phone) course.phone = candidate.phone;
        if (!course.kakaoPlaceUrl && candidate.placeUrl) course.kakaoPlaceUrl = candidate.placeUrl;
        hit.placeIds.push(...candidate.placeIds);
      }
      if (candidate.source === '카카오' && meta.get(hit.id)?.source === '공공데이터') {
        // 인허가 명칭이 법인명이면("디케이레저") 지도에서 알아보기 쉬운 카카오 이름으로 바꾼다.
        if (!GOLF_HINT.test(course.name) && GOLF_HINT.test(candidate.name)) {
          meta.get(hit.id)!.note = [`인허가 명칭: ${course.name}`, meta.get(hit.id)!.note].filter(Boolean).join(' / ');
          course.name = candidate.name;
        }
      }
      continue;
    }
    // 인허가 명칭과 브랜드명이 다른 골프장(예: 인천국제공항스카이칠십이 = 클럽72, 강원랜드골프클럽 = 하이원CC):
    // 카카오에 비슷한 이름의 장소가 없고 1km 안에 기존 골프장이 있으면 같은 골프장으로 보고 인허가 명칭만 비고에 남긴다.
    if (candidate.source === '공공데이터') {
      const near = nearestWithin(candidate, existing, 1);
      const onKakao = kakaoPlaces.some((place) => bestNameSimilarity(candidate.name, place.place_name) >= 0.6 && distanceKm(candidate, { lat: Number(place.y), lng: Number(place.x) }) <= 3);
      if (near && !onKakao) {
        stats.matched += 1;
        stats.mergedByProximity += 1;
        const info = meta.get(near.course.id);
        if (info) info.note = [info.note, `인허가 명칭: ${candidate.name}(${near.km.toFixed(1)}km, 동일 골프장 처리)`].filter(Boolean).join(' / ');
        report.push({ plk_code: `공공데이터:${candidate.key}`, name: candidate.name, address: candidate.address, status: 'merged_nearby', note: `${near.course.name}과 같은 골프장으로 처리(${near.km.toFixed(1)}km)` });
        merged.push({ candidate: { id: `KR-${candidate.key}`, name: candidate.name, address: candidate.address, lat: candidate.lat, lng: candidate.lng, holes: null, phone: candidate.phone, homepage: '', plkPartner: false, status: '협의중' }, keptId: near.course.id, keptName: near.course.name, km: near.km });
        continue;
      }
    }
    // 골프장 단서가 없는 이름(운영 법인명 등)은 1.5km 안에 기존 골프장이 있으면 그 골프장의 다른 등록으로 본다.
    if (!GOLF_HINT.test(candidate.name) && nearestWithin(candidate, existing, 1.5)) { stats.matched += 1; continue; }
    const id = `${candidate.source === '공공데이터' ? 'KR' : 'KK'}-${candidate.key}`;
    if (overrides.get(id)?.exclude) { stats.excludedByOverride += 1; continue; }
    const near = nearestWithin(candidate, existing);
    const note = near ? `3km 안 기존 골프장: ${near.course.name} (${near.km.toFixed(1)}km)` : '';
    if (near) stats.reviewNeeded += 1;
    // 표시 이름에서는 법인 표기만 뗀다("(주)밀양컨트리클럽" → "밀양컨트리클럽").
    const displayName = candidate.name.replace(/\((주|재|사|유)\)|㈜|주식회사/g, ' ').replace(/\s+/g, ' ').trim() || candidate.name;
    const course: GolfCourse = { id, name: displayName, address: candidate.address, lat: candidate.lat, lng: candidate.lng, holes: null, phone: candidate.phone, homepage: '', plkPartner: false, status: '협의중' };
    if (candidate.placeUrl) course.kakaoPlaceUrl = candidate.placeUrl;
    courses.push(course);
    existing.push({ id, name: candidate.name, lat: candidate.lat, lng: candidate.lng, placeIds: [...candidate.placeIds] });
    coordSources.set(id, candidate.source === '카카오' ? '카카오 장소' : '공공데이터 인허가');
    meta.set(id, { source: candidate.source, licenseNo: candidate.source === '공공데이터' ? candidate.key : '', businessStatus: candidate.businessStatus, note });
    report.push({ plk_code: id, name: candidate.name, address: candidate.address, status: candidate.source === '공공데이터' ? 'added_public' : 'added_kakao', note });
    if (candidate.source === '공공데이터') stats.addedPublic += 1; else stats.addedKakao += 1;
  }
  stats.duplicates = removeSameSpotDuplicates(courses, meta, report, coordSources, duplicates);
  return stats;
}

main().catch((error: Error) => { console.error(`\n오류: ${error.message}`); process.exitCode = 1; });

// 같은 자리 중복 정리: 카카오 장소가 없는 골프장 옆 500m 안에 카카오에 연결된 골프장이 있으면 옛 이름·다른 이름의 중복이다.
// - 협의중이면 지도에서 빼고 남는 골프장 비고에 다른 명칭을 남긴다(예: 글로렌스CC ↔ 글렌로스골프클럽).
// - 운영 중인 마스터 골프장이고 옆이 전국 수집 추가분이면, 마스터 쪽이 카카오 정보를 넘겨받고 추가분을 뺀다(예: 클럽디 보은).
// - 둘 다 운영 중인 마스터 골프장이면 같은 단지의 다른 코스일 수 있어 그대로 둔다(예: 라비에벨 듄스/올드).
export interface DuplicateRecord { removedId: string; removedName: string; keptId: string; keptName: string; km: number; action: string; removedCourse: GolfCourse }
function removeSameSpotDuplicates(courses: GolfCourse[], meta: Map<string, CourseMeta>, report: Record<string, string | number>[], coordSources: Map<string, string>, duplicates: DuplicateRecord[]): number {
  const removed = new Set<string>();
  const note = (id: string, text: string) => { const info = meta.get(id); if (info) info.note = [info.note, text].filter(Boolean).join(' / '); };
  for (const course of courses.filter((item) => !item.kakaoPlaceUrl)) {
    if (removed.has(course.id)) continue;
    const near = courses
      .filter((other) => other.id !== course.id && other.kakaoPlaceUrl && !removed.has(other.id))
      .map((other) => ({ other, km: distanceKm(course, other) }))
      .sort((a, b) => a.km - b.km)[0];
    if (!near || near.km > 0.5) continue;
    const { other, km } = near;
    if (course.status === '협의중') {
      removed.add(course.id);
      note(other.id, `다른 명칭: ${course.name}`);
      duplicates.push({ removedId: course.id, removedName: course.name, keptId: other.id, keptName: other.name, km, action: '협의중 중복 제외', removedCourse: { ...course } });
    } else if (meta.get(other.id)?.source !== 'PLK 마스터') {
      const removedCourse = { ...other };
      course.lat = other.lat; course.lng = other.lng; course.kakaoPlaceUrl = other.kakaoPlaceUrl;
      if (!course.phone) course.phone = other.phone;
      coordSources.set(course.id, '카카오 장소');
      removed.add(other.id);
      note(course.id, `다른 명칭: ${other.name}`);
      duplicates.push({ removedId: other.id, removedName: other.name, keptId: course.id, keptName: course.name, km, action: '마스터 골프장으로 통합', removedCourse });
    }
  }
  for (const record of duplicates) report.push({ plk_code: record.removedId, name: record.removedName, address: '', status: 'removed_duplicate', note: `${record.keptName}과 같은 자리(${record.km.toFixed(2)}km) → ${record.action}` });
  for (let index = courses.length - 1; index >= 0; index--) if (removed.has(courses[index].id)) courses.splice(index, 1);
  return removed.size;
}
