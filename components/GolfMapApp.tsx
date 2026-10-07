'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Flag, LoaderCircle, RefreshCw } from 'lucide-react';
import AppHeader from './AppHeader';
import KakaoMap from './KakaoMap';
import GolfCourseSearch from './GolfCourseSearch';
import GolfCourseFilter from './GolfCourseFilter';
import GolfCourseSheet from './GolfCourseSheet';
import type { GolfCourse } from '@/lib/types';
export default function GolfMapApp() {
  const [courses, setCourses] = useState<GolfCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [partnerOnly, setPartnerOnly] = useState(false);
  const [selected, setSelected] = useState<GolfCourse | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/golf-courses.json`, { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error('골프장 정보를 불러오지 못했습니다.'); return response.json() as Promise<GolfCourse[]>; }).then(setCourses).catch((reason: Error) => { if (reason.name !== 'AbortError') setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const filtered = useMemo(() => courses.filter((course) => (!partnerOnly || course.plkPartner) && `${course.name} ${course.address}`.toLowerCase().includes(query.trim().toLowerCase())), [courses, partnerOnly, query]);
  const select = useCallback((course: GolfCourse) => setSelected(course), []);
  const close = useCallback(() => setSelected(null), []);
  return <main className="map-shell"><AppHeader map/><section className="map-toolbar"><div className="map-heading"><div><span className="eyebrow">EXPLORE YOUR NEXT ROUND</span><h1>골프장 지도<span>.</span></h1></div></div><GolfCourseSearch value={query} onChange={setQuery}/><GolfCourseFilter partnerOnly={partnerOnly} onChange={setPartnerOnly} total={courses.length} partners={courses.filter((course) => course.plkPartner).length}/></section><div className="map-layout"><KakaoMap courses={filtered} selected={selected} onSelect={select}/><section className="course-list" aria-label="골프장 목록" aria-busy={loading}><div className="list-heading"><div><h2>{query ? '검색 결과' : partnerOnly ? 'PLK와 함께하는 코스' : '다음 라운드의 발견'}</h2><p>전국 골프장 · {filtered.length}곳</p></div><Flag size={21}/></div>{loading ? <div className="list-status" role="status"><LoaderCircle className="spin"/>골프장을 불러오는 중</div> : error ? <div className="list-status" role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16}/>다시 시도</button></div> : filtered.length === 0 ? <div className="list-status"><p>검색 결과가 없어요.</p><button onClick={() => { setQuery(''); setPartnerOnly(false); }}>필터 초기화</button></div> : filtered.map((course) => <button key={course.id} className="course-row" onClick={() => select(course)}><span className={`course-icon ${course.plkPartner ? 'partner' : ''}`}>{course.plkPartner ? 'P' : <Flag size={19}/>}</span><span className="course-summary"><strong>{course.name}{course.plkPartner && <span className="mini-partner">PLK</span>}</strong><small>{course.address}{course.holes && <span> · {course.holes}홀</span>}</small></span><ArrowUpRight size={18}/></button>)}<p className="list-footnote">정보 출처: PLK · 카카오맵</p></section></div><GolfCourseSheet course={selected} onClose={close}/></main>;
}
