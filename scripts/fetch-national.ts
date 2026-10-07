// 대한민국 전체 골프장 후보 수집 → data/source/kakao-golf.json, data/source/public-golf.json
// 사용: npm run data:fetch
//  - 카카오: 대한민국 범위를 격자로 나눠 '골프장' 키워드를 전수 검색 (KAKAO_REST_API_KEY)
//  - 공공데이터: 행정안전부_생활_골프장 조회서비스 (PUBLIC_DATA_SERVICE_KEY, 없으면 건너뜀)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanAddress, cleanLotAddress } from './lib/address';
import { KakaoLocalClient } from './lib/kakao';
import type { KakaoPlace } from './lib/match';
import { clusterPlaces, isNationalCourse, KOREA_BOUNDS, nameVariants, pickPlaceByName, tmToWgs84, type NationalCandidate } from './lib/national';

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
  const publicKey = process.env.PUBLIC_DATA_SERVICE_KEY;
  if (!publicKey) { console.log('공공데이터: PUBLIC_DATA_SERVICE_KEY가 없어 건너뜀'); return; }
  const records = await fetchPublic(publicKey);
  const status: Record<string, number> = {};
  for (const record of records) status[record.SALS_STTS_NM] = (status[record.SALS_STTS_NM] ?? 0) + 1;
  const items: NationalCandidate[] = [];
  let noCoords = 0;
  for (const record of records.filter((item) => /^(영업|휴업)/.test(item.SALS_STTS_NM) && !/^(미사용|테스트)$|연습장/.test(item.BPLC_NM.trim()))) {
    const name = record.BPLC_NM.trim();
    const road = cleanAddress(record.ROAD_NM_ADDR);
    const lot = cleanLotAddress(record.LOTNO_ADDR);
    // 좌표 우선순위: 인허가 TM 좌표 → 도로명 주소 → 지번 주소 → 카카오에서 이름으로 찾은 골프장
    let point = tmToWgs84(Number(record.CRD_INFO_X), Number(record.CRD_INFO_Y))
      ?? (road ? await kakao.geocode(road) : null)
      ?? (lot ? await kakao.geocode(lot) : null);
    if (!point) {
      // 산 번지 등 지금 지번 체계에 없는 주소: 리·동 위치를 구해 그 근처의 같은 이름 카카오 골프장을 찾는다.
      const village = lot.match(/^.*?\S+[리동가]\b/)?.[0] ?? '';
      const near = village ? await kakao.geocode(village) : null;
      // 인허가 명칭 그대로는 검색이 안 되는 경우가 많아 짧은 이름 변형부터 차례로 검색한다.
      for (const query of nameVariants(name).sort((a, b) => a.length - b.length)) {
        const found = pickPlaceByName(name, (await kakao.searchPlaces(query, near)).filter(isNationalCourse), near ? 0.6 : 0.85);
        if (found) { point = { lat: Number(found.y), lng: Number(found.x) }; break; }
      }
    }
    if (!point) { noCoords += 1; console.log(`  좌표 확인 불가: ${name} (${road || lot})`); continue; }
    items.push({ source: '공공데이터', key: `${record.OPN_ATMY_GRP_CD}-${record.MNG_NO}`, name, address: road || lot, lat: point.lat, lng: point.lng, phone: record.TELNO.trim(), businessStatus: record.SALS_STTS_NM, placeUrl: '' });
  }
  kakao.saveCache();
  writeFileSync(path.join(sourceDir, 'public-golf.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), total: records.length, status, items }, null, 1));
  console.log(`공공데이터: 전체 ${records.length}건 (${Object.entries(status).map(([name, count]) => `${name} ${count}`).join(', ')}) → 영업·휴업 ${items.length}곳${noCoords ? `, 좌표 없음 ${noCoords}` : ''}`);
}

// 행정안전부_생활_골프장 조회서비스 (EPSG:5174 TM 좌표, 폐업 포함 전체 이력)
interface PublicRecord { OPN_ATMY_GRP_CD: string; MNG_NO: string; BPLC_NM: string; ROAD_NM_ADDR: string; LOTNO_ADDR: string; CRD_INFO_X: string; CRD_INFO_Y: string; SALS_STTS_NM: string; TELNO: string }
async function fetchPublic(serviceKey: string): Promise<PublicRecord[]> {
  const records: PublicRecord[] = [];
  for (let page = 1; ; page += 1) {
    const url = `https://apis.data.go.kr/1741000/golf_courses/info?${new URLSearchParams({ serviceKey, pageNo: String(page), numOfRows: '100', returnType: 'json' })}`;
    const json = await (await fetch(url, { signal: AbortSignal.timeout(30000) })).json() as { response: { header: { resultCode: string; resultMsg: string }; body: { totalCount: number; items: { item: PublicRecord[] } } } };
    if (json.response.header.resultCode !== '0') throw new Error(`공공데이터 API 오류: ${json.response.header.resultMsg}`);
    records.push(...json.response.body.items.item);
    if (records.length >= json.response.body.totalCount || !json.response.body.items.item.length) return records;
  }
}


main().catch((error: Error) => { console.error(`\n오류: ${error.message}`); process.exitCode = 1; });
