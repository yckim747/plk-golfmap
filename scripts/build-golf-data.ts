// PLK 골프장 CSV(기준) + 카카오 로컬 API(보강) → data/golf-courses.json
// 사용: npm run data:build [-- <PLK CSV 경로>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCsv, parseOverrides, parsePlkCourses, toCsv } from './lib/csv';
import { KakaoLocalClient } from './lib/kakao';
import { isGolfCourse, matchPlace, normalizeName, type KakaoPlace } from './lib/match';
import { mergeCourse, validateCourses } from './lib/merge';
import type { GolfCourse } from '../lib/types';

const root = process.cwd();
const inputFile = path.resolve(root, process.argv[2] ?? 'data/source/plk-golf-courses.csv');
const overridesFile = path.join(root, 'data/source/overrides.csv');
const outputFile = path.join(root, 'data/golf-courses.json');
const reportFile = path.join(root, 'data/reports/match-report.csv');
const cacheFile = path.join(root, 'data/cache/kakao-local.json');

async function main() {
  try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* 환경변수로 직접 줄 수도 있음 */ }
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error('.env.local에 KAKAO_REST_API_KEY(카카오 REST API 키)를 설정하세요.');
  if (!existsSync(inputFile)) throw new Error(`PLK 골프장 CSV가 없습니다: ${inputFile}\n템플릿: data/source/plk-golf-courses.template.csv`);

  const rows = parsePlkCourses(decodeCsv(readFileSync(inputFile)));
  const overrides = existsSync(overridesFile) ? parseOverrides(decodeCsv(readFileSync(overridesFile))) : new Map();
  const kakao = new KakaoLocalClient(apiKey, cacheFile);
  const courses: GolfCourse[] = [];
  const report: Record<string, string | number>[] = [];
  const counts: Record<string, number> = {};

  try {
    for (const [index, row] of rows.entries()) {
      const addressPoint = await kakao.geocode(row.address);
      let places = await kakao.searchPlaces(row.name, addressPoint);
      if (!places.some(isGolfCourse)) places = [...places, ...await kakao.searchPlaces(`${normalizeName(row.name)} 골프장`, addressPoint)];
      const match = matchPlace(row, places, addressPoint);
      const result = mergeCourse(row, overrides.get(row.plkCode), match, places, addressPoint);
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

  console.log(`
완료: ${path.relative(root, outputFile)} (${courses.length}곳, 제휴 ${courses.filter((course) => course.plkPartner).length}곳)
  입력 ${rows.length} / 장소 확정 ${counts.confirmed ?? 0} / 보정 적용 ${counts.override ?? 0} / 주소 좌표 대체 ${counts.address_fallback ?? 0} / 제외 ${(counts.excluded ?? 0) + (counts.no_coords ?? 0)}
  카카오 API 호출 ${kakao.apiCalls}건 (나머지는 캐시)
  매칭 리포트: ${path.relative(root, reportFile)} — address_fallback/no_coords 건은 data/source/overrides.csv로 보정하세요.`);
}

main().catch((error: Error) => { console.error(`\n오류: ${error.message}`); process.exitCode = 1; });
