// 관리 화면 파일 내려받기: 수정 파일(JSON), 전체 골프장 목록 CSV, 검수 목록 CSV. CSV는 엑셀에서 한글이 깨지지 않게 BOM을 붙인다.
import { kindOf, type Corrections } from '@/lib/corrections';
import { regionOf } from '@/lib/region';
import { REVIEW_LABELS, type ReviewItem } from '@/lib/review';
import type { GolfCourse } from '@/lib/types';

export function downloadText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (value: unknown) => { const text = value === null || value === undefined ? '' : String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
const toCsv = (header: string[], rows: unknown[][]) => '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
export const today = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');

// 전체 목록: 지도에 보이는 골프장 + 제외한 골프장(상태 '제외')
export function coursesCsv(all: GolfCourse[], corrections: Corrections): string {
  return toCsv(['ID', '골프장명', '구분', '권역', '주소', '위도', '경도', '홀수', '전화', '홈페이지', '카카오맵', '혜택 문구', '운영 메모', '상태'], all.map((course) => {
    const edit = corrections.courses[course.id];
    const state = edit?.exclude ? '지도 제외' : corrections.added[course.id] ? '다시 넣음' : edit ? '수정됨' : '';
    return [course.id, course.name, kindOf(course), regionOf(course.address), course.address, course.lat, course.lng, course.holes ?? '', course.phone, course.homepage, course.kakaoPlaceUrl ?? '', course.partnerNote ?? '', edit?.memo ?? '', state];
  }));
}

export function reviewCsv(items: ReviewItem[], corrections: Corrections): string {
  return toCsv(['검수 항목', '골프장', '내용', '처리', '처리 일시', '관련 골프장 ID'], items.map((item) => {
    const decision = corrections.reviews[item.key];
    const added = item.candidate && corrections.added[item.candidate.id] ? '지도에 다시 넣음' : '';
    return [REVIEW_LABELS[item.type], item.title, item.detail, added || decision?.decision || '미처리', decision?.at ?? '', item.courseId ?? ''];
  }));
}
