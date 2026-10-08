import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCsv, parseCourseFile, parseOverrides, parsePlkCourses, type PlkCourseRow } from '../scripts/lib/csv';
import { matchPlace, nameSimilarity, normalizeName, type KakaoPlace } from '../scripts/lib/match';
import { mergeCourse, normalizeHomepage, validateCourses } from '../scripts/lib/merge';
import type { GolfCourse } from '../lib/types';
import { clusterPlaces, findExisting, isNationalCourse, nameVariants, tmToWgs84, toMasterRow } from '../scripts/lib/national';
import { cleanAddress, cleanLotAddress } from '../scripts/lib/address';
import { describeParsed, parseSearchQuery } from '../lib/searchQuery';
import { applyCorrections, kindOf, validateEdit } from '../lib/corrections';
import { buildViewSearch, readViewParams } from '../lib/share';

const HEADER = 'plk_code,name,address,phone,homepage,holes,partner,partner_note';

function place(id: string, name: string, address: string, lat: number, lng: number, category = '스포츠,레저 > 골프 > 골프장'): KakaoPlace {
  return { id, place_name: name, category_name: category, phone: '031-000-0000', address_name: address, road_address_name: '', x: String(lng), y: String(lat), place_url: `http://place.map.kakao.com/${id}` };
}

const row: PlkCourseRow = { plkCode: 'P1', name: '레이크사이드CC', address: '경기도 용인시 처인구 모현읍', phone: '', homepage: '', holes: null, partnerType: '제휴', partnerNote: '그린피 10% 할인', lat: null, lng: null };

const OPS_HEADER = '골프장코드,골프장명,국가코드,지역,도로명주소,전체주소,위도,경도,홈페이지,홀수,제휴구분,사용여부,골프장공개형태,주중그린피_원';
const ops = (...lines: string[]) => `﻿${OPS_HEADER}\r\n${lines.join('\r\n')}\r\n`;

test('PLK CSV: BOM, CRLF, quoted commas, Y/N partner', () => {
  const rows = parsePlkCourses(`﻿${HEADER}\r\nP1,"A, B CC","경기도 용인시, 처인구",,,27,Y,"혜택, 안내"\r\nP2,C CC,강원 원주시,,,,N,\r\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'A, B CC');
  assert.equal(rows[0].address, '경기도 용인시, 처인구');
  assert.equal(rows[0].holes, 27);
  assert.equal(rows[0].partnerType, '제휴');
  assert.equal(rows[1].holes, null);
  assert.equal(rows[1].partnerType, null);
});

test('operations master CSV is detected and mapped as-is', () => {
  const parsed = parseCourseFile(ops(
    'A-104,360도컨트리클럽 ,KR,한강이남,경기 여주군 강천면 부평로 609,12617 경기 여주군 강천면 부평로 609,37.29,127.73,http://www.360cc.co.kr,0,이용협약,Y,100% 오픈,180000',
    'E-305,포웰 컨트리클럽,KR,경상도,,"50875 경남 김해시 진례면 고모로134번길 54-49",35.23,128.78,,27,제휴,Y,이니셜로 표기,150000',
    'B-1,비제휴CC,KR,충청도,충북 청주시,,,,,18,비제휴,Y,100% 오픈,0',
  ));
  assert.equal(parsed.format, 'operations');
  assert.deepEqual(parsed.skipped, []);
  const [first, second, third] = parsed.rows;
  assert.equal(first.plkCode, 'A-104');
  assert.equal(first.name, '360도컨트리클럽');
  assert.equal(first.holes, null);
  assert.equal(first.partnerType, '이용협약');
  assert.deepEqual([first.lat, first.lng], [37.29, 127.73]);
  assert.equal(second.address, '경남 김해시 진례면 고모로134번길 54-49');
  assert.equal(second.partnerType, '제휴');
  assert.equal(second.holes, 27);
  assert.equal(third.partnerType, null);
  assert.equal(third.lat, null);
  assert.equal(parseCourseFile(`${HEADER}\nP1,A,주소,,,,Y,`).format, 'template');
});

test('operations master: overseas, non-course and blank rows are skipped; unused, closed and undisclosed rows become 협의중 without partner info', () => {
  const { rows, skipped } = parseCourseFile(ops(
    'A-1,미사용CC,KR,한강이남,경기 여주시,,,,,0,제휴,N,100% 오픈,0',
    'A-2,휴장CC,KR,한강이남,경기 여주시,,,,,0,휴장,Y,100% 오픈,0',
    'A-3,비공개CC,KR,한강이남,경기 여주시,,,,,0,비제휴,N,불가,0',
    'A-4,중국CC,KR,중국권,중국,,,,,0,비제휴,Y,100% 오픈,0',
    '0,0,KR,경상도,부산,,,,,0,비제휴,Y,100% 오픈,0',
    ',1,KR,경상도,부산,,,,,0,비제휴,N,,0',
    'A-6,정상CC,KR,한강이남,경기 여주시,,,,,0,비제휴,Y,100% 오픈,0',
    'A-7,지산CC,KR,한강이남,경기 이천시,,,,,0,이용협약,Y,불가,0',
    ',PLK 라운지,KR,한강이남,서울 강남구,,,,,0,비제휴,Y,불가,0',
  ));
  assert.deepEqual(rows.map((course) => [course.name, course.status, course.partnerType, !!course.undisclosed]), [['미사용CC', '협의중', null, false], ['휴장CC', '협의중', null, false], ['비공개CC', '협의중', null, true], ['정상CC', null, null, false], ['지산CC', '협의중', null, true]]);
  assert.deepEqual(skipped.map((course) => course.reason), ['해외', '입력 오류(골프장명 없음)', '입력 오류(골프장명 없음)', '골프장 아님']);
});

test('operations master: 협의중 rows duplicating an active course are dropped; blank addresses pass through', () => {
  const { rows, skipped } = parseCourseFile(ops(
    'N-CC,남서울컨트리클럽 ,KR,한강이남,경기 성남시 분당구,,,,,0,비제휴,N,100% 오픈,0',
    'A-1,남서울CC,KR,한강이남,경기 성남시 분당구,,,,,0,비제휴,Y,100% 오픈,0',
    'X-1,제주 나인브릿지CC,KR,제주도,,,,,,0,비제휴,Y,100% 오픈,0',
  ));
  assert.deepEqual(rows.map((course) => course.name), ['남서울CC', '제주 나인브릿지CC']);
  assert.equal(rows[1].address, '');
  assert.deepEqual(skipped.map((course) => course.reason), ['중복(운영 중 행 있음)']);
});

test('operations master: duplicate or blank codes get stable unique IDs', () => {
  const text = ops(
    'N-CC,남촌골프클럽,KR,한강이남,경기 광주시 곤지암읍,,,,,0,비제휴,Y,100% 오픈,0',
    'N-CC,뉴스프링빌 컨트리클럽,KR,한강이남,경기 이천시 모가면,,,,,0,비제휴,Y,100% 오픈,0',
    ',고령오펠골프클럽,KR,경상도,경북 고령군 다산면,,,,,0,비제휴,Y,100% 오픈,0',
    ',고령오펠골프클럽,KR,경상도,경북 고령군 다산면,,,,,0,비제휴,Y,100% 오픈,0',
    'A-9,단독코드CC,KR,한강이남,경기 여주시,,,,,0,비제휴,Y,100% 오픈,0',
  );
  const { rows, skipped } = parseCourseFile(text);
  const ids = rows.map((course) => course.plkCode);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.match(ids[0], /^N-CC-[0-9a-f]{6}$/);
  assert.match(ids[2], /^X-[0-9a-f]{6}$/);
  assert.equal(ids[3], 'A-9');
  assert.deepEqual(skipped.map((course) => course.reason), ['중복 행']);
  assert.deepEqual(parseCourseFile(text).rows.map((course) => course.plkCode), ids);
});

test('operations master: required columns are checked', () => {
  assert.throws(() => parseCourseFile('골프장코드,골프장명\nA-1,테스트'), /필요한 컬럼.*도로명주소/);
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

test('merge: a confirmed Kakao place wins over master coordinates (pins line up with the Kakao basemap); partner type is kept', () => {
  const sourced = { ...row, lat: 37.4, lng: 127.4, partnerType: '이용협약' as const };
  const kakao = place('1', '레이크사이드컨트리클럽', '경기 용인시 처인구 모현읍', 37.32, 127.25);
  const confirmed = mergeCourse(sourced, undefined, matchPlace(sourced, [kakao], null), [kakao], null);
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual([confirmed.course?.lat, confirmed.course?.lng], [37.32, 127.25]);
  assert.match(confirmed.note, /카카오 위치 사용/);
  assert.equal(confirmed.course?.phone, '031-000-0000');
  assert.equal(confirmed.course?.plkPartner, true);
  assert.equal(confirmed.course?.partnerType, '이용협약');
  const unmatched = mergeCourse({ ...sourced, partnerType: null }, undefined, matchPlace(sourced, [], null), [], { lat: 36, lng: 127 });
  assert.equal(unmatched.status, 'source_coords');
  assert.equal(unmatched.course?.lat, 37.4);
  assert.equal(unmatched.course?.plkPartner, false);
  assert.equal(unmatched.course?.partnerType, undefined);
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

// ── 전국 골프장 보완 ─────────────────────────────────────────
const kakaoPlace = (id: string, name: string, lat: number, lng: number, category = '스포츠,레저 > 골프 > 골프장'): KakaoPlace => place(id, name, '경기 여주시', lat, lng, category);

test('national: only real golf courses survive the Kakao filter', () => {
  assert.equal(isNationalCourse(kakaoPlace('1', '레이크사이드CC', 37.3, 127.2)), true);
  assert.equal(isNationalCourse(kakaoPlace('2', '오산체력단련장', 37.1, 127.0)), true);
  assert.equal(isNationalCourse(kakaoPlace('3', 'OO스크린골프', 37.1, 127.0, '스포츠,레저 > 골프 > 스크린골프장')), false);
  assert.equal(isNationalCourse(kakaoPlace('4', '한강파크골프장', 37.1, 127.0)), false);
  assert.equal(isNationalCourse(kakaoPlace('5', '헤르몬CC (2026년 10월 예정)', 37.1, 127.0)), false);
});

test('national: one course registered several times on Kakao is grouped', () => {
  const grouped = clusterPlaces([
    kakaoPlace('1', '레이크사이드CC', 37.3, 127.2),
    kakaoPlace('2', '레이크사이드CC 동코스', 37.305, 127.205),
    kakaoPlace('3', '레이크사이드개발', 37.31, 127.21),
    kakaoPlace('4', '남촌CC', 37.5, 127.5),
  ]);
  assert.deepEqual(grouped.map((item) => [item.place_name, item.member_ids.length]), [['남촌CC', 1], ['레이크사이드CC', 3]]);
});

test('national: existing courses are found by place ID, old names in brackets, or nearly identical names', () => {
  const existing = [
    { id: 'A-317', name: 'H1(에이치원클럽)', lat: 37.1856, lng: 127.4055, placeIds: [] },
    { id: 'F-110', name: '베어포트리조트CC(구.웅포)', lat: 36.07, lng: 126.88, placeIds: ['999'] },
    { id: 'A-302', name: '서원힐스 컨트리클럽', lat: 37.80, lng: 126.85, placeIds: [] },
    { id: 'blocked:알펜시아700', name: '알펜시아700', lat: null, lng: null, placeIds: [], blocked: true },
  ];
  assert.equal(findExisting({ name: '에이치원클럽', lat: 37.189, lng: 127.405, placeIds: [] }, existing)?.id, 'A-317');
  assert.equal(findExisting({ name: '웅포컨트리클럽', lat: 36.071, lng: 126.881, placeIds: [] }, existing)?.id, 'F-110');
  assert.equal(findExisting({ name: '아무이름', lat: 30, lng: 120, placeIds: ['999'] }, existing)?.id, 'F-110');
  assert.equal(findExisting({ name: '서원힐스CC', lat: 37.76, lng: 126.95, placeIds: [] }, existing)?.id, 'A-302'); // 원본 좌표가 ~10km 어긋난 경우
  assert.equal(findExisting({ name: '알펜시아700GC', lat: 37.66, lng: 128.67, placeIds: [] }, existing)?.blocked, true);
  assert.equal(findExisting({ name: '남촌CC', lat: 35.0, lng: 128.0, placeIds: [] }, existing), null);
  assert.deepEqual(nameVariants('베어포트리조트CC(구.웅포)'), ['베어포트리조트CC(구.웅포)', '베어포트리조트CC', '웅포']);
});

test('national: EPSG:5174 TM coordinates convert to WGS84 near the origin', () => {
  const point = tmToWgs84(200000, 500000);
  assert.ok(point && Math.abs(point.lat - 38) < 0.01 && Math.abs(point.lng - 127.0029) < 0.01);
  assert.equal(tmToWgs84(0, 0), null);
});

test('national: new courses are written in the operations master column layout', () => {
  const columns = ['골프장코드', '골프장명', '국가코드', '시도', '시군', '도로명주소', '위도', '경도', '홀수', '제휴구분', '사용여부', '주중그린피_원'];
  const row = toMasterRow(columns, { name: '오산체력단련장', address: '경기 오산시 양산동 100', lat: 37.1, lng: 127.0, homepage: '', holes: null });
  assert.deepEqual(Object.keys(row), columns);
  assert.deepEqual([row['골프장코드'], row['시도'], row['시군'], row['제휴구분'], row['사용여부'], row['주중그린피_원']], ['', '경기', '오산시', '비제휴', 'N', '']);
});

test('national: public licensing names and addresses are normalized for matching and geocoding', () => {
  assert.ok(nameVariants('광릉레져개발(주)  광릉CC').includes('광릉CC'));
  assert.ok(nameVariants('(주)밀양컨트리클럽').includes('밀양컨트리클럽'));
  assert.ok(nameVariants('오크밸리대중골프장').includes('오크밸리골프장'));
  assert.equal(cleanAddress('충청북도 음성군 소이면 후삼로158번길 101-0, 0동 (클럽하우스)'), '충청북도 음성군 소이면 후삼로158번길 101');
  assert.equal(cleanLotAddress('경상북도 칠곡군 북삼읍 보손리 34번지 2호'), '경상북도 칠곡군 북삼읍 보손리 34-2');
  assert.equal(cleanLotAddress('충청남도 예산군 삽교읍 목리 1420번지 0호'), '충청남도 예산군 삽교읍 목리 1420');
  assert.equal(cleanLotAddress('강원특별자치도 원주시 지정면 월송리 산 171'), '강원특별자치도 원주시 지정면 월송리 산 171');
});

// ── 검색 문장 해석(음성·직접 입력) ──────────────────────────────
test('search query: region, partner type, nearby and filler words are understood', () => {
  assert.deepEqual(parseSearchQuery('강원도 제휴 골프장 찾아줘'), { keywords: [], region: '강원', kind: '제휴', nearby: false });
  assert.deepEqual(parseSearchQuery('가까운 골프장 보여줘'), { keywords: [], region: null, kind: null, nearby: true });
  assert.deepEqual(parseSearchQuery('내 주변 이용협약 골프장'), { keywords: [], region: null, kind: '이용협약', nearby: true });
  assert.deepEqual(parseSearchQuery('용인에 있는 골프장'), { keywords: ['용인'], region: null, kind: null, nearby: false });
  assert.deepEqual(parseSearchQuery('제주도의 협의중 골프장'), { keywords: [], region: '제주', kind: '협의중', nearby: false });
  assert.deepEqual(parseSearchQuery('남서울'), { keywords: ['남서울'], region: null, kind: null, nearby: false });
  assert.deepEqual(parseSearchQuery('경상남도 레이크힐스'), { keywords: ['레이크힐스'], region: '경상', kind: null, nearby: false });
  assert.equal(describeParsed(parseSearchQuery('충청 제휴 골프장 근처')), '충청 · 제휴 · 가까운 순');
});

// ── 운영팀 수정(corrections) · 공유 링크 ─────────────────────────
test('corrections: edits, partner kind changes, exclusions and re-added courses are applied at build time', () => {
  const base: GolfCourse[] = [
    { id: 'A', name: '가CC', address: '경기 용인시', lat: 37.1, lng: 127.1, holes: null, phone: '', homepage: '', plkPartner: false },
    { id: 'B', name: '나CC', address: '강원 춘천시', lat: 37.8, lng: 127.7, holes: 18, phone: '033', homepage: '', plkPartner: true, partnerType: '제휴' },
    { id: 'C', name: '다CC', address: '제주 서귀포시', lat: 33.3, lng: 126.5, holes: null, phone: '', homepage: '', plkPartner: false, status: '협의중' },
  ];
  const result = applyCorrections(base, {
    updatedAt: '', reviews: {},
    courses: { A: { kind: '이용협약', partnerNote: '그린피 10% 할인', holes: 27, lat: 37.2, lng: 127.2 }, B: { kind: '일반' }, C: { exclude: true } },
    added: { D: { id: 'D', name: '라CC', address: '충남 천안시', lat: 36.8, lng: 127.1, holes: null, phone: '', homepage: '', plkPartner: false, status: '협의중' } },
  });
  assert.deepEqual(result.map((course) => course.id), ['A', 'B', 'D']);
  assert.deepEqual([result[0].partnerType, result[0].plkPartner, result[0].partnerNote, result[0].holes, result[0].lat], ['이용협약', true, '그린피 10% 할인', 27, 37.2]);
  assert.deepEqual([result[1].plkPartner, result[1].partnerType], [false, undefined]);
  assert.equal(kindOf(result[2]), '협의중');
  assert.deepEqual(validateEdit({ lat: 10, lng: 127 }), ['좌표가 대한민국 범위를 벗어났습니다.']);
  assert.deepEqual(validateEdit({ homepage: 'www.x.com', holes: 0 }).length, 2);
});

test('share links: view conditions round-trip through the URL', () => {
  const search = buildViewSearch({ q: '용인', region: '강원', kind: '제휴', sort: 'distance', course: 'A-104', view: 'list', fav: true });
  assert.deepEqual(readViewParams(search), { q: '용인', region: '강원', kind: '제휴', sort: 'distance', course: 'A-104', view: 'list', fav: true });
  assert.equal(buildViewSearch({ q: '', region: 'all', kind: 'all', sort: 'default', course: null, view: 'map', fav: false }), '');
  assert.deepEqual(readViewParams('?region=없는권역&kind=아무거나'), {});
});
