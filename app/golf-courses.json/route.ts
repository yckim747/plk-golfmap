import { getGolfCourses } from '@/lib/golfCourses';
// 빌드 시 out/golf-courses.json 정적 파일로 생성된다 (dev 서버에서는 /golf-courses.json으로 응답).
export const dynamic = 'force-static';
export async function GET() {
  return Response.json(await getGolfCourses());
}
