'use client';
import { useCallback, useEffect, useState } from 'react';

// 관심 골프장: 로그인 없이 이 기기 브라우저에만 저장한다(시크릿 창·저장소 차단 시에는 이번 방문 동안만 유지).
const STORAGE_KEY = 'plk-golfmap:favorites';

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { setFavorites(new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[])); } catch { /* 저장소를 쓸 수 없으면 빈 목록 */ }
  }, []);
  const toggle = useCallback((id: string) => {
    let added = false;
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else { next.add(id); added = true; }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* 저장 실패는 무시 */ }
      return next;
    });
    return added;
  }, []);
  return { favorites, toggle };
}
