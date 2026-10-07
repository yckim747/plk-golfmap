import 'server-only';
import courses from '@/data/golf-courses.json';
import type { GolfCourse } from './types';

// data/golf-courses.json은 `npm run data:build`가 PLK CSV와 카카오 로컬 API를 병합해 생성한다.
export async function getGolfCourses(): Promise<GolfCourse[]> {
  return courses as GolfCourse[];
}
