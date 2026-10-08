import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { normalizeName } from './match';

export type PartnerType = '제휴' | '이용협약';

export interface PlkCourseRow {
  plkCode: string;
  name: string;
  address: string;
  phone: string;
  homepage: string;
  holes: number | null;
  partnerType: PartnerType | null;
  partnerNote: string;
  lat: number | null;
  lng: number | null;
  status?: '협의중' | null;
  undisclosed?: boolean; // 운영팀 마스터 공개형태 '불가' → 제휴 정보 없이 일반으로 표시
}

export interface SkippedRow { plkCode: string; name: string; address: string; reason: string; lat?: number; lng?: number }
export interface ParsedCourses { format: 'template' | 'operations'; rows: PlkCourseRow[]; skipped: SkippedRow[] }

export interface OverrideRow {
  plkCode: string;
  kakaoPlaceId: string;
  lat: number | null;
  lng: number | null;
  exclude: boolean;
}

export const PLK_COLUMNS = ['plk_code', 'name', 'address', 'phone', 'homepage', 'holes', 'partner', 'partner_note'] as const;
export const OVERRIDE_COLUMNS = ['plk_code', 'kakao_place_id', 'lat', 'lng', 'exclude'] as const;
// 운영팀 골프장 마스터(한글 컬럼) 중 지도에 필요한 컬럼. 그린피·정산 등 나머지 컬럼은 읽지 않는다.
export const OPERATIONS_COLUMNS = ['골프장코드', '골프장명', '도로명주소', '전체주소', '위도', '경도', '홈페이지', '홀수', '제휴구분', '사용여부', '골프장공개형태', '국가코드', '지역'] as const;

// UTF-8(BOM 허용)을 먼저 시도하고, 깨진 바이트가 있으면 엑셀 기본 저장 형식(CP949/EUC-KR)으로 읽는다.
export function decodeCsv(buffer: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(buffer); }
}

function readTable(text: string, columns: readonly string[], label: string): Record<string, string>[] {
  const records: string[][] = parse(text, { skip_empty_lines: true, trim: true, relax_column_count: true });
  const header = (records.shift() ?? []).map((value) => value.toLowerCase());
  const missing = columns.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`${label} 헤더에 필요한 컬럼이 없습니다: ${missing.join(', ')}`);
  return records.map((record) => Object.fromEntries(header.map((column, index) => [column, record[index] ?? ''])));
}

function lineError(label: string, index: number, message: string): Error {
  return new Error(`${label} ${index + 2}행: ${message}`);
}

// 헤더로 형식을 판별한다: 운영팀 마스터(한글 컬럼)는 그대로 받고, 그 외에는 템플릿 형식으로 엄격하게 검사한다.
export function parseCourseFile(text: string): ParsedCourses {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0];
  if (header.includes('골프장코드') && header.includes('골프장명')) return { format: 'operations', ...parseOperationsCourses(text) };
  return { format: 'template', rows: parsePlkCourses(text), skipped: [] };
}

export function parsePlkCourses(text: string): PlkCourseRow[] {
  const label = 'PLK 골프장 CSV';
  const seen = new Set<string>();
  return readTable(text, PLK_COLUMNS, label).map((row, index) => {
    const plkCode = row.plk_code;
    if (!plkCode) throw lineError(label, index, 'plk_code가 비어 있습니다.');
    if (seen.has(plkCode)) throw lineError(label, index, `plk_code ${plkCode}가 중복됩니다.`);
    seen.add(plkCode);
    if (!row.name || !row.address) throw lineError(label, index, 'name과 address는 필수입니다.');
    const partner = row.partner.toUpperCase();
    if (partner && !['Y', 'N'].includes(partner)) throw lineError(label, index, 'partner는 Y 또는 N이어야 합니다.');
    let holes: number | null = null;
    if (row.holes) {
      holes = Number(row.holes);
      if (!Number.isInteger(holes) || holes <= 0) throw lineError(label, index, 'holes는 양의 정수여야 합니다.');
    }
    return { plkCode, name: row.name, address: row.address, phone: row.phone, homepage: row.homepage, holes, partnerType: partner === 'Y' ? '제휴' : null, partnerNote: row.partner_note, lat: null, lng: null };
  });
}

function koreanPoint(latText: string, lngText: string): { lat: number; lng: number } | null {
  const lat = Number(latText);
  const lng = Number(lngText);
  return latText && lngText && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132 ? { lat, lng } : null;
}

// 사용여부 N은 제외하지 않고 '협의중'으로 표시한다(지도에서 흐리게 노출).
function exclusionReason(row: Record<string, string>, name: string): string {
  if (!name || /^\d+$/.test(name)) return '입력 오류(골프장명 없음)';
  // 골프장이 아닌 등록(예: PLK 라운지)
  if (/라운지|사무실|본사|지점$/.test(name)) return '골프장 아님';
  if (row['제휴구분'] === '휴장') return '휴장';
  if (row['국가코드'] !== 'KR' || row['지역'] === '중국권') return '해외';
  return '';
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 6);
}

// 운영팀 마스터의 골프장코드는 여러 골프장이 같은 코드를 쓰거나 비어 있기도 하다.
// 코드가 유일하면 그대로 ID로 쓰고, 아니면 이름·주소 해시를 붙여 파일이 갱신돼도 같은 ID가 나오게 한다.
export function parseOperationsCourses(text: string): { rows: PlkCourseRow[]; skipped: SkippedRow[] } {
  const skipped: SkippedRow[] = [];
  const kept: { row: PlkCourseRow; code: string }[] = [];
  for (const row of readTable(text, OPERATIONS_COLUMNS, '운영팀 골프장 마스터')) {
    const code = row['골프장코드'] === '0' ? '' : row['골프장코드'];
    const name = row['골프장명'].replace(/\s+/g, ' ').trim();
    const address = row['도로명주소'] || row['전체주소'].replace(/^\d{5,6}\s+/, '');
    // 주소가 비어 있으면 빌드 단계에서 카카오 장소 검색으로 채운다.
    const reason = exclusionReason(row, name);
    if (reason) { const at = koreanPoint(row['위도'], row['경도']); skipped.push({ plkCode: code, name, address, reason, lat: at?.lat, lng: at?.lng }); continue; }
    const holes = Number(row['홀수']);
    const point = koreanPoint(row['위도'], row['경도']);
    const status = row['사용여부'] === 'Y' ? null : '협의중' as const;
    // 공개형태 '불가'는 지도에는 표시하되 PLK 제휴·이용협약 정보는 드러내지 않는다(일반 골프장으로 표시).
    const undisclosed = row['골프장공개형태'] === '불가';
    const partnerType = status || undisclosed ? null : (['제휴', '이용협약'] as const).find((type) => type === row['제휴구분']) ?? null;
    kept.push({ code, row: { plkCode: code, name, address, phone: '', homepage: row['홈페이지'], holes: Number.isInteger(holes) && holes > 0 ? holes : null, partnerType, partnerNote: '', lat: point?.lat ?? null, lng: point?.lng ?? null, status, ...(undisclosed ? { undisclosed: true } : {}) } });
  }
  // 운영 중인 행과 같은 골프장의 협의중 행(예전 행)은 뺀다.
  const activeNames = new Set(kept.filter(({ row }) => !row.status).map(({ row }) => normalizeName(row.name)));
  for (let index = kept.length - 1; index >= 0; index--) {
    const { code, row } = kept[index];
    if (row.status && activeNames.has(normalizeName(row.name))) { skipped.push({ plkCode: code, name: row.name, address: row.address, reason: '중복(운영 중 행 있음)' }); kept.splice(index, 1); }
  }
  const codeCounts = new Map<string, number>();
  for (const { code } of kept) if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  const ids = new Set<string>();
  const rows: PlkCourseRow[] = [];
  for (const { code, row } of kept) {
    const id = code && codeCounts.get(code) === 1 ? code : `${code || 'X'}-${shortHash(`${normalizeName(row.name)}|${row.address}`)}`;
    if (ids.has(id)) { skipped.push({ plkCode: code, name: row.name, address: row.address, reason: '중복 행' }); continue; }
    ids.add(id);
    rows.push({ ...row, plkCode: id });
  }
  return { rows, skipped };
}

export function parseOverrides(text: string): Map<string, OverrideRow> {
  const label = '보정 CSV';
  const overrides = new Map<string, OverrideRow>();
  readTable(text, OVERRIDE_COLUMNS, label).forEach((row, index) => {
    if (!row.plk_code) throw lineError(label, index, 'plk_code가 비어 있습니다.');
    const lat = row.lat ? Number(row.lat) : null;
    const lng = row.lng ? Number(row.lng) : null;
    if ((lat === null) !== (lng === null) || Number.isNaN(lat) || Number.isNaN(lng)) throw lineError(label, index, 'lat과 lng는 함께 숫자로 입력해야 합니다.');
    overrides.set(row.plk_code, { plkCode: row.plk_code, kakaoPlaceId: row.kakao_place_id, lat, lng, exclude: row.exclude.toUpperCase() === 'Y' });
  });
  return overrides;
}

export function toCsv(rows: Record<string, string | number>[], columns: string[]): string {
  const escape = (value: string | number) => { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  return '﻿' + [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column] ?? '')).join(','))].join('\r\n') + '\r\n';
}
