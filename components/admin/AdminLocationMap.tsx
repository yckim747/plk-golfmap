'use client';
import { useEffect, useRef, useState } from 'react';
import { loadSdk } from '../KakaoMap';
import { markerImageUrl, type MarkerKind } from '../GolfCourseMarker';

// 위치 지정용 지도: 핀을 끌거나 지도를 눌러 위치를 정한다. 다른 골프장을 고르면 그 위치로 이동한다.
export default function AdminLocationMap({ courseId, lat, lng, kind, onChange }: { courseId: string; lat: number; lng: number; kind: MarkerKind; onChange: (lat: number, lng: number) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<kakao.maps.Map | null>(null);
  const marker = useRef<kakao.maps.Marker | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY;
    if (!key) { setError('Kakao JavaScript 키가 없어 지도를 표시할 수 없어요. 위도·경도를 직접 입력해 주세요.'); return; }
    let cancelled = false;
    loadSdk(key).then(() => {
      if (cancelled || !container.current) return;
      const has = lat !== 0 && lng !== 0;
      const center = new kakao.maps.LatLng(has ? lat : 36.3, has ? lng : 127.8);
      map.current = new kakao.maps.Map(container.current, { center, level: has ? 4 : 12 });
      map.current.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT);
      marker.current = new kakao.maps.Marker({ position: center, draggable: true, map: has ? map.current : undefined });
      kakao.maps.event.addListener(marker.current, 'dragend', () => { const position = marker.current!.getPosition(); change.current(position.getLat(), position.getLng()); });
      kakao.maps.event.addListener(map.current, 'click', (event: kakao.maps.event.MouseEvent) => { marker.current!.setMap(map.current); marker.current!.setPosition(event.latLng); change.current(event.latLng.getLat(), event.latLng.getLng()); });
      setReady(true);
    }).catch((reason: Error) => setError(reason.message));
    return () => { cancelled = true; };
    // 지도는 한 번만 만든다. 골프장 변경은 아래 효과에서 처리한다.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 다른 골프장을 고르면 그 위치로 이동(같은 골프장에서 핀을 옮길 때는 지도를 움직이지 않음)
  useEffect(() => {
    if (!ready || !map.current || !marker.current) return;
    const has = lat !== 0 && lng !== 0;
    const position = new kakao.maps.LatLng(has ? lat : 36.3, has ? lng : 127.8);
    marker.current.setMap(has ? map.current : null);
    marker.current.setPosition(position);
    map.current.setLevel(has ? 4 : 12);
    map.current.setCenter(position);
  }, [courseId, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !marker.current || (lat === 0 && lng === 0)) return;
    marker.current.setImage(new kakao.maps.MarkerImage(markerImageUrl(kind), new kakao.maps.Size(36, 44), { offset: new kakao.maps.Point(18, 42) }));
    marker.current.setPosition(new kakao.maps.LatLng(lat, lng));
    marker.current.setMap(map.current);
  }, [lat, lng, kind, ready]);
  return <div className="admin-map">{error ? <p className="admin-map-error">{error}</p> : <div ref={container} className="admin-map-canvas" aria-label="위치 지정 지도: 핀을 끌거나 지도를 눌러 위치를 정하세요"/>}</div>;
}
