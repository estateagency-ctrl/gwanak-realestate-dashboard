/* SK부동산 관악구 부동산 브리핑 대시보드 */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PY = 3.305785;
const LEGAL_CENTER = { 봉천동: [37.4818, 126.9455], 신림동: [37.4725, 126.9300], 남현동: [37.4735, 126.9785] };
const GU_CENTER = [37.4760, 126.9400];
const DATA_START = '20240101'; // 서울시 실거래 공개 API 제공 시작(2024년 접수분부터)

const S = {
  dong: 'all', usg: '아파트', cycle: 'weekly', from: null, to: null,
  topTab: 'sale', sort: 'price', listMenu: '전체',
  sale: [], rent: [], reb: {}, geo: {}, dongs: null, dev: [], listings: [],
  top: [], selKey: null, charts: {}, layers: {},
  autoSel: true, // true: 사용자가 단지를 직접 고르기 전까지 TOP 10 1위의 입지분석을 자동으로 펼쳐 둠
};

// ---------- 포맷 ----------
const fmtMan = (v) => { // 만원 → "12억 5,000"
  if (v == null || isNaN(v)) return '-';
  v = Math.round(v);
  const e = Math.floor(v / 10000), m = v % 10000;
  if (!e) return m.toLocaleString() + '만';
  return e + '억' + (m ? ' ' + m.toLocaleString() : '');
};
const fmtShort = (v) => v >= 10000 ? (v / 10000).toFixed(v >= 100000 ? 1 : 2).replace(/\.?0+$/, '') + '억' : Math.round(v).toLocaleString() + '만';
const fmtD = (d) => `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
const toYmd = (dt) => dt.toISOString().slice(0, 10).replace(/-/g, '');
const fromInput = (s) => s.replace(/-/g, '');
const toInput = (y) => `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}`;
const py = (a) => a / PY;
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = (r) => `${r.dong}|${r.nm}`;
function distM(a, b, c, d) { const R = 6371e3, t = Math.PI / 180, x = (c - a) * t, y = (d - b) * t; const h = Math.sin(x / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const fmtDist = (m) => m < 995 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km';
const walk = (m) => Math.max(1, Math.round(m * 1.25 / 67)) + '분'; // 직선거리×1.25 보정, 분당 67m

// ---------- API ----------
// 내 컴퓨터(localhost): node server.js 로 실시간 조회
// 공개 사이트(GitHub Pages 등): 서버 없이 data/ 폴더의 스냅샷(JSON)을 읽음  (?static 을 붙이면 로컬에서도 시험 가능)
const STATIC = new URLSearchParams(location.search).has('static') || !['localhost', '127.0.0.1'].includes(location.hostname);
const getJ = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const api = (u, o) => (STATIC ? staticApi(u, o) : fetch(u, o).then((r) => r.json()));
const SNAP = {}; // 스냅샷 파일 메모리 캐시
const snap = (f) => (SNAP[f] = SNAP[f] || getJ('data/' + f));
async function staticApi(u, o) {
  if (o && o.method === 'POST') throw new Error('공개 사이트에서는 매물을 등록·수정할 수 없습니다.');
  const url = new URL(u, location.href), q = Object.fromEntries(url.searchParams), p = url.pathname.replace(/^.*\/(api|data)\//, '/$1/');
  if (p === '/data/gwanak_dongs.geojson') return snap('gwanak_dongs.geojson');
  if (p === '/api/geocache') return snap('geocache.json');
  if (p === '/api/development') return snap('development.json');
  if (p === '/api/listings') return snap('listings.json');
  if (p === '/api/market') return snap('market.json');
  if (p === '/api/molit') return snap('molit.json').catch(() => ({ ok: false, msg: '공개 사이트에서는 제공하지 않는 항목입니다.' }));
  if (p === '/api/config') return snap('site.json');
  if (p === '/api/reb') return snap(`reb_${q.cycle === 'monthly' ? 'monthly' : 'weekly'}.json`);
  if (p === '/api/trades') { // 계약연도별 파일을 받아 기간으로 거르기
    const meta = await snap('meta.json');
    const rows = [];
    for (let y = +q.from.slice(0, 4); y <= +q.to.slice(0, 4); y++) {
      if (!meta.years.includes(y)) continue;
      (await snap(`${q.kind}_${y}.json`)).forEach((r) => { if (r.d >= q.from && r.d <= q.to) rows.push(r); });
    }
    return { kind: q.kind, rows };
  }
  if (p === '/api/geocode') { // 스냅샷에 있는 좌표만
    const g = await snap('geocache.json');
    return Object.fromEntries((q.items || '').split('~').filter(Boolean).map((k) => [k, g[k] || null]));
  }
  if (p === '/api/poi') { // 미리 받은 주변시설 → 없으면 브라우저에서 OpenStreetMap 직접 조회
    const cache = await snap('poi.json').catch(() => ({}));
    const key = `${(+q.lat).toFixed(4)},${(+q.lon).toFixed(4)}`;
    return { pois: cache[key] || await overpassPois(+q.lat, +q.lon) };
  }
  throw new Error('지원하지 않는 요청: ' + p);
}
async function overpassPois(lat, lon) {
  const a = (r) => `(around:${r},${lat},${lon})`;
  const q = `[out:json][timeout:40];(nwr${a(1500)}["railway"="station"];nwr${a(1500)}["public_transport"="station"]["subway"="yes"];node${a(500)}["highway"="bus_stop"];nwr${a(1500)}["amenity"~"^(school|kindergarten|university)$"];nwr${a(1200)}["amenity"~"^(marketplace|bank|townhall|police|post_office|hospital|library|fire_station|community_centre)$"];nwr${a(1200)}["shop"~"^(supermarket|department_store|mall)$"];nwr${a(1200)}["office"="government"];nwr${a(1200)}["leisure"="park"]["name"];);out center tags;`;
  let j, err;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try { const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (!r.ok) throw new Error('HTTP ' + r.status); j = await r.json(); break; } catch (e) { err = e; }
  }
  if (!j) throw err;
  return (j.elements || []).map((e) => ({ t: e.tags || {}, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon })).filter((e) => e.lat && e.t.name)
    .map((e) => ({ name: e.t.name, lat: e.lat, lon: e.lon, k: e.t.railway || (e.t.subway ? 'station' : '') || e.t.highway || e.t.amenity || e.t.shop || (e.t.office ? 'government' : '') || e.t.leisure, line: e.t.line || e.t['subway:line'] || e.t.network || '', op: e.t.operator || '' }));
}

// ---------- 행정동 판별 ----------
function pip(pt, poly) { // ray casting, poly = [[lon,lat],...]
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function hdongOf(lat, lon) {
  if (!S.dongs || lat == null) return null;
  for (const f of S.dongs.features) {
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (polys.some((p) => pip([lon, lat], p[0]))) return f.properties.name;
  }
  return null;
}
function coordOf(dong, nm) {
  const g = S.geo[`${dong}|${nm}`];
  if (g) return { lat: g.lat, lon: g.lon, approx: false };
  // 위치 미확인 → 법정동 중심 근처(단지명 기반 고정 오프셋)
  let h = 0; for (const c of nm) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [la, lo] = LEGAL_CENTER[dong] || GU_CENTER;
  return { lat: la + ((h % 100) - 50) / 12000, lon: lo + (((h >> 7) % 100) - 50) / 9000, approx: true };
}

// ---------- 필터 ----------
function filt(rows) {
  return rows.filter((r) => {
    if (r.usg !== S.usg) return false;
    if (S.dong === 'all') return true;
    const [t, n] = S.dong.split(':');
    if (t === 'L') return r.dong === n;
    const g = S.geo[keyOf(r)];
    return g ? hdongOf(g.lat, g.lon) === n : false;
  });
}
const dongLabel = () => S.dong === 'all' ? '관악구 전체' : S.dong.split(':')[1] + (S.dong[0] === 'H' ? '(행정동)' : '(법정동)');

// ---------- 초기화 ----------
async function init() {
  if (STATIC) { // 공개 사이트: 매물 등록·수정 숨김, 데이터 기준일 표시
    document.body.classList.add('static');
    snap('meta.json').then((m) => { $('.hdr-title p').textContent = `국토교통부 실거래(서울시 열린데이터광장) · 한국부동산원 · 데이터 기준일 ${m.updated}`; }).catch(() => {});
  }
  buildDongSelect();
  setPreset(91);
  bindUI();
  initMap();
  const [dongs, geo, dev, listings] = await Promise.all([
    api('/data/gwanak_dongs.geojson'), api('/api/geocache'), api('/api/development'), api('/api/listings'),
  ]);
  S.dongs = dongs; S.geo = geo; S.dev = dev; S.listings = listings;
  drawDongs(); drawDev();
  buildDongSelect();
  loadMarket();
  await loadAll();
  if (location.hash === '#print') setTimeout(doPrint, 2500);
  // 백그라운드 위치 확보가 진행되는 동안 주기적으로 갱신
  setInterval(async () => {
    const g = await api('/api/geocache');
    if (Object.keys(g).length !== Object.keys(S.geo).length) { S.geo = g; if (S.dong.startsWith('H')) renderAll(); }
  }, 30000);
}

function buildDongSelect() {
  const sel = $('#dongSel'), cur = S.dong;
  const h = S.dongs ? S.dongs.features.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b, 'ko')) :
    '낙성대동 난곡동 난향동 남현동 대학동 미성동 보라매동 삼성동 서림동 서원동 성현동 신림동 신사동 신원동 은천동 인헌동 조원동 중앙동 청룡동 청림동 행운동'.split(' ');
  sel.innerHTML = `<option value="all">관악구 전체</option>
    <optgroup label="법정동 (실거래 신고 기준)">${['봉천동', '신림동', '남현동'].map((n) => `<option value="L:${n}">${n}</option>`).join('')}</optgroup>
    <optgroup label="행정동 (21개)">${h.map((n) => `<option value="H:${n}">${n}</option>`).join('')}</optgroup>`;
  sel.value = cur;
}

function setPreset(days) {
  const to = new Date(); const from = new Date(Date.now() - (days - 1) * 864e5);
  S.to = toYmd(to); S.from = toYmd(from);
  $('#fromDt').value = toInput(S.from); $('#toDt').value = toInput(S.to);
  $$('#presetSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.d === days));
}

function bindUI() {
  $('#dongSel').onchange = (e) => { S.dong = e.target.value; renderAll(); highlightDong(); };
  $('#usgSel').onchange = (e) => { S.usg = e.target.value; renderAll(); };
  $$('#cycleSeg button').forEach((b) => b.onclick = () => { S.cycle = b.dataset.v; seg('#cycleSeg', b); renderCharts(); renderKpis(); });
  $$('#presetSeg button').forEach((b) => b.onclick = () => { setPreset(+b.dataset.d); loadAll(); });
  $('#applyBtn').onclick = () => {
    const f = fromInput($('#fromDt').value), t = fromInput($('#toDt').value);
    if (!f || !t || f > t) return alert('기간을 확인해 주세요.');
    if (t < DATA_START) return alert('서울시 실거래 공개자료는 2024년 1월 이후 자료만 제공됩니다. 2024년 이후 날짜를 선택해 주세요.');
    S.from = f; S.to = t; $$('#presetSeg button').forEach((b) => b.classList.remove('on')); loadAll();
  };
  $$('#sortSeg button').forEach((b) => b.onclick = () => { S.sort = b.dataset.v; seg('#sortSeg', b); renderTop(); });
  $$('#topTabs button').forEach((b) => b.onclick = () => { S.topTab = b.dataset.v; seg('#topTabs', b); renderTop(); });
  $('#tgDong').onchange = (e) => toggleLayer('dongs', e.target.checked);
  $('#tgDev').onchange = (e) => toggleLayer('dev', e.target.checked);
  $('#tgList').onchange = (e) => toggleLayer('list', e.target.checked);
  $('#addListBtn').onclick = () => openListDlg();
  $('#printBtn').onclick = doPrint;
  $('#goAnalysis').onclick = scrollToAnalysis;
  $('#fromDt').min = $('#toDt').min = toInput(DATA_START); // 실거래 자료 제공 시작일 이전은 선택 불가
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
  $('#listForm').addEventListener('submit', saveListing);
  $('#delListBtn').onclick = delListing;
}
const seg = (s, b) => $$(s + ' button').forEach((x) => x.classList.toggle('on', x === b));

async function loadAll() {
  setNotice(STATIC ? '<span class="spin"></span>자료를 불러오는 중입니다…' : '<span class="spin"></span>실거래 · 부동산원 자료를 불러오는 중입니다… (최초 조회 시 30초 정도 걸릴 수 있습니다)');
  try {
    const [sale, rent, w, m] = await Promise.all([
      api(`/api/trades?kind=sale&from=${S.from}&to=${S.to}`),
      api(`/api/trades?kind=rent&from=${S.from}&to=${S.to}`),
      S.reb.weekly ? S.reb.weekly : api('/api/reb?cycle=weekly'),
      S.reb.monthly ? S.reb.monthly : api('/api/reb?cycle=monthly'),
    ]);
    S.sale = sale.rows || []; S.rent = rent.rows || []; S.reb = { weekly: w, monthly: m };
    // 서울시 실거래 공개 API는 2024년 접수분부터만 제공
    setNotice(S.from < DATA_START ? `서울시 실거래 공개자료는 <b>2024년 1월 이후</b> 자료만 제공됩니다. 그 이전 기간은 거래가 0건으로 보이며, 부동산원 지수·시장 지표만 참고하세요.` : '');
    renderAll();
  } catch (e) {
    setNotice('자료를 불러오지 못했습니다. 서버(node server.js)가 실행 중인지 확인해 주세요. ' + e.message);
  }
}
function setNotice(h) { const n = $('#notice'); n.innerHTML = h; n.classList.toggle('on', !!h); }

function renderAll() {
  renderKpis(); renderCharts(); renderTop(); renderListings();
  const usgName = { 아파트: '아파트', 오피스텔: '오피스텔', 연립다세대: '빌라' }[S.usg];
  $('#top10Title').textContent = `${dongLabel()} ${usgName} TOP 10`;
  if (S.dong.startsWith('H')) {
    const total = new Set(S.sale.concat(S.rent).filter((r) => r.usg === S.usg).map(keyOf)).size;
    const known = new Set(S.sale.concat(S.rent).filter((r) => r.usg === S.usg && S.geo[keyOf(r)]).map(keyOf)).size;
    if (known < total) setNotice(`행정동 필터는 단지 위치로 판별합니다. 현재 기간 단지 ${total}곳 중 ${known}곳 위치 확인 — 나머지는 서버가 백그라운드로 확인 중이며 자동 반영됩니다.`);
  }
}

// ---------- KPI ----------
function renderKpis() {
  const sale = filt(S.sale), rent = filt(S.rent);
  const je = rent.filter((r) => r.se === '전세'), wo = rent.filter((r) => r.se === '월세');
  const sPy = avg(sale.map((r) => r.amt / py(r.area))), jPy = avg(je.map((r) => r.dep / py(r.area)));
  const ratio = sPy && jPy ? (jPy / sPy) * 100 : NaN;
  const wk = S.reb.weekly?.series, mo = S.reb.monthly?.series;
  const chg = (arr) => { if (!arr || arr.length < 2) return null; const a = arr.at(-1).v, b = arr.at(-2).v; return { pct: (a / b - 1) * 100, label: arr.at(-1).label }; };
  const src = S.cycle === 'weekly' ? wk : mo;
  const gS = chg(src?.saleIdx?.gwanak), sS = chg(src?.saleIdx?.seoul), gJ = chg(src?.jeonseIdx?.gwanak);
  const sign = (p) => p == null ? '-' : `<span class="${p > 0 ? 'up' : p < 0 ? 'dn' : ''}">${p > 0 ? '▲' : p < 0 ? '▼' : ''}${Math.abs(p).toFixed(2)}%</span>`;
  const per = S.cycle === 'weekly' ? '전주 대비' : '전월 대비';
  const cards = [
    { c: 'var(--red)', l: '매매 거래', v: `${sale.length.toLocaleString()}<small>건</small>`, s: `평균 ${fmtMan(avg(sale.map((r) => r.amt)))}` },
    { c: 'var(--or)', l: '매매 평균 평당가', v: isNaN(sPy) ? '-' : `${Math.round(sPy).toLocaleString()}<small>만/3.3㎡</small>`, s: `전용면적 기준 · 84㎡ 환산 ${isNaN(sPy) ? '-' : fmtMan(sPy * py(84))}` },
    { c: 'var(--mg)', l: '전세 거래 · 평균보증금', v: `${je.length.toLocaleString()}<small>건</small>`, s: `평균 ${fmtMan(avg(je.map((r) => r.dep)))} · 평당 ${isNaN(jPy) ? '-' : Math.round(jPy).toLocaleString() + '만'}` },
    { c: 'var(--pp)', l: '월세 거래 · 평균', v: `${wo.length.toLocaleString()}<small>건</small>`, s: `보증금 ${fmtMan(avg(wo.map((r) => r.dep)))} / 월 ${isNaN(avg(wo.map((r) => r.rent))) ? '-' : Math.round(avg(wo.map((r) => r.rent))) + '만'}` },
    { c: 'var(--gray)', l: '전세가율(평당가 기준)', v: isNaN(ratio) ? '-' : `${ratio.toFixed(1)}<small>%</small>`, s: '전세 평당가 ÷ 매매 평당가' },
    { c: '#0f766e', l: `부동산원 매매지수 ${per}`, v: `관악 ${sign(gS?.pct)}`, s: `서울 ${sign(sS?.pct)} · 관악 전세 ${sign(gJ?.pct)}<br><span style="color:var(--mute)">${gS?.label || ''} 기준</span>` },
  ];
  $('#kpis').innerHTML = cards.map((k) => `<div class="kpi" style="--c:${k.c}"><div class="k-l">${k.l}</div><div class="k-v">${k.v}</div><div class="k-s">${k.s}</div></div>`).join('');
}

// ---------- 차트 ----------
function bucketOf(d) {
  if (S.cycle === 'monthly') return `${d.slice(0, 4)}.${d.slice(4, 6)}`;
  const dt = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
  const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day);
  return `${String(dt.getFullYear()).slice(2)}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}
function renderCharts() {
  const sale = filt(S.sale), rent = filt(S.rent);
  const keys = [...new Set(sale.concat(rent).map((r) => bucketOf(r.d)))].sort();
  const cnt = (rows, f) => keys.map((k) => rows.filter((r) => bucketOf(r.d) === k && (!f || f(r))).length);
  const pyAvg = keys.map((k) => { const a = sale.filter((r) => bucketOf(r.d) === k); return a.length ? Math.round(avg(a.map((r) => r.amt / py(r.area)))) : null; });
  $('#volTitle').textContent = `${dongLabel()} 거래량 · 매매 평균 평당가 (${S.cycle === 'weekly' ? '주간' : '월간'})`;
  $('#volHint').textContent = S.cycle === 'weekly' ? '주 시작일(월) 기준' : '계약월 기준';
  mkChart('volChart', {
    data: {
      labels: keys, datasets: [
        { type: 'bar', label: '매매', data: cnt(sale), backgroundColor: '#D7262B', stack: 'v', yAxisID: 'y' },
        { type: 'bar', label: '전세', data: cnt(rent, (r) => r.se === '전세'), backgroundColor: '#C8643B', stack: 'v', yAxisID: 'y' },
        { type: 'bar', label: '월세', data: cnt(rent, (r) => r.se === '월세'), backgroundColor: '#7A2E8C', stack: 'v', yAxisID: 'y' },
        { type: 'line', label: '매매 평당가(만원)', data: pyAvg, borderColor: '#1f2328', backgroundColor: '#1f2328', yAxisID: 'y1', tension: .3, spanGaps: true, pointRadius: 2 },
      ],
    },
    options: { scales: { y: { stacked: true, title: { display: true, text: '건' } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: '만원/3.3㎡' } }, x: { stacked: true } } },
  });
  // 부동산원 지수
  const src = S.reb[S.cycle]?.series || {};
  const g = src.saleIdx?.gwanak || [], s = src.saleIdx?.seoul || [], gj = src.jeonseIdx?.gwanak || [];
  const toKey = (p) => S.cycle === 'weekly' ? p.label.replace(/-/g, '') : p.t + '01';
  let pts = g.filter((p) => toKey(p) >= S.from && toKey(p) <= S.to);
  if (pts.length < 12) { const end = g.findIndex((p) => toKey(p) > S.to); const e = end < 0 ? g.length : end; pts = g.slice(Math.max(0, e - 12), e); }
  const labs = pts.map((p) => p.t);
  const pick = (arr) => labs.map((t) => arr.find((p) => p.t === t)?.v ?? null);
  $('#idxTitle').textContent = `한국부동산원 ${S.cycle === 'weekly' ? '주간' : '월간'} 아파트 가격지수`;
  mkChart('idxChart', {
    type: 'line',
    data: {
      labels: pts.map((p) => S.cycle === 'weekly' ? p.label.slice(2).replace(/-/g, '.') : p.label.replace('년 ', '.').replace('월', '')),
      datasets: [
        { label: '관악구 매매', data: pick(g), borderColor: '#D7262B', backgroundColor: '#D7262B', tension: .3, pointRadius: 2 },
        { label: '서울 매매', data: pick(s), borderColor: '#9aa1a9', backgroundColor: '#9aa1a9', borderDash: [5, 4], tension: .3, pointRadius: 2 },
        { label: '관악구 전세', data: pick(gj), borderColor: '#7A2E8C', backgroundColor: '#7A2E8C', tension: .3, pointRadius: 2 },
      ],
    },
    options: { scales: { y: { title: { display: true, text: '지수' } } } },
  });
}
function mkChart(id, cfg) {
  S.charts[id]?.destroy();
  Chart.defaults.animation = false; // 인쇄·캡처 시 그리는 도중 상태가 찍히지 않도록
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 10, font: { family: 'Noto Sans KR' } } } } }, cfg.options);
  S.charts[id] = new Chart(document.getElementById(id), cfg);
}

// ---------- TOP10 ----------
function computeTop() {
  const tab = S.topTab;
  const rows = tab === 'sale' ? filt(S.sale) : filt(S.rent).filter((r) => r.se === (tab === 'jeonse' ? '전세' : '월세'));
  const val = (r) => tab === 'sale' ? r.amt : tab === 'jeonse' ? r.dep : r.rent;
  const g = new Map();
  rows.filter((r) => r.nm).forEach((r) => { const k = keyOf(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  const list = [...g.entries()].map(([k, rs]) => {
    rs.sort((a, b) => b.d.localeCompare(a.d));
    const top = rs.reduce((m, r) => val(r) > val(m) ? r : m, rs[0]);
    return { key: k, dong: rs[0].dong, nm: rs[0].nm, yr: rs[0].yr, n: rs.length, top, last: rs[0], rows: rs, max: val(top) };
  });
  list.sort((a, b) => S.sort === 'price' ? b.max - a.max || b.n - a.n : b.n - a.n || b.max - a.max);
  return list.slice(0, 10);
}
const priceTxt = (r) => r.amt != null ? fmtMan(r.amt) : r.se === '전세' ? fmtMan(r.dep) : `${fmtMan(r.dep)}/${r.rent}`;
function renderTop() {
  S.top = computeTop();
  const el = $('#topList');
  if (!S.top.length) { el.innerHTML = '<li class="empty-row" style="display:block">선택한 조건의 거래가 없습니다.</li>'; drawTopMarkers(); return; }
  el.innerHTML = S.top.map((t, i) => {
    const r = S.sort === 'price' ? t.top : t.last;
    return `<li data-k="${esc(t.key)}" class="${t.key === S.selKey ? 'sel' : ''}">
      <span class="rk">${i + 1}</span>
      <div style="min-width:0"><div class="t-nm">${esc(t.nm)}</div>
        <div class="t-sub">${t.dong} · ${t.yr || '-'}년 · 전용 ${r.area}㎡ · ${r.flr}층 · 거래 ${t.n}건</div></div>
      <div class="t-pr">${priceTxt(r)}<small>${fmtD(r.d)} ${S.sort === 'price' ? '최고가' : '최근'}</small></div></li>`;
  }).join('');
  $$('#topList li[data-k]').forEach((li) => li.onclick = () => selectComplex(li.dataset.k, false, null, 'map'));
  ensureGeo(S.top.map((t) => t.key)).then(drawTopMarkers);
  drawTopMarkers();
  // 아직 직접 고른 단지가 없으면 현재 조건의 1위 단지 입지분석을 미리 펼쳐 둠(지도·스크롤은 그대로)
  if (S.autoSel && S.selKey !== S.top[0].key) selectComplex(S.top[0].key, false, null, 'auto');
}
async function ensureGeo(keys) {
  const miss = keys.filter((k) => S.geo[k] === undefined);
  if (!miss.length) return;
  const r = await api('/api/geocode?items=' + encodeURIComponent(miss.join('~')));
  Object.assign(S.geo, r);
}

// ---------- 지도 ----------
let map;
function initMap() {
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false, minZoom: 7, maxZoom: 19, zoomSnap: 0.5 }).setView(GU_CENTER, 14);
  setupBaseMap();
  map.on('click', () => map.scrollWheelZoom.enable());
  ['dongs', 'dev', 'list', 'top', 'poi'].forEach((k) => (S.layers[k] = L.layerGroup().addTo(map)));
  $('#legend').innerHTML = `<span><i style="background:#D7262B"></i>TOP 10 단지</span><span><i style="background:#9aa1a9"></i>위치 근사(법정동 기준)</span>
    <span>⭐ 추천매물</span><span><i style="background:#7A2E8C;border-radius:3px"></i>개발계획</span>
    <span><i style="background:#16a34a"></i>지하철</span><span><i style="background:#0ea5e9"></i>버스</span><span><i style="background:#f59e0b"></i>학교</span><span><i style="background:#e11d48"></i>시장·마트</span><span><i style="background:#475569"></i>관공서·은행</span>`;
}
// 브이월드(국토교통부 공간정보 오픈플랫폼) 배경지도: 기본 / 백지도 / 위성(+도로·지명)
async function setupBaseMap() {
  let key = '';
  try { key = (await api('/api/config')).vworldKey; } catch {}
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
  if (!key) { osm.addTo(map); return; }
  const attr = '© <a href="https://www.vworld.kr" target="_blank">브이월드</a>(국토교통부)';
  const vw = (layer, ext = 'png') => L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/{z}/{y}/{x}.${ext}`, { minZoom: 6, maxZoom: 19, attribution: attr });
  const base = vw('Base'), white = vw('white');
  const sat = L.layerGroup([vw('Satellite', 'jpeg'), vw('Hybrid')]);
  base.addTo(map);
  L.control.layers({ '브이월드 기본지도': base, '브이월드 백지도': white, '브이월드 위성지도': sat, 'OpenStreetMap': osm }, null, { position: 'topright', collapsed: true }).addTo(map);
  // 브이월드 타일이 계속 실패하면(키 오류 등) OSM으로 자동 전환
  let fails = 0;
  base.on('tileerror', () => { if (++fails === 8 && map.hasLayer(base)) { map.removeLayer(base); osm.addTo(map); setNotice('브이월드 지도를 불러오지 못해 OpenStreetMap으로 표시합니다. 브이월드 API 키·허용 도메인을 확인해 주세요.'); } });
}
function toggleLayer(k, on) { on ? S.layers[k].addTo(map) : S.layers[k].remove(); }
let dongGeo;
function drawDongs() {
  S.layers.dongs.clearLayers();
  dongGeo = L.geoJSON(S.dongs, {
    style: () => ({ color: '#6b7280', weight: 1, fillColor: '#94a3b8', fillOpacity: .04, dashArray: '3 3' }),
    onEachFeature: (f, l) => {
      l.bindTooltip(f.properties.name, { permanent: true, direction: 'center', className: 'dong-lbl' });
      l.on('click', () => { $('#dongSel').value = 'H:' + f.properties.name; S.dong = 'H:' + f.properties.name; renderAll(); highlightDong(); });
    },
  }).addTo(S.layers.dongs);
}
function highlightDong() {
  if (!dongGeo) return;
  const [t, n] = S.dong.split(':');
  let bounds = null;
  dongGeo.eachLayer((l) => {
    const on = t === 'H' && l.feature.properties.name === n;
    l.setStyle(on ? { color: '#D7262B', weight: 2.5, fillColor: '#D7262B', fillOpacity: .08, dashArray: null } : { color: '#6b7280', weight: 1, fillColor: '#94a3b8', fillOpacity: .04, dashArray: '3 3' });
    if (on) bounds = l.getBounds();
  });
  if (bounds) map.fitBounds(bounds, { padding: [30, 30] });
  else if (t === 'L') map.setView(LEGAL_CENTER[n], 15);
  else map.setView(GU_CENTER, 14);
}
function drawDev() {
  S.layers.dev.clearLayers();
  S.dev.forEach((d, i) => L.marker([d.lat, d.lon], { icon: L.divIcon({ className: '', html: `<div class="mk-dev">${i + 1}</div>` }) })
    .bindPopup(`<div class="pp"><h4>${esc(d.name)}</h4><div class="mu">${esc(d.type)} · ${esc(d.status)}</div><p style="margin:6px 0 0">${esc(d.desc)}</p></div>`).addTo(S.layers.dev));
}
function drawTopMarkers() {
  S.layers.top.clearLayers();
  const pts = [];
  S.top.forEach((t, i) => {
    const c = coordOf(t.dong, t.nm); t.lat = c.lat; t.lon = c.lon; t.approx = c.approx;
    const r = t.last;
    const m = L.marker([c.lat, c.lon], {
      icon: L.divIcon({ className: '', html: `<div class="mk ${t.key === S.selKey ? 'sel' : ''} ${c.approx ? 'approx' : ''}"><b>${i + 1}</b><span>${esc(t.nm)}<em>${S.topTab === 'wolse' ? `${fmtShort(r.dep)}/${r.rent}` : fmtShort(r.amt ?? r.dep)}</em></span></div>` }),
      zIndexOffset: t.key === S.selKey ? 1000 : 500 - i,
    }).bindPopup(popupHtml(t));
    m.on('click', () => selectComplex(t.key, true));
    m.addTo(S.layers.top); pts.push([c.lat, c.lon]);
  });
  if (pts.length && (!S.selKey || S.autoSel) && S.dong === 'all') map.fitBounds(pts, { paddingTopLeft: [20, 20], paddingBottomRight: [130, 20], maxZoom: 15 });
}
function popupHtml(t) {
  const r = t.last;
  return `<div class="pp"><h4>${esc(t.nm)}</h4><div class="mu">${t.dong}${t.approx ? ' · 위치 근사' : ''} · ${t.yr || '-'}년 준공</div>
    <div style="margin-top:6px">최근 실거래 <span class="pr">${priceTxt(r)}</span></div>
    <div class="mu">${fmtD(r.d)} · 전용 ${r.area}㎡ · ${r.flr}층</div></div>`;
}
function drawListMarkers() {
  S.layers.list.clearLayers();
  ensureGeo(S.listings.map((l) => `${l.dong}|${l.nm}`)).then(() => {
    S.layers.list.clearLayers();
    S.listings.forEach((l) => {
      const c = coordOf(l.dong, l.nm);
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: '<div class="mk-star">⭐</div>' }), zIndexOffset: 800 })
        .bindTooltip(`<b>[${esc(l.menu)}]</b> ${esc(l.nm)} ${esc(l.deal)} ${esc(l.price)}`)
        .on('click', () => selectComplex(`${l.dong}|${l.nm}`, true, l)).addTo(S.layers.list);
    });
  });
}

// ---------- 추천매물 ----------
function renderListings() {
  const menus = [...new Set(S.listings.map((l) => l.menu))];
  if (S.listMenu !== '전체' && !menus.includes(S.listMenu)) S.listMenu = '전체';
  $('#listTabs').innerHTML = ['전체', ...menus].map((m) => `<button data-v="${esc(m)}" class="${m === S.listMenu ? 'on' : ''}">${esc(m)}${m === '전체' ? '' : ` <small>${S.listings.filter((l) => l.menu === m).length}</small>`}</button>`).join('');
  $$('#listTabs button').forEach((b) => b.onclick = () => { S.listMenu = b.dataset.v; renderListings(); });
  $('#menuOpts').innerHTML = menus.map((m) => `<option value="${esc(m)}">`).join('');
  const aptNames = [...new Set(S.sale.concat(S.rent).filter((r) => r.usg === '아파트').map((r) => r.nm))].sort();
  $('#aptOpts').innerHTML = aptNames.map((n) => `<option value="${esc(n)}">`).join('');
  const items = S.listings.filter((l) => S.listMenu === '전체' || l.menu === S.listMenu);
  $('#listGrid').innerHTML = items.map((l) => {
    const k = `${l.dong}|${l.nm}`;
    const recent = S.sale.filter((r) => keyOf(r) === k).sort((a, b) => b.d.localeCompare(a.d))[0];
    return `<div class="lcard ${k === S.selKey ? 'sel' : ''}" data-id="${esc(l.id)}">
      <button class="edit" data-edit="${esc(l.id)}">수정</button>
      <span class="badge">${esc(l.menu)}</span><span class="badge deal">${esc(l.deal)}</span>${l.sample ? '<span class="badge smp">샘플</span>' : ''}
      <h3>${esc(l.nm)}</h3>
      <div class="lp">${esc(l.price)}</div>
      <div class="lm">${esc(l.dong)}${l.hdong ? ' (' + esc(l.hdong) + ')' : ''} · ${l.area ? esc(l.area) + '㎡' : ''} ${esc(l.pyeong || '')} · ${esc(l.flr || '')} · ${esc(l.yr || '')}년</div>
      <div class="lf">${esc(l.feature || '')}</div>
      <div class="rt">${recent ? `단지 최근 매매 실거래 <b>${fmtMan(recent.amt)}</b> (${fmtD(recent.d)}, ${recent.area}㎡)` : '조회 기간 내 단지 매매 실거래 없음'}</div>
    </div>`;
  }).join('') || '<div class="none">등록된 매물이 없습니다. "+ 매물 등록"으로 추가하세요.</div>';
  $$('#listGrid .lcard').forEach((c) => c.onclick = (e) => {
    const l = S.listings.find((x) => x.id === c.dataset.id);
    if (e.target.dataset.edit) return openListDlg(l);
    selectComplex(`${l.dong}|${l.nm}`, true, l, 'analysis');
  });
  drawListMarkers();
}
function openListDlg(l) {
  const f = $('#listForm'); f.reset();
  $('#dlgTitle').textContent = l ? '추천 매물 수정' : '추천 매물 등록';
  $('#delListBtn').style.display = l ? '' : 'none';
  if (l) for (const [k, v] of Object.entries(l)) if (f.elements[k]) f.elements[k].value = v;
  $('#listDlg').showModal();
}
async function saveListing(e) {
  if (e.submitter?.value !== 'ok') return;
  const data = Object.fromEntries(new FormData(e.target));
  if (!data.id) delete data.id;
  data.area = data.area ? +data.area : '';
  const prev = S.listings.find((x) => x.id === data.id);
  if (prev) data.sample = false;
  data.hdong = '';
  await api('/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  S.listings = await api('/api/listings');
  await ensureGeo([`${data.dong}|${data.nm}`]);
  S.listings.forEach((x) => { if (!x.hdong) { const g = S.geo[`${x.dong}|${x.nm}`]; if (g) x.hdong = hdongOf(g.lat, g.lon) || ''; } });
  renderListings();
}
async function delListing() {
  const id = $('#listForm').elements.id.value;
  if (!id || !confirm('이 매물을 삭제할까요?')) return;
  await api('/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleteId: id }) });
  S.listings = await api('/api/listings'); $('#listDlg').close(); renderListings();
}

// ---------- 단지 선택 → 입지분석 ----------
function scrollToAnalysis() {
  const y = $('#analysis').getBoundingClientRect().top + scrollY - 70; // 고정 헤더 높이만큼 보정
  scrollTo({ top: y, behavior: 'smooth' });
}
async function selectComplex(key, fromMap, listing, scrollMode) {
  const auto = scrollMode === 'auto'; // 1위 자동 표시: 지도 확대·주변시설 마커·스크롤 없이 입지분석만 펼침
  if (!auto) S.autoSel = false;       // 사용자가 직접 고르면 그 뒤로는 자동 표시 안 함
  S.selKey = key;
  const [dong, nm] = key.split('|');
  $$('#topList li').forEach((li) => li.classList.toggle('sel', li.dataset.k === key));
  $$('#listGrid .lcard').forEach((c) => { const l = S.listings.find((x) => x.id === c.dataset.id); c.classList.toggle('sel', l && `${l.dong}|${l.nm}` === key); });
  await ensureGeo([key]);
  if (S.selKey !== key) return;
  drawTopMarkers();
  const c = coordOf(dong, nm);
  if (!auto) {
    map.setView([c.lat, c.lon], 16, { animate: true });
    $('#mapTitle').textContent = `${nm} 주변 · 최근 실거래가`;
  } else S.layers.poi.clearLayers();
  $('#goAnalysis').hidden = false;
  const sec = $('#analysis');
  sec.innerHTML = `<div class="loading"><span class="spin"></span>${esc(nm)} 입지분석 자료를 불러오는 중…</div>`;
  // 스크롤: TOP10 클릭 → 지도가 화면 밖일 때만 지도로 / 추천매물 카드 클릭 → 입지분석이 그려진 뒤 그곳으로 / 지도 마커 클릭 → 그대로
  if (scrollMode === 'map') {
    const r = $('#map').getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight) $('.mapcard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 단지 2년 거래 이력 + 주변시설
  const to = toYmd(new Date()), from = toYmd(new Date(Date.now() - 730 * 864e5));
  const poiP = api(`/api/poi?lat=${c.lat}&lon=${c.lon}`).catch((e) => ({ error: e.message }));
  const [s2, r2] = await Promise.all([api(`/api/trades?kind=sale&from=${from}&to=${to}`), api(`/api/trades?kind=rent&from=${from}&to=${to}`)]);
  if (S.selKey !== key) return;
  const sales = s2.rows.filter((r) => keyOf(r) === key).sort((a, b) => b.d.localeCompare(a.d));
  const rents = r2.rows.filter((r) => keyOf(r) === key).sort((a, b) => b.d.localeCompare(a.d));
  const ctx = { key, dong, nm, c, sales, rents, pois: [], loadingPoi: true, listing, auto };
  const t = setTimeout(() => { if (S.selKey !== key) return; renderAnalysis(ctx); if (scrollMode === 'analysis') { scrollMode = null; scrollToAnalysis(); } }, 400); // 주변시설이 늦으면 먼저 표시
  const poiRes = await poiP;
  clearTimeout(t);
  if (S.selKey !== key) return;
  const pois = (poiRes.pois || []).map((p) => ({ ...p, dist: distM(c.lat, c.lon, p.lat, p.lon) })).sort((a, b) => a.dist - b.dist);
  renderAnalysis({ ...ctx, pois, loadingPoi: false, poiErr: poiRes.error });
  if (scrollMode === 'analysis') scrollToAnalysis();
  if (!auto) drawPois(c, pois);
}

const LINE_COLOR = { '2': '#00A84D', '신림': '#6789CA', '4': '#00A5DE', '7': '#747F00', '1': '#0052A4' };
function lineOf(p) {
  const s = `${p.line} ${p.op} ${p.name}`;
  if (/신림선|신림 ?경전철|LRT/i.test(s) || /^(관악산|서울대벤처타운|서원|당곡|보라매병원|보라매공원)/.test(p.name)) return '신림';
  if (/7호선|Line 7/.test(s) || /^(숭실대입구|상도|장승배기|신대방삼거리|보라매|남성|이수)/.test(p.name)) return '7';
  if (/4호선|Line 4/.test(s)) return '4';
  if (/2호선|Line 2/.test(s) || /^(서울대입구|봉천|신림|낙성대|사당|신대방|구로디지털단지|대림)/.test(p.name)) return '2';
  return '';
}
function classify(pois) {
  const uniq = (arr) => { const seen = new Set(); return arr.filter((p) => { const k = p.name.replace(/\s|역$/g, ''); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const school = pois.filter((p) => p.k === 'school');
  return {
    subway: uniq(pois.filter((p) => p.k === 'station' && p.dist <= 1500)).slice(0, 6),
    bus: uniq(pois.filter((p) => p.k === 'bus_stop')),
    ele: uniq(school.filter((p) => /초등학교/.test(p.name))).slice(0, 4),
    mid: uniq(school.filter((p) => /중학교/.test(p.name))).slice(0, 4),
    high: uniq(school.filter((p) => /고등학교|고교/.test(p.name))).slice(0, 4),
    kinder: uniq(pois.filter((p) => p.k === 'kindergarten')).slice(0, 4),
    univ: uniq(pois.filter((p) => p.k === 'university')).slice(0, 2),
    market: uniq(pois.filter((p) => p.k !== 'bus_stop' && /시장/.test(p.name))).slice(0, 6),
    plaza: uniq(pois.filter((p) => p.k === 'marketplace' && !/시장/.test(p.name))).slice(0, 4),
    mart: uniq(pois.filter((p) => ['supermarket', 'department_store', 'mall'].includes(p.k))).slice(0, 6),
    gov: uniq(pois.filter((p) => ['townhall', 'police', 'post_office', 'government', 'fire_station'].includes(p.k) || (p.k === 'community_centre' && /주민센터|자치회관|구청/.test(p.name)))).slice(0, 7),
    bank: uniq(pois.filter((p) => p.k === 'bank')).slice(0, 6),
    hosp: uniq(pois.filter((p) => p.k === 'hospital')).slice(0, 4),
    lib: uniq(pois.filter((p) => p.k === 'library')).slice(0, 4),
    park: uniq(pois.filter((p) => p.k === 'park')).slice(0, 5),
  };
}
function scoreOf(P, devNear) {
  const cl = (v) => Math.max(0, Math.min(100, Math.round(v)));
  const sub0 = P.subway[0]?.dist ?? 2000;
  const trans = cl((sub0 <= 300 ? 70 : sub0 <= 600 ? 58 : sub0 <= 1000 ? 42 : 25) + Math.min(P.subway.length, 3) * 5 + Math.min(P.bus.length, 10) * 1.5);
  const e0 = P.ele[0]?.dist ?? 1500, m0 = P.mid[0]?.dist ?? 2000, h0 = P.high[0]?.dist ?? 2500;
  const edu = cl(100 - e0 / 15 - m0 / 40 - h0 / 60 + P.kinder.length * 2);
  const comm = cl(P.market.length * 9 + P.mart.length * 6 + P.bank.length * 4 + 20);
  const life = cl(P.gov.length * 6 + P.hosp.length * 8 + P.lib.length * 5 + P.park.length * 6 + 15);
  const dev = cl(30 + devNear.filter((d) => d.dist < 1500).length * 22 + devNear.filter((d) => d.dist < 3000).length * 6);
  return { trans, edu, comm, life, dev, total: Math.round((trans * .3 + edu * .2 + comm * .2 + life * .15 + dev * .15)) };
}

function renderAnalysis({ dong, nm, c, sales, rents, pois, poiErr, listing, loadingPoi, auto }) {
  const P = classify(pois);
  const hd = c.approx ? null : hdongOf(c.lat, c.lon);
  const devs = S.dev.map((d) => ({ ...d, dist: distM(c.lat, c.lon, d.lat, d.lon) })).sort((a, b) => a.dist - b.dist);
  const sc = scoreOf(P, devs);
  const je = rents.filter((r) => r.se === '전세'), wo = rents.filter((r) => r.se === '월세');
  const ls = sales[0], lj = je[0], lw = wo[0];
  const yr = (ls || lj || lw)?.yr;
  const noneTxt = loadingPoi ? '<div class="loading"><span class="spin"></span>주변시설 조회 중…</div>' : '<div class="none">반경 내 정보 없음</div>';
  const li = (arr, extra) => loadingPoi ? '<div class="loading"><span class="spin"></span>주변시설 조회 중…</div>' : arr.length ? `<ul class="pl">${arr.map((p) => `<li><span class="nm">${extra ? extra(p) : ''}${esc(p.name)}</span><span class="ds">${fmtDist(p.dist)} · 도보 ${walk(p.dist)}</span></li>`).join('')}</ul>` : '<div class="none">반경 내 정보 없음</div>';
  const lineBadge = (p) => { const l = lineOf(p); return l ? `<span class="ln" style="background:${LINE_COLOR[l]}">${l === '신림' ? '신림선' : l + '호선'}</span>` : ''; };

  // 브리핑 요약 문장
  const bits = [];
  if (P.subway[0]) bits.push(`<b>${esc(P.subway[0].name.replace(/역$/, ''))}역</b> 도보 ${walk(P.subway[0].dist)}`);
  if (P.ele[0]) bits.push(`<b>${esc(P.ele[0].name)}</b> ${fmtDist(P.ele[0].dist)}`);
  if (P.market[0]) bits.push(`<b>${esc(P.market[0].name)}</b> ${fmtDist(P.market[0].dist)}`);
  if (P.mart[0]) bits.push(`마트 ${P.mart.length}곳`);
  if (devs[0] && devs[0].dist < 2000) bits.push(`인근 개발계획 <b>${esc(devs[0].name)}</b>(${fmtDist(devs[0].dist)})`);
  const pyAvg = sales.length ? Math.round(avg(sales.slice(0, 10).map((r) => r.amt / py(r.area)))) : null;

  $('#analysis').innerHTML = `
    <div class="an-head">
      <div>
        <div style="font-size:12px;color:var(--red);font-weight:800">입지분석 리포트 · SK부동산${auto ? ` · <span class="auto-badge">현재 ${esc(dongLabel())} ${({ sale: '매매', jeonse: '전세', wolse: '월세' })[S.topTab]} TOP 10 1위 (${S.sort === 'price' ? '최고가' : '거래량'} 기준)</span>` : ''}</div>
        <h2>${esc(nm)}</h2>
        <div class="loc">서울 관악구 ${esc(dong)}${hd ? ` · 행정동 ${esc(hd)}` : ''}${yr ? ` · ${yr}년 준공` : ''}${c.approx ? ' · <span style="color:#b45309">위치 근사(정확한 좌표 미확인)</span>' : ''}${listing ? ` · 추천매물 <b style="color:var(--red)">${esc(listing.deal)} ${esc(listing.price)}</b>` : ''}</div>
        ${auto ? '<div class="auto-hint">다른 단지는 위의 TOP 10 목록·지도·추천매물에서 선택하세요.</div>' : ''}
      </div>
      <div class="an-prices">
        <div class="an-price"><div class="l">최근 매매 실거래</div><div class="v">${ls ? fmtMan(ls.amt) : '-'}</div><div class="s">${ls ? `${fmtD(ls.d)} · ${ls.area}㎡ · ${ls.flr}층` : '최근 2년 거래 없음'}</div></div>
        <div class="an-price"><div class="l">최근 전세 실거래</div><div class="v">${lj ? fmtMan(lj.dep) : '-'}</div><div class="s">${lj ? `${fmtD(lj.d)} · ${lj.area}㎡ · ${lj.nu || ''}` : '최근 2년 거래 없음'}</div></div>
        <div class="an-price"><div class="l">최근 월세 실거래</div><div class="v">${lw ? `${fmtMan(lw.dep)}/${lw.rent}만` : '-'}</div><div class="s">${lw ? `${fmtD(lw.d)} · ${lw.area}㎡` : '최근 2년 거래 없음'}</div></div>
        <div class="an-price"><div class="l">최근 10건 평균 평당가</div><div class="v">${pyAvg ? pyAvg.toLocaleString() + '만' : '-'}</div><div class="s">3.3㎡당 · 매매 기준</div></div>
      </div>
    </div>
    ${loadingPoi ? '<div class="brief">📋 <b>브리핑 포인트</b> — <span class="spin"></span>주변시설 조회 후 표시됩니다…</div>' : bits.length ? `<div class="brief">📋 <b>브리핑 포인트</b> — ${bits.join(' · ')}. 종합 입지점수 <b>${sc.total}점</b>(자체 산정).</div>` : ''}
    ${poiErr ? `<div class="notice on" style="margin-bottom:12px">주변시설 정보(OpenStreetMap) 조회에 실패했습니다: ${esc(poiErr)} — 잠시 후 다시 선택해 주세요.</div>` : ''}
    <div class="an-grid">
      <div class="an-box">
        <h3><span class="ic" style="background:#16a34a">🚇</span>교통</h3>
        <h4>지하철역 (반경 1.5km)</h4>${li(P.subway, lineBadge)}
        <h4>버스정류장 (반경 500m)${loadingPoi ? '' : ` · ${P.bus.length}곳`}</h4>
        ${P.bus.length ? `<div class="chips">${P.bus.slice(0, 10).map((b) => `<span class="chip">${esc(b.name)} ${fmtDist(b.dist)}</span>`).join('')}</div>` : noneTxt}
      </div>
      <div class="an-box">
        <h3><span class="ic" style="background:#f59e0b">🏫</span>학군</h3>
        <h4>초등학교</h4>${li(P.ele)}
        <h4>중학교</h4>${li(P.mid)}
        <h4>고등학교</h4>${li(P.high)}
        ${P.kinder.length ? `<h4>유치원</h4>${li(P.kinder.slice(0, 3))}` : ''}
      </div>
      <div class="an-box">
        <h3><span class="ic" style="background:#e11d48">🛒</span>상권 · 생활편의</h3>
        <h4>재래시장</h4>${li(P.market.slice(0, 4))}
        ${P.plaza.length ? `<h4>근린상가</h4><div class="chips">${P.plaza.map((b) => `<span class="chip">${esc(b.name)} ${fmtDist(b.dist)}</span>`).join('')}</div>` : ''}
        <h4>마트 · 백화점</h4>${li(P.mart.slice(0, 4))}
        <h4>은행</h4>${P.bank.length ? `<div class="chips">${P.bank.map((b) => `<span class="chip">${esc(b.name)} ${fmtDist(b.dist)}</span>`).join('')}</div>` : noneTxt}
      </div>
      <div class="an-box">
        <h3><span class="ic" style="background:#475569">🏛️</span>관공서 · 의료 · 공원</h3>
        <h4>관공서 (주민센터·구청·경찰·우체국 등)</h4>${li(P.gov.slice(0, 5))}
        <h4>병원 · 도서관</h4>${li(P.hosp.slice(0, 2).concat(P.lib.slice(0, 2)).sort((a, b) => a.dist - b.dist))}
        <h4>공원</h4>${P.park.length ? `<div class="chips">${P.park.map((b) => `<span class="chip">${esc(b.name)} ${fmtDist(b.dist)}</span>`).join('')}</div>` : noneTxt}
      </div>
      <div class="an-box wide">
        <h3><span class="ic" style="background:var(--red)">★</span>입지 점수 (자체 산정 참고지표)</h3>
        <div class="score-wrap">
          <div style="text-align:center"><div class="score-big">${loadingPoi ? '–' : sc.total}<small> / 100</small></div>
            <div class="hint" style="margin-top:6px">교통30 · 학군20 · 상권20 · 생활15 · 개발15 가중</div></div>
          <div style="position:relative;height:230px"><canvas id="radarChart"></canvas></div>
        </div>
      </div>
      <div class="an-box full">
        <h3><span class="ic" style="background:var(--pp)">🏗️</span>주변 개발계획 (가까운 순)</h3>
        <div class="dev-list">${devs.map((d) => `<div class="dev ${d.dist < 1500 ? 'near' : ''}"><div class="dt"><b>${esc(d.name)}</b><span class="ty">${esc(d.type)}</span></div>
          <div class="st">${esc(d.status)} · ${fmtDist(d.dist)}</div><p>${esc(d.desc)}</p></div>`).join('')}</div>
        <p class="foot-note">공개 자료 기반 요약이며 사업 일정·내용은 변동될 수 있습니다. data/development.json 파일에서 항목을 추가·수정할 수 있습니다.</p>
      </div>
      <div class="an-box wide">
        <h3><span class="ic" style="background:#0f766e">📈</span>매매 실거래가 추이 (최근 2년)</h3>
        <div style="position:relative;height:250px"><canvas id="aptChart"></canvas></div>
      </div>
      <div class="an-box">
        <h3><span class="ic" style="background:#1f2328">🧾</span>최근 실거래 내역</h3>
        <table class="tbl"><thead><tr><th>계약일</th><th>구분</th><th class="r">전용㎡</th><th class="r">층</th><th class="r">금액</th></tr></thead><tbody>
        ${sales.slice(0, 6).map((r) => `<tr><td>${fmtD(r.d)}</td><td>매매</td><td class="r">${r.area}</td><td class="r">${r.flr}</td><td class="r"><b>${fmtMan(r.amt)}</b></td></tr>`).join('')}
        ${rents.slice(0, 6).map((r) => `<tr><td>${fmtD(r.d)}</td><td>${r.se}</td><td class="r">${r.area}</td><td class="r">${r.flr}</td><td class="r">${r.se === '전세' ? fmtMan(r.dep) : `${fmtMan(r.dep)}/${r.rent}`}</td></tr>`).join('')}
        ${!sales.length && !rents.length ? '<tr><td colspan="5" class="none">최근 2년 거래 없음</td></tr>' : ''}
        </tbody></table>
      </div>
    </div>`;

  if (!loadingPoi) mkChart('radarChart', {
    type: 'radar',
    data: { labels: ['교통', '학군', '상권', '생활편의', '개발호재'], datasets: [{ label: nm, data: [sc.trans, sc.edu, sc.comm, sc.life, sc.dev], backgroundColor: 'rgba(215,38,43,.18)', borderColor: '#D7262B', pointBackgroundColor: '#D7262B' }] },
    options: { interaction: { mode: 'nearest' }, plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, display: false }, pointLabels: { font: { size: 12, family: 'Noto Sans KR', weight: 700 } } } } },
  });
  // 면적대별 산점도
  const groups = {};
  sales.forEach((r) => { const g = Math.round(r.area) <= 62 ? '소형(~60㎡)' : r.area <= 86 ? '중형(60~85㎡)' : '대형(85㎡~)'; (groups[g] = groups[g] || []).push(r); });
  const col = { '소형(~60㎡)': '#C8643B', '중형(60~85㎡)': '#D7262B', '대형(85㎡~)': '#7A2E8C' };
  mkChart('aptChart', {
    type: 'scatter',
    data: { datasets: Object.entries(groups).map(([g, rs]) => ({ label: g, data: rs.map((r) => ({ x: new Date(+r.d.slice(0, 4), +r.d.slice(4, 6) - 1, +r.d.slice(6, 8)).getTime(), y: r.amt / 10000, r })), backgroundColor: col[g], pointRadius: 4 })) },
    options: {
      interaction: { mode: 'nearest', intersect: true },
      scales: { x: { type: 'linear', ticks: { callback: (v) => { const d = new Date(v); return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`; } } }, y: { title: { display: true, text: '억원' } } },
      plugins: { tooltip: { callbacks: { label: (ctx) => { const r = ctx.raw.r; return `${fmtD(r.d)} ${r.area}㎡ ${r.flr}층 ${fmtMan(r.amt)}`; } } } },
    },
  });
}

const POI_STYLE = { station: ['#16a34a', 'M'], bus_stop: ['#0ea5e9', 'B'], school: ['#f59e0b', '학'], marketplace: ['#e11d48', '시'], supermarket: ['#e11d48', '마'], department_store: ['#e11d48', '백'], mall: ['#e11d48', '몰'], bank: ['#475569', '₩'], townhall: ['#475569', '관'], police: ['#475569', '경'], post_office: ['#475569', '우'], government: ['#475569', '관'], hospital: ['#475569', '병'] };
function drawPois(c, pois) {
  S.layers.poi.clearLayers();
  L.circle([c.lat, c.lon], { radius: 500, color: '#D7262B', weight: 1, fillOpacity: .03, dashArray: '4 4' }).addTo(S.layers.poi);
  L.circle([c.lat, c.lon], { radius: 1000, color: '#D7262B', weight: 1, fill: false, dashArray: '2 6' }).addTo(S.layers.poi);
  pois.filter((p) => POI_STYLE[p.k] && p.dist < 1100 && (p.k !== 'bus_stop' || p.dist < 400)).forEach((p) => {
    const [bg, t] = POI_STYLE[p.k];
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="mk-poi" style="background:${bg}">${t}</div>` }), zIndexOffset: -100 })
      .bindTooltip(`${esc(p.name)} · ${fmtDist(p.dist)}`).addTo(S.layers.poi);
  });
}

// ---------- 시장 지표 ----------
async function loadMarket() {
  try {
    const m = await api('/api/market');
    renderMarket(m);
  } catch (e) { $('#mkChips').innerHTML = `<div class="none">시장 지표를 불러오지 못했습니다: ${esc(e.message)}</div>`; }
  api('/api/molit').then(renderMolit).catch((e) => renderMolit({ ok: false, msg: e.message }));
}
const ymLabel = (t) => `${t.slice(2, 4)}.${t.slice(4, 6)}`;
function renderMarket(m) {
  $('#mkUpdated').textContent = m.updated ? `갱신 ${m.updated.slice(0, 10)}` : '';
  const chips = [];
  const sup = m.supply, vol = m.volume?.gwanak || [], jr = m.jeonseRatio, br = m.buyerRes, ba = m.buyerAge;
  if (sup?.sale?.swr?.length) {
    const a = sup.sale.swr.at(-1), b = sup.sale.swr.at(-5);
    chips.push({ l: '매매수급지수(서남권)', v: a.v.toFixed(1), s: `4주 전 ${b?.v.toFixed(1)} · 서울 ${sup.sale.seoul.at(-1)?.v.toFixed(1)} · ${a.label}` });
  }
  if (vol.length) {
    const a = vol.at(-1), y = vol.find((x) => x.t === String(+a.t - 100));
    const avg12 = Math.round(avg(vol.slice(-12).map((x) => x.v)));
    chips.push({ l: `아파트 매매거래 (${a.label})`, v: `${a.v.toLocaleString()}건`, s: `전년 동월 ${y ? y.v + '건' : '-'} · 12개월 평균 ${avg12}건` });
  }
  if (jr?.gwanak?.length) chips.push({ l: `전세가율 (${jr.gwanak.at(-1).label})`, v: jr.gwanak.at(-1).v.toFixed(1) + '%', s: `서울 ${jr.seoul.at(-1)?.v.toFixed(1)}% · 1년 전 ${jr.gwanak.at(-13)?.v.toFixed(1)}%` });
  const sum12 = (arr) => (arr || []).slice(-12).reduce((x, y) => x + y.v, 0);
  if (br?.total?.length) {
    const t = sum12(br.total);
    chips.push({ l: '외지인 매입 비중 (최근 12개월)', v: t ? Math.round(((sum12(br.inSeoul) + sum12(br.outside)) / t) * 100) + '%' : '-', s: `서울 타구 ${t ? Math.round(sum12(br.inSeoul) / t * 100) : '-'}% · 타 시도 ${t ? Math.round(sum12(br.outside) / t * 100) : '-'}%` });
  }
  if (ba) {
    const tot = Object.values(ba).reduce((x, arr) => x + sum12(arr), 0);
    const y = sum12(ba['20대 이하']) + sum12(ba['30대']);
    chips.push({ l: '2030 매입 비중 (최근 12개월)', v: tot ? Math.round(y / tot * 100) + '%' : '-', s: `30대 ${tot ? Math.round(sum12(ba['30대']) / tot * 100) : '-'}% · 40대 ${tot ? Math.round(sum12(ba['40대']) / tot * 100) : '-'}%` });
  }
  $('#mkChips').innerHTML = chips.map((c) => `<div class="mk-chip"><div class="l">${c.l}</div><div class="v">${c.v}</div><div class="s">${c.s}</div></div>`).join('');

  if (sup) {
    const base = sup.sale.swr.slice(-52);
    const pick = (arr) => base.map((p) => arr.find((x) => x.t === p.t)?.v ?? null);
    mkChart('supChart', { type: 'line', data: { labels: base.map((p) => p.label.slice(2).replace(/-/g, '.')), datasets: [
      { label: '서남권 매매', data: pick(sup.sale.swr), borderColor: '#D7262B', backgroundColor: '#D7262B', pointRadius: 0, tension: .3 },
      { label: '서울 매매', data: pick(sup.sale.seoul), borderColor: '#9aa1a9', borderDash: [5, 4], backgroundColor: '#9aa1a9', pointRadius: 0, tension: .3 },
      { label: '서남권 전세', data: pick(sup.jeonse.swr), borderColor: '#7A2E8C', backgroundColor: '#7A2E8C', pointRadius: 0, tension: .3 },
    ] } });
  }
  if (vol.length) {
    const v = vol.slice(-36), sv = m.volume.seoul || [];
    mkChart('mvolChart', { data: { labels: v.map((p) => ymLabel(p.t)), datasets: [
      { type: 'bar', label: '관악구(건)', data: v.map((p) => p.v), backgroundColor: v.map((p, i) => i === v.length - 1 ? '#D7262B' : 'rgba(215,38,43,.45)'), yAxisID: 'y' },
      { type: 'line', label: '서울(건, 우측)', data: v.map((p) => sv.find((x) => x.t === p.t)?.v ?? null), borderColor: '#454545', backgroundColor: '#454545', pointRadius: 0, tension: .3, yAxisID: 'y1' },
    ] }, options: { scales: { y1: { position: 'right', grid: { display: false } } } } });
  }
  if (jr?.gwanak?.length) {
    const g = jr.gwanak.slice(-36);
    mkChart('ratioChart', { type: 'line', data: { labels: g.map((p) => ymLabel(p.t)), datasets: [
      { label: '관악구', data: g.map((p) => p.v), borderColor: '#D7262B', backgroundColor: 'rgba(215,38,43,.08)', fill: true, pointRadius: 0, tension: .3 },
      { label: '서울', data: g.map((p) => jr.seoul.find((x) => x.t === p.t)?.v ?? null), borderColor: '#9aa1a9', borderDash: [5, 4], pointRadius: 0, tension: .3 },
    ] }, options: { scales: { y: { ticks: { callback: (v) => v + '%' } } } } });
  }
  if (br?.total?.length) {
    const t = br.total.slice(-24);
    const pick = (arr) => t.map((p) => arr.find((x) => x.t === p.t)?.v ?? 0);
    mkChart('resChart', { type: 'bar', data: { labels: t.map((p) => ymLabel(p.t)), datasets: [
      { label: '관악구 내', data: pick(br.inGu), backgroundColor: '#C8643B', stack: 's' },
      { label: '서울 타 자치구', data: pick(br.inSeoul), backgroundColor: '#B8235A', stack: 's' },
      { label: '타 시도', data: pick(br.outside), backgroundColor: '#7A2E8C', stack: 's' },
    ] }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
  }
  if (ba) {
    const names = Object.keys(ba);
    const last = ba['30대']?.slice(-12) || [];
    $('#ageHint').textContent = last.length ? `${last[0].label} ~ ${last.at(-1).label} 합계` : '';
    mkChart('ageChart', { type: 'doughnut', data: { labels: names, datasets: [{ data: names.map((n) => sum12(ba[n])), backgroundColor: ['#f4a261', '#D7262B', '#B8235A', '#7A2E8C', '#454545', '#9aa1a9', '#d6d9de'], borderWidth: 1 }] },
      options: { interaction: { mode: 'nearest' }, cutout: '55%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { family: 'Noto Sans KR' } } }, tooltip: { callbacks: { label: (c) => { const tot = c.dataset.data.reduce((x, y) => x + y, 0); return `${c.label}: ${c.raw}건 (${Math.round(c.raw / tot * 100)}%)`; } } } } } });
  }
}
function renderMolit(r) {
  const box = $('#molitBox');
  if (!r.ok) {
    box.innerHTML = `<div class="wait"><b>공공데이터포털 연결 대기</b><br>${esc(r.msg || '')}<br>API 키는 등록되어 있으며, 공공데이터포털 서버에 접속되면 매수자(개인/법인)·직거래 비율·계약해제·등기완료 현황이 자동으로 표시됩니다.</div>`;
    return;
  }
  const ms = r.months.filter((m) => m.n);
  const sum = (k) => ms.reduce((x, m) => x + m[k], 0);
  const n = sum('n'), pct = (k) => n ? (sum(k) / n * 100).toFixed(1) + '%' : '-';
  box.innerHTML = `
    <div class="row"><span>집계 기간</span><b>${ms.length ? ymLabel(ms[0].ym) + ' ~ ' + ymLabel(ms.at(-1).ym) : '-'}</b></div>
    <div class="row"><span>아파트 매매 (해제 제외)</span><b>${n.toLocaleString()}건</b></div>
    <div class="row"><span>매수자 개인 / 법인</span><b>${pct('buyerPerson')} / ${pct('buyerCorp')}</b></div>
    <div class="row"><span>매도자 법인 비중</span><b>${pct('sellerCorp')}</b></div>
    <div class="row"><span>중개거래 / 직거래</span><b>${pct('broker')} / ${pct('direct')}</b></div>
    <div class="row"><span>계약 해제 건수</span><b>${sum('cancel').toLocaleString()}건</b></div>
    <div class="row"><span>등기 완료 비율</span><b>${pct('rgst')}</b></div>
    <p class="foot-note">직거래 비중이 높으면 가족 간 거래 등 시세와 다른 거래가 섞였을 수 있어 시세 판단 시 참고하세요.</p>`;
}

// ---------- 인쇄 ----------
function beforePrint() {
  const dl = $('#dongSel').selectedOptions[0]?.textContent || '관악구 전체';
  $('#printHead').innerHTML = `<span><b>${esc(dl)}</b> · ${$('#usgSel').selectedOptions[0].textContent} · 조회기간 ${toInput(S.from)} ~ ${toInput(S.to)} · ${S.cycle === 'weekly' ? '주간' : '월간'}</span><span>출력일 ${new Date().toLocaleDateString('ko-KR')} · SK부동산 02-885-3200</span>`;
  chartsToImages();
  fitMapForPrint();
}
function chartsToImages() { // 차트를 화면 비율 그대로 이미지로 만들어 인쇄
  $$('img.print-img').forEach((i) => i.parentNode.removeChild(i));
  Object.values(S.charts).forEach((c) => {
    try {
      const img = new Image();
      img.className = 'print-img';
      img.src = c.toBase64Image('image/png', 1);
      c.canvas.insertAdjacentElement('afterend', img);
    } catch {}
  });
  document.body.classList.add('printing');
}
// 지도는 다시 맞추지 않고, 화면에 보이던 그대로를 인쇄 폭(약 560px)에 맞게 축소해서 찍는다
function fitMapForPrint() {
  const m = $('#map');
  if (!m || document.body.classList.contains('map-frozen')) return;
  const w = m.clientWidth, h = m.clientHeight;
  if (!w) return;
  m.style.setProperty('--map-w', w + 'px');
  m.style.setProperty('--map-h', h + 'px');
  m.style.setProperty('--map-zoom', Math.min(1, 560 / w).toFixed(4));
  document.body.classList.add('map-frozen');
}
try { matchMedia('print').addEventListener('change', (e) => { if (e.matches) { if (!document.body.classList.contains('printing')) chartsToImages(); fitMapForPrint(); } else afterPrint(); }); } catch {}
function afterPrint() {
  document.body.classList.remove('printing', 'map-frozen');
  $$('img.print-img').forEach((i) => i.parentNode.removeChild(i));
}
function doPrint() {
  beforePrint();
  // 앱 미리보기 창(iframe 등)에서는 인쇄가 막히는 경우가 있어 새 창으로 열어 인쇄
  const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
  if (framed) { window.open(location.origin + location.pathname + '#print', '_blank'); return; }
  setTimeout(() => {
    try { window.print(); } catch (e) { window.open(location.origin + location.pathname + '#print', '_blank'); }
  }, 300);
}

init();
