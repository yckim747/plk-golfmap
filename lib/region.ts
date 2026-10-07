export const REGIONS = ['수도권', '강원', '충청', '전라', '경상', '제주'] as const;
export type Region = (typeof REGIONS)[number] | '기타';

const RULES: [Region, string[]][] = [
  ['수도권', ['서울', '경기', '인천']],
  ['강원', ['강원']],
  ['충청', ['충북', '충남', '충청', '대전', '세종']],
  ['전라', ['전북', '전남', '전라', '광주']],
  ['경상', ['경북', '경남', '경상', '대구', '울산', '부산']],
  ['제주', ['제주']],
];

// 주소 첫머리(시·도)로 권역을 정한다. "경기도", "경기", "강원특별자치도" 등 표기 차이를 모두 받는다.
export function regionOf(address: string): Region {
  const head = address.replace(/\s+/g, '');
  return RULES.find(([, prefixes]) => prefixes.some((prefix) => head.startsWith(prefix)))?.[0] ?? '기타';
}
