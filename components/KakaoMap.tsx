'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Map, LoaderCircle, Plus, Minus, Maximize2 } from 'lucide-react';
import type { GolfCourse } from '@/lib/types';
import { markerImageUrl, markerKind } from './GolfCourseMarker';
let sdkPromise: Promise<void> | null = null;
function loadSdk(key: string): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(() => { script.remove(); reject(new Error('지도 연결 시간이 초과되었습니다.')); }, 15000);
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=clusterer`;
    script.onload = () => { if (!window.kakao?.maps) { clearTimeout(timer); reject(new Error('Kakao 키와 등록 도메인을 확인해 주세요.')); return; } window.kakao.maps.load(() => { clearTimeout(timer); resolve(); }); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('지도를 불러오지 못했습니다. 네트워크와 Kakao 설정을 확인해 주세요.')); };
    document.head.appendChild(script);
  }).catch((error) => { sdkPromise = null; throw error; });
  return sdkPromise;
}
// 클러스터: 개수에 따라 3단계 크기의 브랜드 그린 원
const clusterStyle = (size: number, font: number) => ({ width: `${size}px`, height: `${size}px`, lineHeight: `${size}px`, borderRadius: '50%', background: 'rgba(7,148,85,.92)', color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: `${font}px`, fontFamily: 'Pretendard Variable, Pretendard, sans-serif', boxShadow: '0 0 0 6px rgba(16,178,108,.22), 0 4px 12px rgba(11,18,32,.25)' });
const CLUSTER_STYLES = [clusterStyle(36, 13), clusterStyle(46, 14), clusterStyle(58, 16)];
export default function KakaoMap({ courses, selected, onSelect }: { courses: GolfCourse[]; selected: GolfCourse | null; onSelect: (course: GolfCourse) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<kakao.maps.Map | null>(null);
  const clusterer = useRef<kakao.maps.MarkerClusterer | null>(null);
  const label = useRef<kakao.maps.CustomOverlay | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY;
    if (!key) { setStatus('missing'); return; }
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    setStatus('loading');
    loadSdk(key).then(() => {
      if (cancelled || !container.current) return;
      map.current = new kakao.maps.Map(container.current, { center: new kakao.maps.LatLng(36.2, 127.7), level: 13 });
      clusterer.current = new kakao.maps.MarkerClusterer({ map: map.current, averageCenter: true, minLevel: 10, calculator: [10, 40], styles: CLUSTER_STYLES });
      observer = new ResizeObserver(() => map.current?.relayout());
      observer.observe(container.current);
      setStatus('ready');
    }).catch((reason: Error) => { if (!cancelled) { setError(reason.message); setStatus('error'); } });
    return () => { cancelled = true; observer?.disconnect(); clusterer.current?.clear(); label.current?.setMap(null); clusterer.current = null; map.current = null; };
  }, [attempt]);
  const fitAll = useCallback(() => {
    if (!map.current || !courses.length) return;
    const bounds = new kakao.maps.LatLngBounds();
    courses.forEach((course) => bounds.extend(new kakao.maps.LatLng(course.lat, course.lng)));
    map.current.setBounds(bounds, 40, 40, 40, 40);
  }, [courses]);
  useEffect(() => {
    if (status !== 'ready' || !map.current || !clusterer.current) return;
    const listeners: { marker: kakao.maps.Marker; click: () => void }[] = [];
    const markers = courses.map((course) => {
      const kind = markerKind(course);
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(course.lat, course.lng), title: course.name, zIndex: kind === 'regular' ? 1 : 2, image: new kakao.maps.MarkerImage(markerImageUrl(kind), new kakao.maps.Size(36, 44), { offset: new kakao.maps.Point(18, 42) }) });
      const click = () => onSelect(course);
      kakao.maps.event.addListener(marker, 'click', click);
      listeners.push({ marker, click });
      return marker;
    });
    clusterer.current.clear(); clusterer.current.addMarkers(markers);
    fitAll();
    return () => { listeners.forEach(({ marker, click }) => kakao.maps.event.removeListener(marker, 'click', click)); clusterer.current?.clear(); };
  }, [courses, onSelect, status, fitAll]);
  useEffect(() => {
    label.current?.setMap(null);
    if (!selected || !map.current || status !== 'ready') return;
    const position = new kakao.maps.LatLng(selected.lat, selected.lng);
    const content = document.createElement('div');
    content.className = 'map-label';
    content.textContent = selected.name;
    label.current = new kakao.maps.CustomOverlay({ position, content, yAnchor: 1, zIndex: 5 });
    label.current.setMap(map.current);
    map.current.setLevel(6);
    map.current.panTo(position);
  }, [selected, status]);
  const zoom = (delta: number) => map.current?.setLevel(map.current.getLevel() + delta, { animate: true });
  return <div className="map-stage">
    <div ref={container} className="kakao-canvas" aria-label="대한민국 골프장 지도"/>
    {status === 'ready' && <div className="map-controls"><div className="control-group"><button onClick={() => zoom(-1)} aria-label="확대"><Plus size={18}/></button><button onClick={() => zoom(1)} aria-label="축소"><Minus size={18}/></button></div><div className="control-group"><button onClick={fitAll} aria-label="전체 골프장 보기" title="전체 보기"><Maximize2 size={16}/></button></div></div>}
    {status !== 'ready' && <div className="map-placeholder"><div className="map-message">{status === 'loading' ? <LoaderCircle className="spin" size={28}/> : <Map size={28}/>}<h2>{status === 'missing' ? '지도를 연결할 준비가 되었어요' : status === 'loading' ? '지도를 불러오는 중' : '지도 연결을 확인해 주세요'}</h2><p>{status === 'missing' ? '.env.local에 Kakao JavaScript 키를 넣으면 실제 지도가 표시됩니다. 목록에서 검색과 상세 화면은 바로 이용할 수 있어요.' : status === 'error' ? error : '잠시만 기다려 주세요.'}</p>{status === 'error' && <button className="primary-button" onClick={() => setAttempt((value) => value + 1)}>다시 연결하기</button>}</div></div>}
    <div className="map-legend" aria-hidden="true"><span><i className="dot partner"/>제휴</span><span><i className="dot agreement"/>이용협약</span><span><i className="dot regular"/>일반</span></div>
  </div>;
}
