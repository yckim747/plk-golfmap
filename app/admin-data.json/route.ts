import { baseCourses, corrections, review } from '@/lib/golfCourses';
// 관리 화면(/admin)용: 수정 전 원본, 배포된 수정 사항, 검수 목록. 빌드 시 out/admin-data.json 정적 파일로 생성된다.
export const dynamic = 'force-static';
export async function GET() {
  return Response.json({ base: baseCourses, corrections, review });
}
