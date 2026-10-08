// 검수 목록(data/review.json): `npm run data:build`가 만들고, 관리 화면에서 하나씩 확인·보류·지도 반영한다.
import type { GolfCourse } from './types';

export type ReviewType = 'undisclosed' | 'moved' | 'unlinked' | 'nearby' | 'merged' | 'duplicate' | 'unlocated';
export const REVIEW_LABELS: Record<ReviewType, string> = {
  undisclosed: '공개 불가 → 일반으로 표시',
  moved: '위치 수정됨(마스터 좌표 오차)',
  unlinked: '카카오 장소 미연결',
  nearby: '신규 · 3km 안 기존 골프장',
  merged: '이름만 다른 동일 골프장으로 통합',
  duplicate: '같은 자리 중복으로 제외',
  unlocated: '공공데이터 위치 확인 불가',
};
export interface ReviewItem {
  key: string; // 처리 결과를 저장하는 고유 키(type:id)
  type: ReviewType;
  courseId?: string; // 지도에 있는 골프장이면 그 ID
  title: string;
  detail: string;
  candidate?: GolfCourse; // 지도에 없는 골프장(통합·제외·위치 불명)을 다시 넣을 때 쓰는 정보
}
export interface ReviewData { generatedAt: string; items: ReviewItem[] }
