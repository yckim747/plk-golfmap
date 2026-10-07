import type { Region } from './region';

export type KindWord = '제휴' | '이용협약' | '일반' | '협의중';
export interface ParsedQuery { keywords: string[]; region: Region | null; kind: KindWord | null; nearby: boolean }

// 권역 단어(시·도 단위). 시·군 이름(용인, 부산 등)은 주소 검색어로 남긴다.
const REGION_WORDS: [Region, string[]][] = [
  ['수도권', ['수도권', '경기도', '경기권']],
  ['강원', ['강원', '강원도', '강원권']],
  ['충청', ['충청', '충청도', '충청권', '충북', '충남', '충청북도', '충청남도']],
  ['전라', ['전라', '전라도', '전라권', '호남', '전북', '전남', '전라북도', '전라남도']],
  ['경상', ['경상', '경상도', '경상권', '영남', '경북', '경남', '경상북도', '경상남도']],
  ['제주', ['제주', '제주도', '제주권']],
];
const KIND_WORDS: [KindWord, string[]][] = [
  ['이용협약', ['이용협약', '협약']],
  ['제휴', ['제휴', '피엘케이', 'plk제휴', '파트너']],
  ['협의중', ['협의중', '협의']],
  ['일반', ['일반', '비제휴']],
];
const NEARBY_WORDS = ['가까운', '가까이', '근처', '주변', '근방', '인근', '내위치', '여기'];
// 검색 의미가 없는 말(음성 검색에서 자주 붙는 표현)
const STOP_WORDS = new Set(['골프장', '골프', '골프장들', '찾아줘', '찾아', '찾기', '찾고', '싶어', '보여줘', '보여', '알려줘', '알려', '검색', '검색해줘', '해줘', '있는', '있나', '어디', '어디야', '곳', '좀', '내', '나', '목록', '리스트', 'plk', '피엘케이의', '모두', '전부', '다']);
// 끝에 붙은 조사: "용인에" → 용인, "강원도의" → 강원도
const JOSA = /(에서|에있는|으로|에는|에도|에|의|은|는|이|가|을|를|로|도|만)$/;

function normalizeToken(token: string): string {
  const lower = token.toLowerCase().replace(/[.,!?~]/g, '');
  const stripped = lower.replace(JOSA, '');
  return stripped.length >= 2 ? stripped : lower;
}

// "강원도 제휴 골프장 찾아줘" → { region: 강원, kind: 제휴, keywords: [] }
// "가까운 골프장" → nearby, "용인에 있는 골프장" → keywords: [용인]
export function parseSearchQuery(text: string): ParsedQuery {
  const result: ParsedQuery = { keywords: [], region: null, kind: null, nearby: false };
  const compact = text.replace(/\s+/g, '');
  if (NEARBY_WORDS.some((word) => compact.includes(word))) result.nearby = true;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const token = normalizeToken(raw);
    if (STOP_WORDS.has(token) || STOP_WORDS.has(raw.toLowerCase())) continue;
    if (NEARBY_WORDS.some((word) => token === word || token.startsWith(word))) continue;
    // 조사를 떼기 전 단어로도 확인한다("경상남도"의 '도'는 조사가 아니다).
    const forms = [raw.toLowerCase().replace(/[.,!?~]/g, ''), token];
    const region = REGION_WORDS.find(([, words]) => forms.some((form) => words.includes(form)))?.[0];
    if (region && !result.region) { result.region = region; continue; }
    const kind = KIND_WORDS.find(([, words]) => forms.some((form) => words.includes(form)))?.[0];
    if (kind && !result.kind) { result.kind = kind; continue; }
    result.keywords.push(token);
  }
  return result;
}

export function describeParsed(parsed: ParsedQuery): string {
  return [parsed.region, parsed.kind, parsed.nearby ? '가까운 순' : null, ...parsed.keywords.map((keyword) => `'${keyword}'`)].filter(Boolean).join(' · ');
}
