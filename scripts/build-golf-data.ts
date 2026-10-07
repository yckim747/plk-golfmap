// PLK 골프장 CSV(기준) + 카카오 로컬 API(보강) → data/golf-courses.json
// 사용: npm run data:build [-- <CSV 경로>]
// 경로를 생략하면 data/source/에서 템플릿이 아닌 가장 최근 CSV(운영팀 골프장 마스터 원본 등)를 사용한다.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCsv, parseCourseFile, parseOverrides, toCsv } from './lib/csv';
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

  mkdirSync(path.dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, toCsv(report, ['plk_code', 'name', 'address', 'status', 'match_status', 'score', 'place_id', 'place_name', 'place_address', 'candidates', 'note']));
  const errors = validateCourses(courses);
  if (errors.length) throw new Error(`검증 실패로 ${path.relative(root, outputFile)}을 갱신하지 않았습니다:\n- ${errors.join('\n- ')}`);
  writeFileSync(outputFile, JSON.stringify(courses, null, 2) + '\n');

  const reasons: Record<string, number> = { ...skippedCounts };
  for (const row of skipped) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  const partnerCount = (type: string) => courses.filter((course) => course.partnerType === type).length;
  console.log(`
완료: ${path.relative(root, outputFile)} (${courses.length}곳, 제휴 ${partnerCount('제휴')}곳, 이용협약 ${partnerCount('이용협약')}곳, 협의중 ${courses.filter((course) => course.status === '협의중').length}곳)
  카카오 장소 확정 ${counts.confirmed ?? 0} / 보정 적용 ${counts.override ?? 0} / 원본 좌표만 ${counts.source_coords ?? 0} / 주소 좌표 대체 ${counts.address_fallback ?? 0} / 좌표 없음·보정 제외 ${(counts.excluded ?? 0) + (counts.no_coords ?? 0)}
  원본에서 제외: ${Object.entries(reasons).map(([reason, count]) => `${reason} ${count}`).join(', ') || '없음'}
  카카오 API 호출 ${kakao.apiCalls}건 (나머지는 캐시)
  매칭 리포트: ${path.relative(root, reportFile)} — source_coords/address_fallback/no_coords 건은 data/source/overrides.csv로 보정할 수 있습니다.`);
}

main().catch((error: Error) => { console.error(`\n오류: ${error.message}`); process.exitCode = 1; });
