# PLK Mini App Platform PoC

PHP 레거시와 독립된 Next.js / React / TypeScript / Tailwind CSS 앱입니다. 홈 `/`, Golf Map `/golf-map`, 데이터 파일 `/golf-courses.json`을 제공합니다. 빌드 결과는 정적 파일(HTML/JS/JSON)이라 Node 서버 없이 Apache 등 일반 웹서버에 올려 서비스합니다. 골프장 데이터는 **PLK 골프장 CSV를 기준**으로 하고, 빈 값(좌표·전화·카카오맵 링크)은 **카카오 로컬 API**로 보강합니다. 병합은 배치 스크립트 `npm run data:build`가 수행하며 앱은 결과 파일만 읽습니다.

## 로컬 실행

Node.js 20.9 이상(권장 22/24 LTS)이 필요합니다.

```powershell
cd D:\plk-mini\mark_g1
npm install
Copy-Item .env.example .env.local
# .env.local에 아래 JavaScript 키 입력
npm run dev
```

http://localhost:3000 에서 확인합니다. 키 없이도 홈, 검색, 필터, 목록, 상세 Bottom Sheet와 API가 동작합니다. 지도 영역은 명시적인 설정 안내를 표시합니다.

```dotenv
NEXT_PUBLIC_KAKAO_MAP_APP_KEY=발급받은_JavaScript_키
```

환경변수 변경 후 개발 서버를 재시작하세요. 배포 시에는 빌드 전에 환경변수를 설정해야 합니다.

## Kakao 설정

1. [Kakao Developers](https://developers.kakao.com)에서 앱 생성.
2. 앱의 **플랫폼 키 → JavaScript 키**를 확인. REST API 키나 Admin 키를 넣지 않습니다.
3. JavaScript SDK 도메인에 `http://localhost:3000` 등록. 휴대폰 LAN 테스트 시 `http://PC의-IP:3000`도 등록. 배포 후 실제 HTTPS 도메인 등록.
4. **카카오맵 → 사용 설정**에서 API 활성화 확인.

공식 안내: [Web SDK 가이드](https://apis.map.kakao.com/web/guide/), [사용 설정](https://developers.kakao.com/docs/en/kakaomap/common).
브라우저용 JavaScript 키는 SDK 요청에 공개되는 키입니다. 등록 도메인으로 제한하세요. 향후 공공 API 비밀키는 NEXT_PUBLIC 접두사 없이 서버에만 보관합니다.

## 구조

```text
app/
  layout.tsx, globals.css, page.tsx, opengraph-image.tsx
  golf-map/page.tsx
  golf-courses.json/route.ts   (빌드 시 정적 JSON 생성)
components/
  AppHeader.tsx, GolfMapApp.tsx, KakaoMap.tsx
  GolfCourseMarker.tsx, GolfCourseSearch.tsx
  GolfCourseFilter.tsx, GolfCourseSheet.tsx
data/
  golf-courses.json            (생성 결과물, 앱이 읽는 파일)
  source/                      (PLK CSV, 템플릿, overrides.csv)
  reports/, cache/             (매칭 리포트·API 캐시, git 제외)
lib/
  types.ts, golfCourses.ts
scripts/
  build-golf-data.ts, preview-web.ts
  lib/csv.ts, match.ts, kakao.ts, merge.ts
public/.htaccess               (Apache 캐시·404 설정)
tests/data.test.ts
next.config.ts                 (정적 내보내기, 하위 경로)
```

Frontend는 `/golf-courses.json`만 요청합니다. 이 파일은 빌드 시 `lib/golfCourses.ts`가 `data/golf-courses.json`을 그대로 내보낸 것입니다. 전화번호·홈페이지·홀 수가 없는 골프장은 미등록으로 표시합니다.

지도는 Kakao SDK의 clusterer 라이브러리를 사용합니다. 전국 축척에서 클러스터링하고 확대하면 일반 흰색 마커와 녹색 P 제휴 마커를 표시합니다. 목록 버튼에서도 동일한 상세 정보에 접근 가능합니다. 검색은 골프장명/주소, 필터는 제휴 여부를 기준으로 지도와 목록에 함께 적용됩니다. API 및 SDK 각각에 loading/error/retry 상태가 있습니다. 상세는 native dialog로 포커스 제한, Escape 닫기, 배경 터치 닫기를 제공합니다.

## 검증

```powershell
npm run test
npm run typecheck
```

## 웹 배포 (PLK 사이트 하위 경로, Apache)

게시판 공지·배너에서 `https://www.PLK도메인/golfmap/`으로 연결합니다. 이 주소의 첫 화면은 바로 골프장 지도이고, ← 버튼은 PLK 메인 사이트로 이동합니다.

1. `.env.production` 확인 (웹 빌드에서만 적용, `npm run dev`에는 영향 없음):
   ```dotenv
   BASE_PATH=/golfmap
   NEXT_PUBLIC_BASE_PATH=/golfmap
   NEXT_PUBLIC_SITE_URL=https://www.PLK도메인     # 실제 도메인으로 변경
   NEXT_PUBLIC_WEB_ENTRY=map
   ```
   Kakao JS 키는 `.env.local` 값이 함께 사용됩니다. 하위 경로를 바꾸면 `public/.htaccess`의 `ErrorDocument` 경로도 바꿉니다.
2. 실제 데이터 생성 후 빌드:
   ```powershell
   npm run data:build
   npm run build:web        # 결과: out/
   npm run preview:web      # http://localhost:4000/golfmap/ 에서 확인
   ```
3. `out/` 폴더 **안의 파일 전체**(숨김 파일 `.htaccess` 포함)를 서버의 `DocumentRoot/golfmap/`에 SFTP/FTP로 업로드합니다. 데이터 갱신 시 2~3을 반복합니다.
4. Kakao Developers → JavaScript SDK 도메인에 `https://www.PLK도메인`, `https://PLK도메인`을 추가합니다 (경로 없이 도메인만).
5. 배포 후 [카카오톡 공유 디버거](https://developers.kakao.com/tool/debugger/sharing)에 URL을 넣어 미리보기 카드(제목·설명·이미지)를 확인합니다.

- 서버에서 `.htaccess`(AllowOverride)가 막혀 있으면 같은 내용을 서버 담당자에게 vhost 설정으로 요청합니다.
- 유입 구분이 필요하면 `.../golfmap/?from=notice`, `.../golfmap/?from=banner`처럼 쿼리를 붙여 링크합니다. 앱 동작에는 영향이 없고 Apache 로그나 기존 분석 도구로 집계합니다.
- 서브도메인(예: `golfmap.PLK도메인`)으로 옮길 때는 `BASE_PATH`·`NEXT_PUBLIC_BASE_PATH`를 비우고 다시 빌드합니다.
- REST API 키는 데이터 빌드 스크립트에서만 쓰이며 `out/`에 포함되지 않습니다.

## 테스트 배포 (GitHub Pages)

PLK 도메인에 올리기 전, `main` 브랜치에 push하면 `.github/workflows/deploy-pages.yml`이 자동으로 테스트·빌드·배포합니다. 주소: `https://<계정>.github.io/golfmap/` (저장소 이름이 `golfmap`이면 PLK 최종 경로와 같음).

1. GitHub에 **Public** 저장소 `golfmap` 생성 → 로컬에서 `git remote add origin ...` 후 `git push -u origin main`.
2. 저장소 **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**에 `KAKAO_JS_KEY`(카카오 JavaScript 키) 추가. 선택: `BACK_URL`(← 버튼 이동 주소).
4. Kakao Developers → JavaScript SDK 도메인에 `https://<계정>.github.io` 추가.
5. Actions 탭에서 배포 완료 확인 후 접속. 데이터 갱신은 `npm run data:build` → `data/golf-courses.json` 커밋·push.

PLK 원본 자료(`data/source/`의 CSV·엑셀)와 `.env*`는 `.gitignore`로 제외되어 저장소에 올라가지 않습니다.

## PLK WebView 연결

- HTTPS 내부 URL `/` 또는 `/golf-map`을 엽니다. JavaScript, DOM storage 및 외부 Kakao SDK 네트워크 접근을 허용합니다.
- viewport-fit=cover, safe-area inset, 큰 터치 영역, 반응형 레이아웃을 적용했습니다. 실제 iOS/Android WebView에서 지도 제스처, 키보드, 시스템 뒤로가기, 높이 변경을 점검하세요. 핀치 확대를 막지 않습니다.
- 외부 홈페이지 및 `tel:` 링크는 호스트 앱에서 허용 도메인과 URL scheme을 검사해 외부 브라우저/전화 앱으로 전달하세요. 뒤로가기는 상세 닫기 → 페이지 이동 순서를 앱 브리지와 협의하세요.
- PoC에는 위치 권한 요청이나 인증이 없습니다. 향후 위치 기능은 앱 권한 및 SDK 브리지로 연결합니다.
- PMS/PLK DB에 직접 접근하지 않습니다. PLK 데이터는 서버에서 PLK API Layer를 통해 조회합니다.
- 향후 짧은 수명의 Mini App Token을 앱 브리지 또는 안전한 교환 절차로 전달하고 서버에서 검증합니다. member_id와 토큰을 URL query에 노출하지 않습니다. 브리지 메시지는 origin과 payload를 검증합니다.
- `@plk/mini-sdk`는 미구현입니다. getUser/close/share/openBooking/getLocation 같은 기능은 별도 SDK 모듈에 추가하고 Mini App UI와 분리합니다. 기능이 준비되면 홈 카드와 독립 route를 추가하세요.

## 운영팀 데이터 관리 화면 (`/admin`)

주소: `https://<사이트>/admin/` (예: `https://yckim747.github.io/plk-golfmap/admin/`). 검색엔진에는 노출되지 않습니다.

- **골프장 탭:** 이름·주소·전화·홈페이지·홀 수·구분(제휴/이용협약/일반/협의중)·혜택 문구·운영 메모 수정, 지도에서 핀을 끌어 위치 지정, 지도에서 제외/복구
- **검수 탭:** `data/review.json`의 검수 항목(위치 수정·카카오 미연결·신규 인근·통합·중복·위치 불명)을 확인/보류 처리, 빠졌던 골프장 "지도에 다시 넣기"
- **저장:** GitHub 연결 후 "저장" → 저장소의 `data/corrections.json` 커밋 → GitHub Actions가 2~3분 안에 재배포(화면 상단에 배포 상태 표시)
  - 토큰: github.com → Settings → Developer settings → Fine-grained tokens. 이 저장소만, **Contents: Read and write**, **Actions: Read-only**. 토큰은 그 브라우저에만 저장됩니다. 토큰을 가진 사람이 곧 관리 권한자입니다.
- **파일 받기:** 수정 파일(`corrections.json`), 전체 골프장 목록 CSV, 검수 목록 CSV. **불러오기:** 받은 수정 파일을 다시 불러와 저장.
- 저장하지 않은 수정은 그 브라우저에 임시 보관되며, 다시 열면 "불러오기"로 이어서 할 수 있습니다.

수정 내용은 원본(`data/golf-courses.json`)과 따로 `data/corrections.json`에 저장되고 **사이트 빌드 때 원본에 덮어씁니다.** 그래서 `npm run data:build`로 원본을 다시 만들어도 운영팀이 고친 내용은 유지됩니다(`lib/corrections.ts`).
PLK 도메인(Apache)에 올리는 경우에는 저장 후 `npm run build:web`으로 다시 빌드해 업로드해야 반영됩니다.

## 골프장 데이터 갱신

지도에는 **대한민국 전체 골프장**이 표시됩니다. PLK 운영팀 골프장 마스터가 기준이고, 마스터에 없는 골프장은 공공데이터(인허가)·카카오 전국 검색으로 찾아 '협의중'으로 추가합니다.

1. **운영팀 골프장 마스터 CSV**를 받은 그대로 `data/source/`에 넣습니다(수정 불필요, git 제외). 가장 최근 CSV를 자동으로 사용합니다.
   - 사용여부 N → '협의중', 공개 불가·휴장·이름 없음 → 제외(전국 보완에서도 다시 넣지 않음).
2. `.env.local` 키 (모두 서버·스크립트 전용, 브라우저에 노출되지 않음)
   ```dotenv
   KAKAO_REST_API_KEY=카카오_REST_API_키
   PUBLIC_DATA_SERVICE_KEY=공공데이터포털_일반_인증키   # 행정안전부_생활_골프장 조회서비스
   ```
3. `npm run data:fetch` — 전국 골프장 후보 수집 → `data/source/kakao-golf.json`, `data/source/public-golf.json`
   - 카카오: 대한민국을 격자로 나눠 '골프장'을 전수 검색(연습장·스크린·파크골프·개장 예정 제외, 같은 골프장의 여러 등록은 하나로).
   - 공공데이터: 인허가 대장의 영업·휴업 골프장(키가 없으면 건너뜀).
4. `npm run data:build` — 마스터 + 전국 후보를 중복 없이 병합 → `data/golf-courses.json`(지도), `data/reports/전국골프장_YYMMDD.xlsx`(엑셀)
   - 우선순위: overrides.csv > 운영팀 마스터 > 공공데이터 > 카카오. 마스터의 제휴 구분은 그대로 유지됩니다.
   - 같은 골프장 판정: 카카오 장소 ID, 이름(괄호 속 옛 이름 포함)·거리. 추가분 ID는 `KR-지자체코드-관리번호` / `KK-카카오ID`. 마스터 좌표가 주소와 5km 넘게 다르면 오류로 보고 카카오·주소 좌표를 씁니다(엑셀 비고에 표시).
   - 엑셀: **전체**(구분·출처 포함) / **신규_마스터형식**(운영팀 마스터와 같은 52개 컬럼, 그대로 붙여넣기 가능) / **요약**.
5. `data/reports/match-report.csv` 검토 후 필요하면 `data/source/overrides.csv`로 보정하고 다시 빌드합니다.
   ```
   plk_code,kakao_place_id,lat,lng,exclude
   A-302,9769457,,,          ← 마스터 골프장의 카카오 장소 지정
   A-317,,37.1234,127.5678,  ← 좌표 직접 지정
   KK-1169468033,,,,Y        ← 전국 보완으로 잘못 추가된 곳 제외
   ```
   - `added_kakao`·`added_public` 중 note에 '3km 안 기존 골프장'이 있으면 중복 여부를 확인합니다.
6. `npm run test` 후 `data/golf-courses.json`을 커밋·push하면 자동 배포됩니다.
