// 공개 사이트(GitHub Pages)용 파일 만들기
//   1) 내 컴퓨터에서 서버 실행:  node server.js
//   2) 다른 터미널에서:          node build-site.js
//   3) GitHub에 올리기:          git add -A && git commit -m "공개 사이트 데이터 갱신" && git push
// → docs/ 폴더에 화면 파일 + 데이터 스냅샷(JSON)이 만들어지고, GitHub Pages 가 docs/ 를 그대로 보여줌
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).port || 8790; } catch { return 8790; } })();
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, 'docs');
const DATA_OUT = path.join(OUT, 'data');
const FIRST_YEAR = 2024; // 서울시 실거래 공개 API 제공 시작

const get = async (u) => {
  const r = await fetch(BASE + u, { signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.json();
};
const write = (name, obj) => {
  fs.writeFileSync(path.join(DATA_OUT, name), JSON.stringify(obj));
  return (fs.statSync(path.join(DATA_OUT, name)).size / 1024).toFixed(0) + 'KB';
};

(async () => {
  try { await get('/api/config'); } catch {
    console.error(`\n  서버에 연결할 수 없습니다. 먼저 다른 터미널에서 node server.js 를 실행하세요. (${BASE})\n`);
    process.exit(1);
  }
  fs.mkdirSync(path.join(DATA_OUT), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

  // 화면 파일 복사 (명함 사진 card.png 는 개인정보라 제외)
  for (const f of ['index.html', 'app.js', 'style.css', 'assets/logo.svg']) fs.copyFileSync(path.join(__dirname, 'public', f), path.join(OUT, f));
  // 휴대폰 등이 예전 파일을 계속 쓰지 않도록 style.css · app.js 주소에 버전 표시(?v=만든시각)를 붙임
  const ver = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
  const idx = path.join(OUT, 'index.html');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/href="style\.css(\?v=\w+)?"/, `href="style.css?v=${ver}"`).replace(/src="app\.js(\?v=\w+)?"/, `src="app.js?v=${ver}"`));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log('화면 파일 복사 완료');

  // 실거래: 계약연도별 파일
  const years = [];
  const nowY = new Date().getFullYear();
  for (let y = FIRST_YEAR; y <= nowY; y++) {
    const s = await get(`/api/trades?kind=sale&from=${y}0101&to=${y}1231`);
    const r = await get(`/api/trades?kind=rent&from=${y}0101&to=${y}1231`);
    if (!s.rows.length && !r.rows.length) continue;
    years.push(y);
    // 화면에서 쓰지 않는 항목(지번·신고구분·계약기간)은 빼서 휴대폰이 받는 용량을 줄임
    const slim = (rows) => rows.map(({ jb, how, prd, ...rest }) => rest);
    console.log(`실거래 ${y}년: 매매 ${s.rows.length}건(${write(`sale_${y}.json`, slim(s.rows))}), 전월세 ${r.rows.length}건(${write(`rent_${y}.json`, slim(r.rows))})`);
  }

  // 부동산원 지수·시장지표, 국토부 거래특성, 좌표, 개발계획, 매물
  console.log('부동산원 주간', write('reb_weekly.json', await get('/api/reb?cycle=weekly')));
  console.log('부동산원 월간', write('reb_monthly.json', await get('/api/reb?cycle=monthly')));
  console.log('시장 지표', write('market.json', await get('/api/market')));
  const molit = await get('/api/molit');
  console.log('국토부 거래특성', molit.ok ? write('molit.json', molit) : '(조회 실패 — 공개 사이트에서는 "연결 대기"로 표시)');
  if (!molit.ok) write('molit.json', { ok: false, msg: '공개 사이트 데이터에 포함되지 않았습니다(공공데이터포털 연결 실패).' });
  console.log('단지 좌표', write('geocache.json', await get('/api/geocache')));
  console.log('개발계획', write('development.json', await get('/api/development')));
  console.log('추천매물', write('listings.json', await get('/api/listings')));
  fs.copyFileSync(path.join(__dirname, 'data', 'gwanak_dongs.geojson'), path.join(DATA_OUT, 'gwanak_dongs.geojson'));

  // 주변시설: 서버가 미리 받아 둔 것만 (없는 단지는 공개 사이트에서 OpenStreetMap 을 직접 조회)
  const pc = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'poicache.json'), 'utf8'));
  console.log('주변시설', write('poi.json', Object.fromEntries(Object.entries(pc).map(([k, v]) => [k, v.data]))), `(${Object.keys(pc).length}곳)`);

  // 브라우저용 설정: 브이월드 지도 키(브라우저에서 쓰는 키). 다른 API 키는 넣지 않음
  const cfg = await get('/api/config');
  write('site.json', { vworldKey: cfg.vworldKey || '' });

  const updated = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜
  write('meta.json', { updated, years });
  console.log(`\n완료 — docs/ (데이터 기준일 ${updated}). 이제 git add -A && git commit && git push 하면 공개 사이트에 반영됩니다.\n`);
})().catch((e) => { console.error('\n실패:', e.message); process.exit(1); });
