// 공유 링크: 주소에 조건을 담아 원하는 화면으로 바로 연다(게시판·배너·카카오톡 공유용).
// 예) …/golfmap/?region=강원&kind=제휴, …/golfmap/?course=A-104, …/golfmap/?q=용인&sort=near
import type { Region } from './region';
import { REGIONS } from './region';
import type { CourseKind } from './corrections';

export interface ViewParams { q: string; region: Region | 'all'; kind: CourseKind | 'all'; sort: 'default' | 'distance'; course: string | null; view: 'map' | 'list'; fav: boolean }
const KINDS: CourseKind[] = ['제휴', '이용협약', '일반', '협의중'];

export function readViewParams(search: string): Partial<ViewParams> {
  const params = new URLSearchParams(search);
  const result: Partial<ViewParams> = {};
  const q = params.get('q'); if (q) result.q = q;
  const region = params.get('region'); if (region && (REGIONS as readonly string[]).includes(region)) result.region = region as Region;
  const kind = params.get('kind'); if (kind && (KINDS as string[]).includes(kind)) result.kind = kind as CourseKind;
  if (params.get('sort') === 'near') result.sort = 'distance';
  const course = params.get('course'); if (course) result.course = course;
  if (params.get('view') === 'list') result.view = 'list';
  if (params.get('fav') === '1') result.fav = true;
  return result;
}

// 기본값은 빼서 짧은 주소를 만든다.
export function buildViewSearch(view: Partial<ViewParams>): string {
  const params = new URLSearchParams();
  if (view.q) params.set('q', view.q);
  if (view.region && view.region !== 'all') params.set('region', view.region);
  if (view.kind && view.kind !== 'all') params.set('kind', view.kind);
  if (view.sort === 'distance') params.set('sort', 'near');
  if (view.course) params.set('course', view.course);
  if (view.view === 'list') params.set('view', 'list');
  if (view.fav) params.set('fav', '1');
  const text = params.toString();
  return text ? `?${text}` : '';
}

// 모바일은 시스템 공유 창, 그 외는 클립보드 복사. 결과 문구를 돌려준다.
export async function shareLink(url: string, title: string): Promise<string> {
  try {
    if (navigator.share && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) { await navigator.share({ title, url }); return ''; }
    await navigator.clipboard.writeText(url);
    return '링크를 복사했어요. 게시판·카카오톡에 붙여 넣으세요.';
  } catch (error) {
    if ((error as Error).name === 'AbortError') return '';
    return `이 링크를 복사해 주세요: ${url}`;
  }
}
