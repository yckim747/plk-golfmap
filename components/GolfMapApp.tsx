'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FlagTriangleRight, List, LoaderCircle, LocateFixed, Map as MapIcon, RefreshCw, SearchX, Share2, Star } from 'lucide-react';
import AppHeader from './AppHeader';
import KakaoMap, { type MapBounds } from './KakaoMap';
import GolfCourseSearch from './GolfCourseSearch';
import GolfCourseFilter, { type PartnerFilter } from './GolfCourseFilter';
import GolfCourseSheet from './GolfCourseSheet';
import { markerKind } from './GolfCourseMarker';
import { useSpeechSearch } from './useSpeechSearch';
import { useFavorites } from './useFavorites';
import { regionOf, type Region } from '@/lib/region';
import { describeParsed, parseSearchQuery } from '@/lib/searchQuery';
import { buildViewSearch, readViewParams, shareLink } from '@/lib/share';
import type { GolfCourse } from '@/lib/types';
import { distanceKm, formatDistance, isInKorea, type MyLocation } from '@/lib/geo';

const inBounds = (course: GolfCourse, bounds: MapBounds) => course.lat >= bounds.south && course.lat <= bounds.north && course.lng >= bounds.west && course.lng <= bounds.east;

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
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [areaOnly, setAreaOnly] = useState(true);
  const [favOnly, setFavOnly] = useState(false);
  const { favorites, toggle: toggleFavorite } = useFavorites();
  const urlReady = useRef(false);
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
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);

  // 검색 문장 해석: "강원도 제휴 골프장" → 권역·구분 조건 + 남은 검색어. 입력 중에도 바로 결과에 반영한다.
  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const effectiveRegion = region !== 'all' ? region : parsed.region ?? 'all';
  const effectiveKind: PartnerFilter = kind !== 'all' ? kind : parsed.kind ?? 'all';
  // 검색어·권역·관심을 먼저 적용하고, 제휴 구분 버튼의 숫자는 그 결과 기준으로 보여준다. 검색어는 단어마다 이름·주소에 있어야 한다.
  const base = useMemo(() => {
    const keywords = parsed.keywords.map((keyword) => keyword.replace(/\s+/g, ''));
    return courses.filter((course) => {
      if (favOnly && !favorites.has(course.id)) return false;
      if (effectiveRegion !== 'all' && regionOf(course.address) !== effectiveRegion) return false;
      const text = `${course.name}${course.address}`.toLowerCase().replace(/\s+/g, '');
      return keywords.every((keyword) => text.includes(keyword));
    });
  }, [courses, parsed, effectiveRegion, favOnly, favorites]);
  // 필터 값 → 지도 핀 종류(markerKind)와 같은 기준으로 판정한다.
  const KIND_OF = { 제휴: 'partner', 이용협약: 'agreement', 일반: 'regular', 협의중: 'pending' } as const;
  const matchesKind = (course: GolfCourse, value: PartnerFilter) => value === 'all' || markerKind(course) === KIND_OF[value];
  const counts = useMemo(() => Object.fromEntries((['all', '제휴', '이용협약', '일반', '협의중'] as const).map((value) => [value, base.filter((course) => matchesKind(course, value)).length])) as Record<PartnerFilter, number>, [base]);
  // 지도에는 정렬·영역과 무관한 필터 결과를 넘긴다(목록 조작으로 지도가 다시 맞춰지지 않게).
  const filtered = useMemo(() => base.filter((course) => matchesKind(course, effectiveKind)), [base, effectiveKind]);
  // 내 위치를 알면 각 골프장까지의 거리를 계산한다.
  const distances = useMemo(() => myLocation ? new Map(courses.map((course) => [course.id, distanceKm(myLocation, course)])) : null, [courses, myLocation]);
  // 목록: 지도에 보이는 영역만(켜져 있을 때) → 가까운 순 또는 기본순(운영 중 → 협의중)
  // 지도가 가려진 상태(모바일 목록 보기)에서 계산된 영역은 크기가 0이라 쓰지 않는다.
  const usableBounds = bounds && bounds.north - bounds.south > 1e-5 ? bounds : null;
  const areaActive = areaOnly && !!usableBounds;
  const inArea = useMemo(() => areaActive ? filtered.filter((course) => inBounds(course, usableBounds!)) : filtered, [filtered, areaActive, usableBounds]);
  const listed = useMemo(() => sort === 'distance' && distances
    ? [...inArea].sort((a, b) => distances.get(a.id)! - distances.get(b.id)!)
    : [...inArea].sort((a, b) => Number(a.status === '협의중') - Number(b.status === '협의중')), [inArea, sort, distances]);

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
  // 검색 확정(검색 키·음성 인식 완료): 해석한 권역·구분을 필터 버튼으로 옮기고, "가까운"이면 가까운 순으로 바꾼다.
  const applySearch = (text: string) => {
    const result = parseSearchQuery(text);
    if (result.region) setRegion(result.region);
    if (result.kind) setKind(result.kind);
    setQuery(result.keywords.join(' '));
    if (result.nearby) sortByDistance();
    const summary = describeParsed(result);
    if (result.region || result.kind || result.nearby) setNotice(`${summary} 조건으로 찾았어요.`);
  };
  const voice = useSpeechSearch({ onInterim: setQuery, onFinal: applySearch, onError: setNotice });

  // 공유 링크: 처음 열 때 주소의 조건(?region=강원&kind=제휴, ?course=ID 등)을 적용하고, 이후 조건이 바뀌면 주소도 맞춘다.
  useEffect(() => {
    if (urlReady.current || loading || error) return;
    urlReady.current = true;
    const params = readViewParams(window.location.search);
    if (params.q) setQuery(params.q);
    if (params.region) setRegion(params.region);
    if (params.kind) setKind(params.kind);
    if (params.view) setView(params.view);
    if (params.fav) setFavOnly(true);
    if (params.sort === 'distance') locate();
    if (params.course) {
      const course = courses.find((item) => item.id === params.course);
      if (course) setSelected(course); else setNotice('공유된 골프장을 찾지 못했어요. 정보가 바뀌었을 수 있어요.');
    }
  }, [loading, error, courses, locate]);
  const viewSearch = buildViewSearch({ q: query, region, kind: kind === 'all' ? 'all' : kind, sort, course: selected?.id ?? null, view, fav: favOnly });
  useEffect(() => {
    if (!urlReady.current) return;
    window.history.replaceState(null, '', `${window.location.pathname}${viewSearch}`);
  }, [viewSearch]);
  const shareUrl = (search: string) => `${window.location.origin}${window.location.pathname}${search}`;
  const shareView = async () => { const message = await shareLink(shareUrl(buildViewSearch({ q: query, region, kind, sort, view, fav: false, course: null })), 'PLK 골프장 지도'); if (message) setNotice(message); };
  const shareCourse = async (course: GolfCourse) => { const message = await shareLink(shareUrl(buildViewSearch({ course: course.id })), `${course.name} | PLK 골프장 지도`); if (message) setNotice(message); };
  const onToggleFavorite = (course: GolfCourse) => setNotice(toggleFavorite(course.id) ? `${course.name}을(를) 관심 골프장에 추가했어요.` : '관심 골프장에서 뺐어요.');

  const partners = useMemo(() => courses.filter((course) => course.plkPartner).length, [courses]);
  const select = useCallback((course: GolfCourse) => setSelected(course), []);
  const close = useCallback(() => setSelected(null), []);
  const reset = () => { setQuery(''); setKind('all'); setRegion('all'); setFavOnly(false); };
  const hasFilter = !!query || kind !== 'all' || region !== 'all' || favOnly;
  return <main className="map-shell">
    <AppHeader map>{!loading && !error && <><span className="stat-pill"><b>{courses.length}</b> 골프장<i/><b className="brand-text">{partners}</b> PLK 파트너</span><button className="icon-button" onClick={shareView} aria-label="지금 보는 조건으로 링크 공유" title="링크 공유"><Share2 size={17}/></button></>}</AppHeader>
    <div className="workspace" data-view={view}>
      <aside className="panel">
        <div className="panel-top">
          <div className="panel-title"><h1>전국 골프장 지도</h1><p>PLK 제휴·이용협약 골프장을 한눈에 찾아보세요.</p></div>
          <GolfCourseSearch value={query} onChange={setQuery} onSubmit={applySearch} inputRef={searchInput} voice={voice}/>
          <GolfCourseFilter kind={effectiveKind} onKind={setKind} counts={loading ? null : counts} region={effectiveRegion} onRegion={setRegion} favorite={{ active: favOnly, count: favorites.size, onToggle: () => setFavOnly((value) => !value) }}/>
        </div>
        <section className="list-scroll" aria-label="골프장 목록" aria-busy={loading} onPointerDownCapture={dismissKeyboard}>
          {!loading && !error && <div className="list-meta">
            <span>
              <span>{areaActive && inArea.length < filtered.length ? <>이 지역 <strong>{inArea.length}</strong>곳</> : <><strong>{filtered.length}</strong>개 골프장</>}</span>
              {areaActive && inArea.length < filtered.length ? <button onClick={() => setAreaOnly(false)}>전체 {filtered.length}곳 보기</button> : !areaOnly && <button onClick={() => setAreaOnly(true)}>지도 영역만</button>}
              {hasFilter && <button onClick={reset}>필터 초기화</button>}
            </span>
            <span className="sort-toggle" role="group" aria-label="정렬"><button aria-pressed={sort === 'default'} className={sort === 'default' ? 'active' : ''} onClick={() => setSort('default')}>기본순</button><button aria-pressed={sort === 'distance'} className={sort === 'distance' ? 'active' : ''} onClick={sortByDistance}>{locating ? <LoaderCircle className="spin" size={13}/> : <LocateFixed size={13}/>}가까운 순</button></span>
          </div>}
          {loading ? <div role="status" aria-label="골프장을 불러오는 중">{Array.from({ length: 7 }, (_, index) => <div key={index} className="skeleton-row"><i/><div><b/><b/></div></div>)}</div>
            : error ? <div className="list-status" role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15}/>다시 시도</button></div>
            : listed.length === 0 ? <div className="list-status"><SearchX size={28}/><p>{favOnly && !favorites.size ? '관심 골프장이 아직 없어요. 골프장의 ☆를 눌러 추가해 보세요.' : areaActive && filtered.length ? '지금 지도 영역에는 골프장이 없어요.' : '조건에 맞는 골프장이 없어요.'}</p>{areaActive && filtered.length ? <button onClick={() => setAreaOnly(false)}>전체 {filtered.length}곳 보기</button> : <button onClick={reset}>필터 초기화</button>}</div>
            : listed.map((course) => { const type = markerKind(course); const km = distances?.get(course.id); const favorite = favorites.has(course.id); return <div key={course.id} className="course-item">
                <button className={`course-card ${type}${selected?.id === course.id ? ' selected' : ''}`} onClick={() => select(course)}>
                  <span className={`course-icon ${type}`}><FlagTriangleRight size={18} strokeWidth={2.2}/></span>
                  <span className="course-summary"><strong>{course.name}</strong><small>{km !== undefined && <b className="distance">{formatDistance(km)}</b>}{regionOf(course.address)} · {course.address}</small></span>
                  {course.status || course.partnerType ? <span className={`tag ${type}`}>{course.status ?? course.partnerType}</span> : <ChevronRight size={16} className="chevron"/>}
                </button>
                <button className={`fav-toggle${favorite ? ' active' : ''}`} aria-pressed={favorite} aria-label={favorite ? `${course.name} 관심 해제` : `${course.name} 관심 골프장에 추가`} onClick={() => onToggleFavorite(course)}><Star size={16}/></button>
              </div>; })}
          {!loading && !error && <p className="list-footnote">정보 출처: PLK · 카카오맵 · 공공데이터포털</p>}
        </section>
      </aside>
      <KakaoMap courses={filtered} selected={selected} onSelect={select} myLocation={myLocation} locating={locating} onLocate={locate} onInteract={dismissKeyboard} onBoundsChange={setBounds}/>
      {notice && <div className="map-notice" role="status">{notice}</div>}
      <button className="view-toggle" onClick={() => setView(view === 'map' ? 'list' : 'map')}>{view === 'map' ? <><List size={16}/>목록 보기 <span>{inArea.length}</span></> : <><MapIcon size={16}/>지도 보기</>}</button>
    </div>
    <GolfCourseSheet course={selected} onClose={close} distance={selected && distances ? distances.get(selected.id) : undefined} favorite={!!selected && favorites.has(selected.id)} onToggleFavorite={onToggleFavorite} onShare={shareCourse}/>
  </main>;
}
