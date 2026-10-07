import 'server-only';
import courses from '@/data/golf-courses.json';
import correctionsFile from '@/data/corrections.json';
import reviewFile from '@/data/review.json';
import { applyCorrections, EMPTY_CORRECTIONS, type Corrections } from './corrections';
import type { ReviewData } from './review';
import type { GolfCourse } from './types';

// data/golf-courses.json: `npm run data:build`가 운영팀 마스터 + 공공데이터 + 카카오를 병합해 생성한 원본
// data/corrections.json: 운영팀이 관리 화면(/admin)에서 고친 내용 — 빌드 때 원본에 덮어쓴다
export const baseCourses = courses as GolfCourse[];
export const corrections: Corrections = { ...EMPTY_CORRECTIONS, ...(correctionsFile as Partial<Corrections>) };
export const review = reviewFile as ReviewData;

export async function getGolfCourses(): Promise<GolfCourse[]> {
  return applyCorrections(baseCourses, corrections);
}
