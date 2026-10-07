import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCsv, parseOverrides, parsePlkCourses, type PlkCourseRow } from '../scripts/lib/csv';
import { matchPlace, nameSimilarity, normalizeName, type KakaoPlace } from '../scripts/lib/match';
import { mergeCourse, normalizeHomepage, validateCourses } from '../scripts/lib/merge';
import type { GolfCourse } from '../lib/types';

const HEADER = 'plk_code,name,address,phone,homepage,holes,partner,partner_note';

function place(id: string, name: string, address: string, lat: number, lng: number, category = '스포츠,레저 > 골프 > 골프장'): KakaoPlace {
  return { id, place_name: name, category_name: category, phone: '031-000-0000', address_name: address, road_address_name: '', x: String(lng), y: String(lat), place_url: `http://place.map.kakao.com/${id}` };
}

const row: PlkCourseRow = { plkCode: 'P1', name: '레이크사이드CC', address: '경기도 용인시 처인구 모현읍', phone: '', homepage: '', holes: null, partner: true, partnerNote: '그린피 10% 할인' };

test('PLK CSV: BOM, CRLF, quoted commas, Y/N partner', () => {
  const rows = parsePlkCourses(`﻿${HEADER}\r\nP1,"A, B CC","경기도 용인시, 처인구",,,27,Y,"혜택, 안내"\r\nP2,C CC,강원 원주시,,,,N,\r\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'A, B CC');
  assert.equal(rows[0].address, '경기도 용인시, 처인구');
  assert.equal(rows[0].holes, 27);
  assert.equal(rows[0].partner, true);
  assert.equal(rows[1].holes, null);
  assert.equal(rows[1].partner, false);
});

test('PLK CSV: Excel EUC-KR files are decoded', () => {
  const eucKr = Buffer.from([0xb0, 0xf1, 0xc7, 0xc1]); // "골프"
  assert.equal(decodeCsv(eucKr), '골프');
  assert.equal(decodeCsv(Buffer.from('﻿골프', 'utf8')), '골프');
});

test('PLK CSV: invalid files are rejected with row numbers', () => {
  assert.throws(() => parsePlkCourses('plk_code,name\nP1,A'), /필요한 컬럼/);
  assert.throws(() => parsePlkCourses(`${HEADER}\nP1,A,주소,,,,Y,\nP1,B,주소,,,,N,`), /3행.*중복/);
  assert.throws(() => parsePlkCourses(`${HEADER}\nP1,A,,,,,Y,`), /필수/);
  assert.throws(() => parsePlkCourses(`${HEADER}\nP1,A,주소,,,,yes,`), /Y 또는 N/);
  assert.throws(() => parsePlkCourses(`${HEADER}\nP1,A,주소,,,18.5,Y,`), /양의 정수/);
});

test('overrides CSV requires lat and lng together', () => {
  const overrides = parseOverrides('plk_code,kakao_place_id,lat,lng,exclude\nP1,123,,,\nP2,,37.1,127.1,\nP3,,,,Y');
  assert.equal(overrides.get('P1')?.kakaoPlaceId, '123');
  assert.equal(overrides.get('P2')?.lat, 37.1);
  assert.equal(overrides.get('P3')?.exclude, true);
  assert.throws(() => parseOverrides('plk_code,kakao_place_id,lat,lng,exclude\nP1,,37.1,,'));
});

test('name normalization treats CC, 컨트리클럽 and spacing alike', () => {
  assert.equal(normalizeName('레이크사이드 CC'), normalizeName('레이크사이드컨트리클럽'));
  assert.equal(normalizeName('남서울 골프앤컨트리클럽'), '남서울');
  assert.equal(nameSimilarity('오크밸리CC', '오크밸리 컨트리클럽'), 1);
  assert.ok(nameSimilarity('오크밸리CC', '남서울CC') < 0.3);
});

test('match: clear same-district golf course is confirmed, driving ranges are ignored', () => {
  const near = { lat: 37.32, lng: 127.25 };
  const result = matchPlace(row, [
    place('1', '레이크사이드컨트리클럽', '경기 용인시 처인구 모현읍 능원리', 37.32, 127.25),
    place('2', '레이크사이드 골프연습장', '경기 용인시 처인구 모현읍', 37.32, 127.25, '스포츠,레저 > 골프 > 골프연습장'),
  ], near);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.best?.place.id, '1');
  assert.equal(result.candidates.length, 1);
});

test('match: same name in another district is not confirmed', () => {
  const result = matchPlace(row, [place('9', '레이크사이드CC', '전남 해남군 화원면', 34.7, 126.3)], { lat: 37.32, lng: 127.25 });
  assert.notEqual(result.status, 'confirmed');
});

test('match: two similar nearby candidates are ambiguous', () => {
  const result = matchPlace(row, [
    place('1', '레이크사이드CC 동코스', '경기 용인시 처인구 모현읍', 37.32, 127.25),
    place('2', '레이크사이드CC 서코스', '경기 용인시 처인구 모현읍', 37.32, 127.25),
  ], { lat: 37.32, lng: 127.25 });
  assert.equal(result.status, 'ambiguous');
});

test('merge: PLK values win, empty fields are filled from Kakao', () => {
  const kakao = place('1', '레이크사이드컨트리클럽', '경기 용인시 처인구 모현읍', 37.32, 127.25);
  const match = matchPlace(row, [kakao], null);
  const filled = mergeCourse(row, undefined, match, [kakao], null);
  assert.equal(filled.status, 'confirmed');
  assert.equal(filled.course?.phone, '031-000-0000');
  assert.equal(filled.course?.kakaoPlaceUrl, 'https://place.map.kakao.com/1');
  assert.equal(filled.course?.partnerNote, '그린피 10% 할인');
  const kept = mergeCourse({ ...row, phone: '031-111-1111', name: 'PLK 표기명' }, undefined, match, [kakao], null);
  assert.equal(kept.course?.phone, '031-111-1111');
  assert.equal(kept.course?.name, 'PLK 표기명');
});

test('merge: overrides pick a place, set coordinates, or exclude', () => {
  const places = [place('1', '레이크사이드CC 동코스', '경기 용인시 처인구', 37.3, 127.2), place('2', '레이크사이드CC 서코스', '경기 용인시 처인구', 37.31, 127.21)];
  const match = matchPlace(row, places, null);
  assert.equal(mergeCourse(row, { plkCode: 'P1', kakaoPlaceId: '2', lat: null, lng: null, exclude: false }, match, places, null).course?.lat, 37.31);
  const manual = mergeCourse(row, { plkCode: 'P1', kakaoPlaceId: '', lat: 37.5, lng: 127.5, exclude: false }, match, places, null);
  assert.equal(manual.status, 'override');
  assert.equal(manual.course?.lng, 127.5);
  assert.equal(mergeCourse(row, { plkCode: 'P1', kakaoPlaceId: '', lat: null, lng: null, exclude: true }, match, places, null).course, null);
});

test('merge: unmatched courses fall back to the address point or are dropped', () => {
  const none = matchPlace(row, [], null);
  const fallback = mergeCourse(row, undefined, none, [], { lat: 37.3, lng: 127.2 });
  assert.equal(fallback.status, 'address_fallback');
  assert.equal(fallback.course?.kakaoPlaceUrl, undefined);
  assert.equal(mergeCourse(row, undefined, none, [], null).status, 'no_coords');
});

test('homepage normalization and output validation', () => {
  assert.equal(normalizeHomepage('www.example.co.kr'), 'https://www.example.co.kr/');
  assert.equal(normalizeHomepage('javascript:alert(1)'), '');
  const valid: GolfCourse = { id: 'P1', name: 'A', address: '주소', lat: 37, lng: 127, holes: 18, phone: '', homepage: '', plkPartner: false };
  assert.deepEqual(validateCourses([valid]), []);
  assert.equal(validateCourses([valid, { ...valid }]).length, 1);
  assert.equal(validateCourses([{ ...valid, lat: 0 }]).length, 1);
});

test('generated data/golf-courses.json passes validation', () => {
  const courses = JSON.parse(readFileSync('data/golf-courses.json', 'utf8')) as GolfCourse[];
  assert.ok(courses.length > 0);
  assert.deepEqual(validateCourses(courses), []);
});
