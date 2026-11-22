# SK부동산 관악구 부동산 브리핑 대시보드

공인중개사(SK부동산,  TEL 02-885-3200)가 고객에게 관악구 시장을 브리핑하는 데 쓰는 로컬 웹 대시보드.

## 작업 규칙
- 답변·설명·화면 문구는 **한국어**로. 사용자는 개발자가 아니므로 전문용어는 쉽게 풀어서 설명한다.
- **파일을 고치기 전에 백업**: 수정할 파일을 `backup/YYYYMMDD-HHMM/` 에 먼저 복사한다(이 폴더는 git 저장소가 아님. 사용자가 직접 수정하다 index.html이 통째로 망가진 적 있음).
- 수정 후에는 반드시 확인: `node --check` 로 JS 문법 검사 → 브라우저(http://localhost:8790)에서 콘솔 오류·화면 동작 확인.
- 실제 데이터처럼 보이는 값을 지어내지 않는다. 확인 못 한 정보(개발계획 일정 등)는 "변동 가능/확인 필요"로 표시한다.
- `data/` 안의 캐시·매물 파일을 지우거나 덮어쓰기 전에는 사용자에게 먼저 묻는다(특히 `data/listings.json` 은 사용자가 등록한 매물).
- API 키는 `config.json` 에만 둔다. 다른 파일·문서·외부 요청 로그에 키를 적지 않는다.

## 실행
- `node server.js` (Node 18+, 외부 패키지 없음) → http://localhost:8790 . 또는 `대시보드실행.command` 더블클릭.
- 포트 **8790** (8787은 다른 프로그램이 사용 중).
- 서버 재시작: `pkill -f "node server.js"` 후 다시 실행. 로그는 `data/server.log`.
- Python은 이 PC에서 HTTPS 인증서 오류가 나므로 외부 API 호출 스크립트는 **Node로** 작성한다.

## 구조
- `server.js` — 정적 파일 서빙 + API 프록시/캐시 (`/api/trades`, `/api/reb`, `/api/market`, `/api/molit`, `/api/geocode`, `/api/geocache`, `/api/poi`, `/api/listings`, `/api/development`, `/api/config`)
- `geomatch.js` — OSM 단지명 매칭, 행정동 판별(point-in-polygon), 법정동↔행정동 표
- `public/index.html` · `public/app.js` · `public/style.css` — 화면 (Leaflet 1.9.4, Chart.js 4.4.1 CDN)
- `public/assets/logo.svg` — 명함 로고를 SVG로 다시 그린 것 (원본 명함 `card.png`)
- `data/` — `config` 외 데이터: `listings.json`(추천매물), `development.json`(개발계획), `seed_coords.json`(수동 좌표), `gwanak_dongs.geojson`(행정동 21개 경계), 각종 캐시

## 데이터 소스 (모두 config.json 키 사용)
- 서울시 열린데이터광장: 실거래 매매 `tbLnOpendataRtmsV`, 전월세 `tbLnOpendataRentV` (자치구코드 11620). 접수연도별로 받아 `data/cache/` 에 6시간 캐시.
- 한국부동산원 R-ONE: 주간/월간 지수, 수급지수(서남권 CLS 50014), 거래량(관악 CLS 510023), 매입자 거주지·연령(GRP_ID 910023), 전세가율. 관악구 CLS_ID는 표마다 다름(주간 50066, 월간 530035).
- 공공데이터포털(국토부 실거래 상세): 이 PC 네트워크에서 apis.data.go.kr 접속이 막혀 있었음. 실패 시 화면에 "연결 대기", 10분마다 재시도.
- 브이월드: 배경지도 WMTS + 지번→좌표(단지 위치). **요청을 몰아서 보내면 IP가 몇 분간 차단되어 지도 타일까지 안 나옴** → 반드시 한 건씩 0.4초 이상 간격. 응답의 행정동(level4A)이 관악구 밖이면 경계로 다시 판별(`fixHd`).
- OpenStreetMap: Overpass(주변시설·단지목록), Nominatim(보조 검색, 1초 1건).
- 실거래 자료에는 **법정동(봉천·신림·남현)만** 있음. 행정동 필터는 단지 좌표로 판별한다.

## 화면 동작 규칙 (사용자 요청사항)
- 입지분석(교통·학군·상권·관공서·개발계획)은 클릭해서 펼치는 방식이 아니라 **한 번에 모두 펼쳐서** 보여준다.
- TOP 10 클릭 시 페이지를 아래로 **스크롤하지 않는다**(오른쪽 지도에서 위치·최근 실거래가 표시). 입지분석 이동은 "입지분석 보기 ↓" 버튼. 추천매물 카드 클릭은 분석이 그려진 뒤 입지분석으로 스크롤.
- 인쇄는 A4 가로. 인쇄 시 차트는 이미지로 바꿔 찍고(`chartsToImages`), 지도는 화면 그대로 축소(`map-frozen`). Chart.js 애니메이션은 꺼 둔다.
- 인쇄 결과 확인은 헤드리스 크롬 `--print-to-pdf` 에 `--timeout` 사용(`--virtual-time-budget` 은 차트가 비정상으로 찍혀 오판하게 됨).
- 정적 파일은 `Cache-Control: no-cache` 로 서빙(수정이 바로 반영되도록).
