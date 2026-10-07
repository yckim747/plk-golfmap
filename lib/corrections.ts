// 운영팀 수정 사항(data/corrections.json): 관리 화면에서 저장하고, 사이트 빌드 때 원본 데이터(data/golf-courses.json)에 덮어쓴다.
// 원본 데이터를 다시 만들어도(npm run data:build) 운영팀이 고친 내용은 그대로 남는다.
import type { GolfCourse } from './types';

export type CourseKind = '제휴' | '이용협약' | '일반' | '협의중';
export interface CourseEdit {
  exclude?: boolean; // 지도에서 제외
  lat?: number;
  lng?: number;
  name?: string;
  address?: string;
  phone?: string;
  homepage?: string;
  holes?: number | null;
  kind?: CourseKind;
  partnerNote?: string;
  memo?: string; // 운영 메모(지도에는 표시 안 함)
  updatedAt?: string;
}
export type ReviewDecision = '확인' | '보류';
export interface Corrections {
  updatedAt: string;
  courses: Record<string, CourseEdit>; // 골프장 ID → 수정 내용
  added: Record<string, GolfCourse>; // 검수 목록에서 지도에 다시 넣은 골프장(중복 정리·통합으로 빠졌던 곳 등)
  reviews: Record<string, { decision: ReviewDecision; at: string }>; // 검수 항목 key → 처리 결과
}
export const EMPTY_CORRECTIONS: Corrections = { updatedAt: '', courses: {}, added: {}, reviews: {} };

export function kindOf(course: GolfCourse): CourseKind {
  if (course.status === '협의중') return '협의중';
  return course.plkPartner ? course.partnerType ?? '제휴' : '일반';
}

function applyKind(course: GolfCourse, kind: CourseKind): GolfCourse {
  const next: GolfCourse = { ...course, plkPartner: kind === '제휴' || kind === '이용협약' };
  delete next.partnerType;
  delete next.status;
  if (kind === '제휴' || kind === '이용협약') next.partnerType = kind;
  if (kind === '협의중') next.status = '협의중';
  return next;
}

export function applyEdit(course: GolfCourse, edit: CourseEdit | undefined): GolfCourse {
  if (!edit) return course;
  let next: GolfCourse = { ...course };
  if (typeof edit.lat === 'number' && typeof edit.lng === 'number') { next.lat = edit.lat; next.lng = edit.lng; }
  if (edit.name !== undefined) next.name = edit.name;
  if (edit.address !== undefined) next.address = edit.address;
  if (edit.phone !== undefined) next.phone = edit.phone;
  if (edit.homepage !== undefined) next.homepage = edit.homepage;
  if (edit.holes !== undefined) next.holes = edit.holes;
  if (edit.kind) next = applyKind(next, edit.kind);
  if (edit.partnerNote !== undefined) { if (edit.partnerNote) next.partnerNote = edit.partnerNote; else delete next.partnerNote; }
  return next;
}

// 원본 + 다시 넣은 골프장 → 제외 반영 → 수정 반영
export function applyCorrections(base: GolfCourse[], corrections: Corrections): GolfCourse[] {
  const all = [...base, ...Object.values(corrections.added ?? {}).filter((course) => !base.some((item) => item.id === course.id))];
  return all.filter((course) => !corrections.courses?.[course.id]?.exclude).map((course) => applyEdit(course, corrections.courses?.[course.id]));
}

// 저장 전 확인: 좌표 범위, 필수값
export function validateEdit(edit: CourseEdit): string[] {
  const errors: string[] = [];
  if ((edit.lat !== undefined) !== (edit.lng !== undefined)) errors.push('위도와 경도는 함께 지정해야 합니다.');
  if (edit.lat !== undefined && !(edit.lat >= 33 && edit.lat <= 39 && edit.lng! >= 124 && edit.lng! <= 132)) errors.push('좌표가 대한민국 범위를 벗어났습니다.');
  if (edit.name !== undefined && !edit.name.trim()) errors.push('골프장 이름은 비울 수 없습니다.');
  if (edit.holes !== undefined && edit.holes !== null && !(Number.isInteger(edit.holes) && edit.holes > 0)) errors.push('홀 수는 양의 정수여야 합니다.');
  if (edit.homepage && !/^https?:\/\//.test(edit.homepage)) errors.push('홈페이지는 http:// 또는 https://로 시작해야 합니다.');
  return errors;
}
