'use client';
import { useEffect, useRef, useState } from 'react';
import { Map, LoaderCircle } from 'lucide-react';
import type { GolfCourse } from '@/lib/types';
import { markerImageUrl } from './GolfCourseMarker';
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
export default function KakaoMap({ courses, selected, onSelect }: { courses: GolfCourse[]; selected: GolfCourse | null; onSelect: (course: GolfCourse) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<kakao.maps.Map | null>(null);
  const clusterer = useRef<kakao.maps.MarkerClusterer | null>(null);
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
      clusterer.current = new kakao.maps.MarkerClusterer({ map: map.current, averageCenter: true, minLevel: 10 });
      observer = new ResizeObserver(() => map.current?.relayout());
      observer.observe(container.current);
      setStatus('ready');
    }).catch((reason: Error) => { if (!cancelled) { setError(reason.message); setStatus('error'); } });
    return () => { cancelled = true; observer?.disconnect(); clusterer.current?.clear(); clusterer.current = null; map.current = null; };
  }, [attempt]);
  useEffect(() => {
    if (status !== 'ready' || !map.current || !clusterer.current) return;
    const listeners: { marker: kakao.maps.Marker; click: () => void }[] = [];
    const markers = courses.map((course) => {
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(course.lat, course.lng), title: course.name, image: new kakao.maps.MarkerImage(markerImageUrl(course.plkPartner), new kakao.maps.Size(42, 50), { offset: new kakao.maps.Point(21, 48) }) });
      const click = () => onSelect(course);
      kakao.maps.event.addListener(marker, 'click', click);
      listeners.push({ marker, click });
      return marker;
    });
    clusterer.current.clear(); clusterer.current.addMarkers(markers);
    if (courses.length) { const bounds = new kakao.maps.LatLngBounds(); courses.forEach((course) => bounds.extend(new kakao.maps.LatLng(course.lat, course.lng))); map.current.setBounds(bounds); }
    return () => { listeners.forEach(({ marker, click }) => kakao.maps.event.removeListener(marker, 'click', click)); clusterer.current?.clear(); };
  }, [courses, onSelect, status]);
  useEffect(() => { if (selected && map.current && status === 'ready') { map.current.setLevel(6); map.current.panTo(new kakao.maps.LatLng(selected.lat, selected.lng)); } }, [selected, status]);
  return <div className="map-stage"><div ref={container} className="kakao-canvas" aria-label="대한민국 골프장 지도"/>{status !== 'ready' && <div className="map-placeholder"><div className="map-grid"/><div className="map-message">{status === 'loading' ? <LoaderCircle className="spin" size={32}/> : <Map size={34}/>}<h2>{status === 'missing' ? '지도를 연결할 준비가 되었어요' : status === 'loading' ? '골프장 지도를 펼치는 중' : '지도 연결을 확인해 주세요'}</h2><p>{status === 'missing' ? '.env.local에 Kakao JavaScript 키를 넣으면 실제 지도가 표시됩니다. 아래 목록에서 검색과 상세 화면은 바로 이용할 수 있어요.' : status === 'error' ? error : '잠시만 기다려 주세요.'}</p>{status === 'error' && <button className="primary-button" onClick={() => setAttempt((value) => value + 1)}>다시 연결하기</button>}</div></div>}<div className="map-legend"><span><i className="legend-partner"/>PLK 제휴</span><span><i/>일반</span></div></div>;
}
