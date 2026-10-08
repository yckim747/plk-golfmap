'use client';
import { useEffect, useRef } from 'react';
import { X, MapPin, Phone, Globe, ArrowUpRight, Gift, Map, Navigation, Clock, Share2, Star } from 'lucide-react';
import type { GolfCourse } from '@/lib/types';
import { regionOf } from '@/lib/region';
import { formatDistance } from '@/lib/geo';
import { markerKind } from './GolfCourseMarker';
const KIND_LABEL = { partner: 'PLK 제휴', agreement: 'PLK 이용협약', regular: '일반 골프장', pending: '협의중' } as const;
export default function GolfCourseSheet({ course, onClose, distance, favorite, onToggleFavorite, onShare }: { course: GolfCourse | null; onClose: () => void; distance?: number; favorite: boolean; onToggleFavorite: (course: GolfCourse) => void; onShare: (course: GolfCourse) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (course) dialog.current?.showModal(); else dialog.current?.close(); }, [course]);
  const kind = course ? markerKind(course) : 'regular';
  return <dialog ref={dialog} className="course-dialog" aria-labelledby="course-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="sheet-content">{course && <>
    <div className="sheet-handle"/>
    <div className="sheet-top"><div className="tags"><span className={`tag ${kind}`}>{KIND_LABEL[kind]}</span></div><div className="sheet-tools">
      <button className={`icon-button fav-toggle${favorite ? ' active' : ''}`} onClick={() => onToggleFavorite(course)} aria-pressed={favorite} aria-label={favorite ? '관심 해제' : '관심 골프장에 추가'} title="관심 골프장"><Star size={18}/></button>
      <button className="icon-button" onClick={() => onShare(course)} aria-label="이 골프장 링크 공유" title="링크 공유"><Share2 size={17}/></button>
      <button className="icon-button" onClick={onClose} aria-label="골프장 상세 닫기"><X size={18}/></button>
    </div></div>
    <h2 id="course-title">{course.name}</h2>
    <p className="sheet-address"><MapPin size={15}/><span>{course.address}{distance !== undefined && <b className="distance"> · 내 위치에서 {formatDistance(distance)}</b>}</span></p>
    <dl className="info-grid"><div><dt>권역</dt><dd>{regionOf(course.address)}</dd></div><div><dt>홀</dt><dd>{course.holes ? `${course.holes}홀` : '–'}</dd></div><div><dt>구분</dt><dd>{course.status ?? course.partnerType ?? '일반'}</dd></div></dl>
    {kind === 'pending' && <p className="pending-note"><Clock size={16}/>PLK 제휴 정보가 아직 없거나 공개되지 않은 골프장입니다. 이용 조건은 골프장에 직접 확인해 주세요.</p>}
    {course.partnerNote && <p className="partner-note"><Gift size={16}/>{course.partnerNote}</p>}
    <a className="primary-button" href={`https://map.kakao.com/link/to/${encodeURIComponent(course.name)},${course.lat},${course.lng}`} target="_blank" rel="noopener noreferrer"><Navigation size={17}/>길찾기</a>
    <div className="action-grid">
      {course.phone ? <a href={`tel:${course.phone}`}><Phone size={18}/><span>전화</span></a> : <span aria-disabled="true"><Phone size={18}/><span>전화 없음</span></span>}
      {course.homepage ? <a href={course.homepage} target="_blank" rel="noopener noreferrer"><Globe size={18}/><span>홈페이지</span></a> : <span aria-disabled="true"><Globe size={18}/><span>홈페이지 없음</span></span>}
      {course.kakaoPlaceUrl ? <a href={course.kakaoPlaceUrl} target="_blank" rel="noopener noreferrer"><Map size={18}/><span>카카오맵 <ArrowUpRight size={12}/></span></a> : <span aria-disabled="true"><Map size={18}/><span>카카오맵 없음</span></span>}
    </div>
    {course.phone && <p className="sheet-phone">{course.phone}</p>}
    <p className="sheet-note">정보 출처: PLK · 카카오맵. 운영 정보는 골프장에 확인해 주세요.</p>
  </>}</div></dialog>;
}
