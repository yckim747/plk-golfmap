'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FlagTriangleRight, List, LoaderCircle, LocateFixed, Map as MapIcon, RefreshCw, SearchX } from 'lucide-react';
import AppHeader from './AppHeader';
import KakaoMap from './KakaoMap';
import GolfCourseSearch from './GolfCourseSearch';
import GolfCourseFilter, { type PartnerFilter } from './GolfCourseFilter';
import GolfCourseSheet from './GolfCourseSheet';
import { markerKind } from './GolfCourseMarker';
import { regionOf, type Region } from '@/lib/region';
import type { GolfCourse } from '@/lib/types';
import { distanceKm, formatDistance, isInKorea, type MyLocation } from '@/lib/geo';
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
  const [myLocation, setMyLocation] = useState<MyLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState('');
  const [sort, setSort] = useState<'default' | 'distance'>('default');
  const searchInput = useRef<HTMLInputElement>(null);
  // 모바일: 검색 중 지도·목록을 터치하면 키보드를 내린다.
  const dismissKeyboard = useCallback(() => { if (document.activeElement === searchInput.current) searchInput.current?.blur(); }, []);
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
  // 필터 값 → 지도 핀 종류(markerKind)와 같은 기준으로 판정한다.
  const KIND_OF = { 제휴: 'partner', 이용협약: 'agreement', 일반: 'regular', 협의중: 'pending' } as const;
  const matchesKind = (course: GolfCourse, value: PartnerFilter) => value === 'all' || markerKind(course) === KIND_OF[value];
  const counts = useMemo(() => Object.fromEntries((['all', '제휴', '이용협약', '일반', '협의중'] as const).map((value) => [value, base.filter((course) => matchesKind(course, value)).length])) as Record<PartnerFilter, number>, [base]);
  // 지도에는 정렬과 무관한 필터 결과를 넘긴다(정렬을 바꿔도 지도가 다시 맞춰지지 않게).
  const filtered = useMemo(() => base.filter((course) => matchesKind(course, kind)), [base, kind]);
  // 내 위치를 알면 각 골프장까지의 거리를 계산한다.
  const distances = useMemo(() => myLocation ? new Map(courses.map((course) => [course.id, distanceKm(myLocation, course)])) : null, [courses, myLocation]);
  // 목록: 가까운 순(내 위치 기준) 또는 기본순(운영 중 → 협의중)
  const listed = useMemo(() => sort === 'distance' && distances
    ? [...filtered].sort((a, b) => distances.get(a.id)! - distances.get(b.id)!)
    : [...filtered].sort((a, b) => Number(a.status === '협의중') - Number(b.status === '협의중')), [filtered, sort, distances]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  // 내 위치 확인(HTTPS 또는 localhost에서만 동작). 찾으면 목록을 가까운 순으로 바꾼다.
  const locate = useCallback(() => {
    if (locating) return;
    if (!('geolocation' in navigator)) { setNotice('이 기기에서는 위치 확인을 지원하지 않아요.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocating(false);
      const location = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: Date.now() };
      setMyLocation(location);
      setSort('distance');
      if (!isInKorea(location)) setNotice('현재 위치가 대한민국 밖이라 주변 골프장이 없어요.');
    }, (reason) => {
      setLocating(false);
      setNotice(reason.code === reason.PERMISSION_DENIED ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 위치 접근을 허용해 주세요.' : '현재 위치를 찾지 못했어요. 잠시 후 다시 시도해 주세요.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }, [locating]);
  const sortByDistance = () => { if (myLocation) setSort('distance'); else locate(); };
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
        <section className="list-scroll" aria-label="골프장 목록" aria-busy={loading} onPointerDownCapture={dismissKeyboard}>
          {!loading && !error && <div className="list-meta"><span><span><strong>{filtered.length}</strong>개 골프장</span>{(query || kind !== 'all' || region !== 'all') && <button onClick={reset}>필터 초기화</button>}</span><span className="sort-toggle" role="group" aria-label="정렬"><button aria-pressed={sort === 'default'} className={sort === 'default' ? 'active' : ''} onClick={() => setSort('default')}>기본순</button><button aria-pressed={sort === 'distance'} className={sort === 'distance' ? 'active' : ''} onClick={sortByDistance}>{locating ? <LoaderCircle className="spin" size={13}/> : <LocateFixed size={13}/>}가까운 순</button></span></div>}
          {loading ? <div role="status" aria-label="골프장을 불러오는 중">{Array.from({ length: 7 }, (_, index) => <div key={index} className="skeleton-row"><i/><div><b/><b/></div></div>)}</div>
            : error ? <div className="list-status" role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15}/>다시 시도</button></div>
            : listed.length === 0 ? <div className="list-status"><SearchX size={28}/><p>조건에 맞는 골프장이 없어요.</p><button onClick={reset}>필터 초기화</button></div>
            : listed.map((course) => { const type = markerKind(course); const km = distances?.get(course.id); return <button key={course.id} className={`course-card ${type}${selected?.id === course.id ? ' selected' : ''}`} onClick={() => select(course)}>
                <span className={`course-icon ${type}`}><FlagTriangleRight size={18} strokeWidth={2.2}/></span>
                <span className="course-summary"><strong>{course.name}</strong><small>{km !== undefined && <b className="distance">{formatDistance(km)}</b>}{regionOf(course.address)} · {course.address}</small></span>
                {course.status || course.partnerType ? <span className={`tag ${type}`}>{course.status ?? course.partnerType}</span> : <ChevronRight size={16} className="chevron"/>}
              </button>; })}
          {!loading && !error && <p className="list-footnote">정보 출처: PLK · 카카오맵</p>}
        </section>
      </aside>
      <KakaoMap courses={filtered} selected={selected} onSelect={select} myLocation={myLocation} locating={locating} onLocate={locate} onInteract={dismissKeyboard}/>
      {notice && <div className="map-notice" role="status">{notice}</div>}
      <button className="view-toggle" onClick={() => setView(view === 'map' ? 'list' : 'map')}>{view === 'map' ? <><List size={16}/>목록 보기 <span>{filtered.length}</span></> : <><MapIcon size={16}/>지도 보기</>}</button>
    </div>
    <GolfCourseSheet course={selected} onClose={close} distance={selected && distances ? distances.get(selected.id) : undefined}/>
  </main>;
}
