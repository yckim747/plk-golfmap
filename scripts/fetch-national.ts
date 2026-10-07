// 대한민국 전체 골프장 후보 수집 → data/source/kakao-golf.json, data/source/public-golf.json
// 사용: npm run data:fetch
//  - 카카오: 대한민국 범위를 격자로 나눠 '골프장' 키워드를 전수 검색 (KAKAO_REST_API_KEY)
//  - 공공데이터: 행정안전부_생활_골프장 조회서비스 (PUBLIC_DATA_SERVICE_KEY, 없으면 건너뜀)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KakaoLocalClient } from './lib/kakao';
import type { KakaoPlace } from './lib/match';
import { clusterPlaces, isNationalCourse, KOREA_BOUNDS } from './lib/national';

const root = process.cwd();
const sourceDir = path.join(root, 'data/source');
const cacheFile = path.join(root, 'data/cache/kakao-local.json');
type Rect = [number, number, number, number];

async function sweepKakao(kakao: KakaoLocalClient): Promise<KakaoPlace[]> {
  const found: KakaoPlace[] = [];
  const [x1, y1, x2, y2] = KOREA_BOUNDS;
  const step = 0.5;
  const queue: Rect[] = [];
  for (let x = x1; x < x2; x += step) for (let y = y1; y < y2; y += step) queue.push([x, y, Math.min(x + step, x2), Math.min(y + step, y2)]);
  let tiles = 0;
  while (queue.length) {
    const rect = queue.shift()!;
    tiles += 1;
    const first = await kakao.searchRect('골프장', rect, 1);
    // 45건(3페이지)보다 많으면 4등분해서 다시 검색한다.
    if (first.total > 45 && rect[2] - rect[0] > 0.01) {
      const [a, b, c, d] = rect;
      const mx = (a + c) / 2;
      const my = (b + d) / 2;
      queue.push([a, b, mx, my], [mx, b, c, my], [a, my, mx, d], [mx, my, c, d]);
      continue;
    }
    found.push(...first.places);
    for (let page = 2, isEnd = first.isEnd; !isEnd && page <= 3; page += 1) {
      const next = await kakao.searchRect('골프장', rect, page);
      found.push(...next.places);
      isEnd = next.isEnd;
    }
    if (tiles % 100 === 0) console.log(`  카카오 격자 ${tiles}개 검색, 남은 격자 ${queue.length}`);
  }
  return found;
}

async function main() {
  try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* 환경변수로 직접 줄 수도 있음 */ }
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) throw new Error('.env.local에 KAKAO_REST_API_KEY를 설정하세요.');
  mkdirSync(sourceDir, { recursive: true });
  const kakao = new KakaoLocalClient(kakaoKey, cacheFile);
  try {
    const raw = await sweepKakao(kakao);
    const unique = [...new Map(raw.map((place) => [place.id, place])).values()];
    const courses = clusterPlaces(unique.filter(isNationalCourse));
    writeFileSync(path.join(sourceDir, 'kakao-golf.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), places: courses }, null, 1));
    console.log(`카카오: 검색 결과 ${unique.length}곳 → 골프장 ${unique.filter(isNationalCourse).length}곳 → 같은 골프장 묶은 뒤 ${courses.length}곳 (API 호출 ${kakao.apiCalls}건)`);
  } finally {
    kakao.saveCache();
  }
  if (!process.env.PUBLIC_DATA_SERVICE_KEY) console.log('공공데이터: PUBLIC_DATA_SERVICE_KEY가 없어 건너뜀');
}

main().catch((error: Error) => { console.error(`\n오류: ${error.message}`); process.exitCode = 1; });
