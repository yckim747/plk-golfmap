// 공공데이터(인허가) 주소 정리: 지오코딩이 되도록 괄호 설명·동/호 표기를 걷어낸다.

// "충청북도 음성군 소이면 후삼로158번길 101-0, 0동 (클럽하우스)" → "충청북도 음성군 소이면 후삼로158번길 101"
export function cleanAddress(address: string): string {
  return address.replace(/\s*\([^)]*\)/g, '').replace(/,.*$/, '').replace(/(\d+)-0\b/g, '$1').replace(/\s+/g, ' ').trim();
}

// "경상북도 칠곡군 북삼읍 보손리 34번지 2호" → "경상북도 칠곡군 북삼읍 보손리 34-2" (뒤에 붙은 건물명 등은 버림)
export function cleanLotAddress(address: string): string {
  const match = address.match(/^(.*?\S+[리동가로])\s+(산\s*)?(\d+)(?:번지)?(?:\s*(\d+)호|-(\d+))?/);
  if (!match) return cleanAddress(address);
  const [, area, mountain, main, sub1, sub2] = match;
  const sub = sub1 ?? sub2;
  return `${area} ${mountain ? '산 ' : ''}${main}${sub && sub !== '0' ? `-${sub}` : ''}`;
}
