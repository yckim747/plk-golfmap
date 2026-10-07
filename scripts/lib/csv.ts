import { parse } from 'csv-parse/sync';

export interface PlkCourseRow {
  plkCode: string;
  name: string;
  address: string;
  phone: string;
  homepage: string;
  holes: number | null;
  partner: boolean;
  partnerNote: string;
}

export interface OverrideRow {
  plkCode: string;
  kakaoPlaceId: string;
  lat: number | null;
  lng: number | null;
  exclude: boolean;
}

export const PLK_COLUMNS = ['plk_code', 'name', 'address', 'phone', 'homepage', 'holes', 'partner', 'partner_note'] as const;
export const OVERRIDE_COLUMNS = ['plk_code', 'kakao_place_id', 'lat', 'lng', 'exclude'] as const;

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
    return { plkCode, name: row.name, address: row.address, phone: row.phone, homepage: row.homepage, holes, partner: partner === 'Y', partnerNote: row.partner_note };
  });
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
