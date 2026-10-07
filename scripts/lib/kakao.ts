import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { KakaoPlace } from './match';

const API = 'https://dapi.kakao.com/v2/local/search';
const MIN_INTERVAL_MS = 200;

type Json = { documents: unknown[] };

// 같은 요청은 캐시 파일에서 돌려주므로 재실행 시 API를 다시 호출하지 않는다.
export class KakaoLocalClient {
  private cache: Record<string, Json>;
  private lastCall = 0;
  apiCalls = 0;

  constructor(private apiKey: string, private cacheFile: string, private fetcher: typeof fetch = fetch) {
    this.cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  }

  private async get(endpoint: string, params: Record<string, string>): Promise<Json> {
    const url = `${API}/${endpoint}.json?${new URLSearchParams(params)}`;
    if (this.cache[url]) return this.cache[url];
    const wait = this.lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCall = Date.now();
    this.apiCalls += 1;
    const response = await this.fetcher(url, { headers: { Authorization: `KakaoAK ${this.apiKey}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`카카오 로컬 API ${response.status}: ${await response.text()}`);
    const json = await response.json() as Json;
    this.cache[url] = json;
    return json;
  }

  async geocode(address: string): Promise<{ lat: number; lng: number } | null> {
    const [first] = (await this.get('address', { query: address })).documents as { x: string; y: string }[];
    return first ? { lat: Number(first.y), lng: Number(first.x) } : null;
  }

  async searchPlaces(query: string, near: { lat: number; lng: number } | null): Promise<KakaoPlace[]> {
    const params: Record<string, string> = { query, size: '15' };
    if (near) Object.assign(params, { x: String(near.lng), y: String(near.lat), radius: '20000' });
    return (await this.get('keyword', params)).documents as KakaoPlace[];
  }

  saveCache(): void {
    mkdirSync(path.dirname(this.cacheFile), { recursive: true });
    writeFileSync(this.cacheFile, JSON.stringify(this.cache));
  }
}
