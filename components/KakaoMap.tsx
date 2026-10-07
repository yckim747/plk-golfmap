'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Map as MapIcon, LoaderCircle, Plus, Minus, Maximize2 } from 'lucide-react';
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
const CLUSTER_MIN_LEVEL = 10;
// 이름표: 클러스터가 풀리는 수준(레벨 9 이하)부터 표시
const LABEL_MAX_LEVEL = CLUSTER_MIN_LEVEL - 1;
const LABEL_MAX_WIDTH = 150;
const LABEL_PRIORITY = { partner: 0, agreement: 1, regular: 2 } as const;
// "YJC골프클럽(구,여주cc)" → "YJC골프클럽": 지도 위에서는 괄호 설명을 뺀 짧은 이름을 쓴다.
const shortName = (name: string) => name.replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').trim() || name;
const labelWidth = (text: string) => [...text].reduce((width, char) => width + (/[가-힣]/.test(char) ? 12 : 7), 14);
export default function KakaoMap({ courses, selected, onSelect }: { courses: GolfCourse[]; selected: GolfCourse | null; onSelect: (course: GolfCourse) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<kakao.maps.Map | null>(null);
  const clusterer = useRef<kakao.maps.MarkerClusterer | null>(null);
  const label = useRef<kakao.maps.CustomOverlay | null>(null);
  const selectedId = useRef<string | null>(null);
  const layoutLabels = useRef<(() => void) | null>(null);
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
      clusterer.current = new kakao.maps.MarkerClusterer({ map: map.current, averageCenter: true, minLevel: CLUSTER_MIN_LEVEL, calculator: [10, 40], styles: CLUSTER_STYLES });
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
  // 클러스터가 풀린 확대 수준에서는 핀 아래에 골프장 이름을 표시한다.
  // 이름표끼리 겹치면 제휴 → 이용협약 → 일반 순으로 우선 표시하고 나머지는 숨긴다(더 확대하면 나타남).
  useEffect(() => {
    if (status !== 'ready' || !map.current) return;
    const current = map.current;
    const entries = [...courses].sort((a, b) => LABEL_PRIORITY[markerKind(a)] - LABEL_PRIORITY[markerKind(b)]).map((course) => {
      const text = shortName(course.name);
      const content = document.createElement('div');
      content.className = `pin-label ${markerKind(course)}`;
      content.textContent = text;
      content.title = course.name;
      content.addEventListener('click', () => onSelect(course));
      const position = new kakao.maps.LatLng(course.lat, course.lng);
      return { course, position, width: Math.min(labelWidth(text), LABEL_MAX_WIDTH), overlay: new kakao.maps.CustomOverlay({ position, content, yAnchor: 0, zIndex: 1, clickable: true }), shown: false };
    });
    const layout = () => {
      const visible = current.getLevel() <= LABEL_MAX_LEVEL;
      const bounds = current.getBounds();
      const projection = current.getProjection();
      type Rect = { x1: number; x2: number; y1: number; y2: number };
      const overlaps = (a: Rect, b: Rect) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
      // 화면 안의 핀 자리(36×44, 끝이 좌표)도 장애물로 두어 다른 골프장 핀에 가려지는 이름표는 숨긴다.
      const points = new Map(visible ? entries.filter((entry) => bounds.contain(entry.position)).map((entry) => [entry.course.id, projection.containerPointFromCoords(entry.position)] as const) : []);
      const pins = [...points].map(([id, point]) => ({ id, rect: { x1: point.x - 15, x2: point.x + 15, y1: point.y - 40, y2: point.y } }));
      const placed: Rect[] = [];
      for (const entry of entries) {
        let show = false;
        const point = points.get(entry.course.id);
        if (point && entry.course.id !== selectedId.current) {
          const rect = { x1: point.x - entry.width / 2 - 2, x2: point.x + entry.width / 2 + 2, y1: point.y, y2: point.y + 24 };
          show = !placed.some((other) => overlaps(other, rect)) && !pins.some((pin) => pin.id !== entry.course.id && overlaps(pin.rect, rect));
          if (show) placed.push(rect);
        }
        if (show !== entry.shown) { entry.overlay.setMap(show ? current : null); entry.shown = show; }
      }
    };
    layoutLabels.current = layout;
    kakao.maps.event.addListener(current, 'idle', layout);
    layout();
    return () => { kakao.maps.event.removeListener(current, 'idle', layout); entries.forEach((entry) => entry.overlay.setMap(null)); layoutLabels.current = null; };
  }, [courses, onSelect, status]);
  useEffect(() => {
    selectedId.current = selected?.id ?? null;
    layoutLabels.current?.();
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
    {status !== 'ready' && <div className="map-placeholder"><div className="map-message">{status === 'loading' ? <LoaderCircle className="spin" size={28}/> : <MapIcon size={28}/>}<h2>{status === 'missing' ? '지도를 연결할 준비가 되었어요' : status === 'loading' ? '지도를 불러오는 중' : '지도 연결을 확인해 주세요'}</h2><p>{status === 'missing' ? '.env.local에 Kakao JavaScript 키를 넣으면 실제 지도가 표시됩니다. 목록에서 검색과 상세 화면은 바로 이용할 수 있어요.' : status === 'error' ? error : '잠시만 기다려 주세요.'}</p>{status === 'error' && <button className="primary-button" onClick={() => setAttempt((value) => value + 1)}>다시 연결하기</button>}</div></div>}
    <div className="map-legend" aria-hidden="true"><span><i className="dot partner"/>제휴</span><span><i className="dot agreement"/>이용협약</span><span><i className="dot regular"/>일반</span></div>
  </div>;
}
