// 전국 골프장 엑셀: 전체 / 신규(운영팀 마스터 형식) / 요약 3개 시트
import ExcelJS from 'exceljs';
import { REGIONS, regionOf } from '../../lib/region';
import type { GolfCourse } from '../../lib/types';
import { toMasterRow } from './national';
import { distanceKm } from '../../lib/geo';

export interface CourseMeta { source: 'PLK 마스터' | '공공데이터' | '카카오'; licenseNo: string; businessStatus: string; note: string }
const KIND = (course: GolfCourse) => course.status ?? course.partnerType ?? '일반';
const FILL: Record<string, string> = { 제휴: 'FFE7F8EF', 이용협약: 'FFEEEEFE', 협의중: 'FFF2F4F7' };
const ASSOCIATION_COUNT = 527; // 한국골프장경영협회, 2026.1.1 기준 운영 중

function styleHeader(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

export interface AuditInput {
  coordSources: Map<string, string>; // 골프장 ID → 위치 근거(카카오 장소 / 공공데이터 인허가 / 마스터 좌표 / 주소 좌표 / 보정 CSV)
  masterPoints: Map<string, { lat: number; lng: number }>; // 운영팀 마스터 원본 좌표
  unlocatedPublic: { name: string; address: string; status: string }[]; // 위치를 확인하지 못한 공공데이터 골프장
  duplicates: { removedId: string; removedName: string; keptId: string; keptName: string; km: number; action: string }[]; // 같은 자리 중복 정리
}

// 검수 시트: 위치를 옮긴 골프장(마스터 좌표 대비 이동 거리), 카카오 장소 연결이 없는 골프장, 위치 확인 불가 공공데이터
function addAuditSheet(book: ExcelJS.Workbook, courses: GolfCourse[], meta: Map<string, CourseMeta>, audit: AuditInput) {
  const sheet = book.addWorksheet('검수');
  sheet.columns = [['검수 항목', 22], ['ID', 16], ['골프장명', 28], ['구분', 10], ['출처', 12], ['위치 근거', 16], ['마스터 대비 이동(km)', 18], ['카카오맵 연결', 12], ['주소', 46], ['비고', 44]].map(([header, width]) => ({ header: header as string, width: width as number }));
  const rows = courses.map((course) => {
    const master = audit.masterPoints.get(course.id);
    const moved = master ? Math.round(distanceKm(master, course) * 10) / 10 : null;
    const linked = !!course.kakaoPlaceUrl;
    const item = moved !== null && moved >= 0.3 ? '위치 수정(마스터 좌표 오차)' : !linked ? '카카오 장소 미연결' : '';
    return { item, moved, linked, course };
  }).filter((row) => row.item).sort((a, b) => (b.moved ?? -1) - (a.moved ?? -1));
  for (const { item, moved, linked, course } of rows) {
    sheet.addRow([item, course.id, course.name, KIND(course), meta.get(course.id)?.source ?? 'PLK 마스터', audit.coordSources.get(course.id) ?? '', moved ?? '', linked ? 'O' : 'X', course.address, meta.get(course.id)?.note ?? '']);
  }
  for (const item of audit.duplicates) sheet.addRow(['중복 정리(지도 미표시)', item.removedId, item.removedName, '', '', '', '', '', '', `${item.keptName}(${item.keptId})과 같은 자리 ${(item.km * 1000).toFixed(0)}m → ${item.action}`]);
  for (const item of audit.unlocatedPublic) sheet.addRow(['공공데이터 위치 확인 불가', '', item.name, '', '공공데이터', '', '', '', item.address, `영업상태: ${item.status} / 지도 미표시`]);
  styleHeader(sheet);
  return { moved: rows.filter((row) => row.item.startsWith('위치 수정')).length, unlinked: rows.filter((row) => !row.linked).length, unlocated: audit.unlocatedPublic.length, duplicates: audit.duplicates.length };
}

export async function writeNationalWorkbook(file: string, courses: GolfCourse[], meta: Map<string, CourseMeta>, masterColumns: string[], counts: { reviewNeeded: number; excludedByOverride: number }, audit: AuditInput) {
  const book = new ExcelJS.Workbook();
  book.creator = 'PLK Golf Map';
  book.created = new Date();

  const all = book.addWorksheet('전체');
  all.columns = [
    ['ID', 14], ['골프장명', 28], ['구분', 10], ['출처', 12], ['권역', 8], ['주소', 46], ['위도', 11], ['경도', 11], ['홀수', 6], ['전화', 15], ['홈페이지', 30], ['카카오맵', 36], ['인허가 관리번호', 22], ['영업상태', 10], ['비고', 40],
  ].map(([header, width]) => ({ header: header as string, width: width as number }));
  for (const course of courses) {
    const info = meta.get(course.id);
    const row = all.addRow([course.id, course.name, KIND(course), info?.source ?? 'PLK 마스터', regionOf(course.address), course.address, course.lat, course.lng, course.holes ?? '', course.phone, course.homepage, course.kakaoPlaceUrl ?? '', info?.licenseNo ?? '', info?.businessStatus ?? '', info?.note ?? '']);
    const fill = FILL[KIND(course)];
    if (fill) row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  }
  styleHeader(all);

  const added = courses.filter((course) => meta.get(course.id)?.source !== 'PLK 마스터' && meta.has(course.id));
  const master = book.addWorksheet('신규_마스터형식');
  master.columns = masterColumns.map((header) => ({ header, width: Math.max(10, header.length * 2 + 2) }));
  for (const course of added) master.addRow(masterColumns.map((column) => toMasterRow(masterColumns, course)[column]));
  styleHeader(master);

  const auditCounts = addAuditSheet(book, courses, meta, audit);
  const summary = book.addWorksheet('요약');
  summary.columns = [{ header: '권역', width: 12 }, ...['제휴', '이용협약', '일반', '협의중', '합계'].map((header) => ({ header, width: 10 }))];
  for (const region of [...REGIONS, '기타'] as const) {
    const inRegion = courses.filter((course) => regionOf(course.address) === region);
    if (!inRegion.length) continue;
    summary.addRow([region, ...['제휴', '이용협약', '일반', '협의중'].map((kind) => inRegion.filter((course) => KIND(course) === kind).length), inRegion.length]);
  }
  summary.addRow(['합계', ...['제휴', '이용협약', '일반', '협의중'].map((kind) => courses.filter((course) => KIND(course) === kind).length), courses.length]).font = { bold: true };
  summary.addRow([]);
  const bySource = (source: string) => courses.filter((course) => (meta.get(course.id)?.source ?? 'PLK 마스터') === source).length;
  for (const [label, value] of [
    ['출처: PLK 마스터', bySource('PLK 마스터')], ['출처: 공공데이터 신규', bySource('공공데이터')], ['출처: 카카오 신규', bySource('카카오')],
    ['참고: 협회 집계 운영 골프장(2026.1.1)', ASSOCIATION_COUNT], ['지도 표시 합계', courses.length],
    ['검토 필요(3km 안 기존 골프장 있음)', counts.reviewNeeded], ['보정 CSV로 제외', counts.excludedByOverride],
    ['검수: 마스터 좌표 오차로 위치 수정', auditCounts.moved], ['검수: 카카오 장소 미연결', auditCounts.unlinked], ['검수: 공공데이터 위치 확인 불가', auditCounts.unlocated], ['검수: 같은 자리 중복 정리', auditCounts.duplicates],
  ] as const) summary.addRow([label, value]);
  styleHeader(summary);
  summary.autoFilter = undefined as unknown as ExcelJS.AutoFilter;
  summary.getColumn(1).width = 38;

  await book.xlsx.writeFile(file);
}
