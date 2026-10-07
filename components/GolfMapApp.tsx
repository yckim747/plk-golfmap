'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Flag, List, Map as MapIcon, RefreshCw, SearchX } from 'lucide-react';
import AppHeader from './AppHeader';
import KakaoMap from './KakaoMap';
import GolfCourseSearch from './GolfCourseSearch';
import GolfCourseFilter, { type PartnerFilter } from './GolfCourseFilter';
import GolfCourseSheet from './GolfCourseSheet';
import { markerKind } from './GolfCourseMarker';
import { regionOf, type Region } from '@/lib/region';
import type { GolfCourse } from '@/lib/types';
export default function GolfMapApp() {
  const [courses, setCourses] = useState<GolfCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<PartnerFilter>('all');
  const [region, setRegion] = useState<Region | 'all'>('all');
  const [selected, setSelected] = useState<GolfCourse | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [attempt, setAttempt] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/golf-courses.json`, { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error('골프장 정보를 불러오지 못했습니다.'); return response.json() as Promise<GolfCourse[]>; }).then(setCourses).catch((reason: Error) => { if (reason.name !== 'AbortError') setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  // "/" 키로 검색창에 바로 이동 (입력 중일 때는 제외)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); searchInput.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // 검색어·권역을 먼저 적용하고, 제휴 구분 버튼의 숫자는 그 결과 기준으로 보여준다.
  const base = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return courses.filter((course) => (region === 'all' || regionOf(course.address) === region) && `${course.name} ${course.address}`.toLowerCase().includes(keyword));
  }, [courses, query, region]);
  const counts = useMemo(() => ({ all: base.length, 제휴: base.filter((course) => course.partnerType === '제휴').length, 이용협약: base.filter((course) => course.partnerType === '이용협약').length }), [base]);
  const filtered = useMemo(() => kind === 'all' ? base : base.filter((course) => course.partnerType === kind), [base, kind]);
  const partners = useMemo(() => courses.filter((course) => course.plkPartner).length, [courses]);
  const select = useCallback((course: GolfCourse) => setSelected(course), []);
  const close = useCallback(() => setSelected(null), []);
  const reset = () => { setQuery(''); setKind('all'); setRegion('all'); };
  return <main className="map-shell">
    <AppHeader map>{!loading && !error && <span className="stat-pill"><b>{courses.length}</b> 골프장<i/><b className="brand-text">{partners}</b> PLK 파트너</span>}</AppHeader>
    <div className="workspace" data-view={view}>
      <aside className="panel">
        <div className="panel-top">
          <div className="panel-title"><h1>전국 골프장 지도</h1><p>PLK 제휴·이용협약 골프장을 한눈에 찾아보세요.</p></div>
          <GolfCourseSearch value={query} onChange={setQuery} inputRef={searchInput}/>
          <GolfCourseFilter kind={kind} onKind={setKind} counts={loading ? null : counts} region={region} onRegion={setRegion}/>
        </div>
        <section className="list-scroll" aria-label="골프장 목록" aria-busy={loading}>
          {!loading && !error && <div className="list-meta"><span><strong>{filtered.length}</strong>개 골프장</span>{(query || kind !== 'all' || region !== 'all') && <button onClick={reset}>필터 초기화</button>}</div>}
          {loading ? <div role="status" aria-label="골프장을 불러오는 중">{Array.from({ length: 7 }, (_, index) => <div key={index} className="skeleton-row"><i/><div><b/><b/></div></div>)}</div>
            : error ? <div className="list-status" role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15}/>다시 시도</button></div>
            : filtered.length === 0 ? <div className="list-status"><SearchX size={28}/><p>조건에 맞는 골프장이 없어요.</p><button onClick={reset}>필터 초기화</button></div>
            : filtered.map((course) => { const type = markerKind(course); return <button key={course.id} className={`course-card${selected?.id === course.id ? ' selected' : ''}`} onClick={() => select(course)}>
                <span className={`course-icon ${type}`}>{type === 'regular' ? <Flag size={17}/> : 'P'}</span>
                <span className="course-summary"><strong>{course.name}</strong><small>{regionOf(course.address)} · {course.address}</small></span>
                {course.partnerType ? <span className={`tag ${type}`}>{course.partnerType}</span> : <ChevronRight size={16} className="chevron"/>}
              </button>; })}
          {!loading && !error && <p className="list-footnote">정보 출처: PLK · 카카오맵</p>}
        </section>
      </aside>
      <KakaoMap courses={filtered} selected={selected} onSelect={select}/>
      <button className="view-toggle" onClick={() => setView(view === 'map' ? 'list' : 'map')}>{view === 'map' ? <><List size={16}/>목록 보기 <span>{filtered.length}</span></> : <><MapIcon size={16}/>지도 보기</>}</button>
    </div>
    <GolfCourseSheet course={selected} onClose={close}/>
  </main>;
}
