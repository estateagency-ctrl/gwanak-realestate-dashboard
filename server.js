// SK부동산 관악구 부동산 대시보드 - 로컬 서버 (Node 18+, 외부 패키지 없음)
// 실행: node server.js  →  http://localhost:8790
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, makeHdong, match, norm, LEGAL_TO_H } from './geomatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// API 키 설정: config.json (깃허브에는 올리지 않음). 없으면 config.example.json 을 복사해 키를 넣도록 안내
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\n  config.json 이 없습니다. config.example.json 을 config.json 으로 복사한 뒤 API 키를 입력하세요.\n    cp config.example.json config.json\n');
  process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = process.env.PORT || CONFIG.port || 8790;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const CACHE = path.join(DATA, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

const UA = { 'User-Agent': 'gwanak-realestate-dashboard/1.0' };
const GWANAK_CGG = '11620';
const BBOX = { s: 37.452, n: 37.498, w: 126.895, e: 126.99 }; // 관악구 대략 범위
const KEEP_USG = new Set(['아파트', '오피스텔', '연립다세대']);

// ---------- 공통 유틸 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => fs.writeFileSync(f, JSON.stringify(o));
const fresh = (f, ms) => { try { return Date.now() - fs.statSync(f).mtimeMs < ms; } catch { return false; } };
async function getJSON(url, opts = {}, retry = 2) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i >= retry) throw e; await sleep(800 * (i + 1)); }
  }
}
const inflight = new Map();
function once(key, fn) { // 같은 요청 동시 중복 방지
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

// ---------- 서울시 열린데이터광장: 부동산 실거래가 ----------
// 매매 tbLnOpendataRtmsV / 전월세 tbLnOpendataRentV  (접수연도·자치구 단위로 받아 캐시)
const SEOUL_SVC = { sale: 'tbLnOpendataRtmsV', rent: 'tbLnOpendataRentV' };
async function seoulYear(kind, year) {
  const file = path.join(CACHE, `${kind}_${year}.json`);
  const nowY = new Date().getFullYear();
  const ttl = year >= nowY - 1 ? 6 * 3600e3 : 30 * 24 * 3600e3;
  if (fresh(file, ttl)) return readJSON(file, []);
  return once(file, async () => {
    try {
      const svc = SEOUL_SVC[kind];
      const base = `http://openapi.seoul.go.kr:8088/${CONFIG.seoulKey}/json/${svc}`;
      const first = await getJSON(`${base}/1/1000/${year}/${GWANAK_CGG}`);
      if (!first[svc]) { writeJSON(file, []); return []; }
      const total = first[svc].list_total_count;
      let rows = first[svc].row || [];
      const pages = [];
      for (let s = 1001; s <= total; s += 1000) pages.push(s);
      for (let i = 0; i < pages.length; i += 6) {
        const chunk = await Promise.all(pages.slice(i, i + 6).map((s) =>
          getJSON(`${base}/${s}/${Math.min(s + 999, total)}/${year}/${GWANAK_CGG}`).then((j) => j[svc]?.row || [])));
        chunk.forEach((c) => (rows = rows.concat(c)));
      }
      const slim = rows.filter((r) => KEEP_USG.has(r.BLDG_USG) && !r.RTRCN_DAY).map((r) => kind === 'sale'
        ? { d: r.CTRT_DAY, dong: r.STDG_NM, jb: jibun(r), nm: (r.BLDG_NM || '').trim(), usg: r.BLDG_USG, amt: +r.THING_AMT, area: +r.ARCH_AREA, flr: +r.FLR, yr: r.ARCH_YR, how: r.DCLR_SE }
        : { d: r.CTRT_DAY, dong: r.STDG_NM, jb: jibun(r), nm: (r.BLDG_NM || '').trim(), usg: r.BLDG_USG, se: r.RENT_SE, dep: +r.GRFE, rent: +r.RTFE, area: +r.RENT_AREA, flr: +r.FLR, yr: r.ARCH_YR, prd: r.CTRT_PRD, nu: r.NEW_UPDT_YN });
      writeJSON(file, slim);
      console.log(`[서울시] ${kind} ${year}: ${slim.length}건 (원본 ${total})`);
      return slim;
    } catch (e) {
      console.error(`[서울시] ${kind} ${year} 실패:`, e.message);
      return readJSON(file, []); // 실패 시 이전 캐시라도 반환
    }
  });
}
function jibun(r) { const m = String(+r.MNO || ''), s = +r.SNO; return m ? (s ? `${m}-${s}` : m) : ''; }

async function trades(kind, from, to) {
  const y1 = +from.slice(0, 4), y2 = Math.min(+to.slice(0, 4) + 1, new Date().getFullYear());
  let all = [];
  for (let y = y1; y <= y2; y++) all = all.concat(await seoulYear(kind, y));
  const seen = new Set();
  return all.filter((r) => r.d >= from && r.d <= to).filter((r) => {
    const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true;
  });
}

// ---------- 한국부동산원 R-ONE ----------
const REB = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const REB_SERIES = {
  weekly: [
    { key: 'saleIdx', id: 'T244183132827305', name: '주간 아파트 매매가격지수' },
    { key: 'jeonseIdx', id: 'T247713133046872', name: '주간 아파트 전세가격지수' },
  ],
  monthly: [
    { key: 'saleIdx', id: 'A_2024_00045', name: '월간 아파트 매매가격지수' },
    { key: 'jeonseIdx', id: 'A_2024_00050', name: '월간 아파트 전세가격지수' },
    { key: 'rentIdx', id: 'A_2024_00055', name: '월간 아파트 월세가격지수' },
    { key: 'avgSale', id: 'A_2024_00060', name: '월간 아파트 평균매매가격(천원)' },
    { key: 'avgJeonse', id: 'A_2024_00064', name: '월간 아파트 평균전세가격(천원)' },
  ],
};
const REB_CLS = { weekly: { gwanak: 50066, seoul: 50008 }, monthly: { gwanak: 530035, seoul: 500008 } };
async function reb(cycle) {
  const file = path.join(CACHE, `reb_${cycle}.json`);
  if (fresh(file, 12 * 3600e3)) return readJSON(file, {});
  return once(file, async () => {
    try {
      const out = { cycle, series: {} };
      const dc = cycle === 'weekly' ? 'WK' : 'MM';
      for (const s of REB_SERIES[cycle]) {
        out.series[s.key] = { name: s.name };
        for (const [reg, cls] of Object.entries(REB_CLS[cycle])) {
          const u = `${REB}?KEY=${CONFIG.rebKey}&Type=json&STATBL_ID=${s.id}&DTACYCLE_CD=${dc}&CLS_ID=${cls}&pSize=1000&pIndex=1`;
          const j = await getJSON(u);
          const rows = (j.SttsApiTblData?.[1]?.row || []).filter((r) => r.ITM_ID === 100001 || r.ITM_ID === 10001 || true);
          out.series[s.key][reg] = rows.map((r) => ({ t: r.WRTTIME_IDTFR_ID, label: r.WRTTIME_DESC, v: r.DTA_VAL }))
            .sort((a, b) => a.t.localeCompare(b.t)).slice(-260);
        }
      }
      writeJSON(file, out);
      console.log(`[부동산원] ${cycle} 갱신`);
      return out;
    } catch (e) { console.error('[부동산원] 실패:', e.message); return readJSON(file, { error: e.message }); }
  });
}

// ---------- 시장지표: 부동산원(수급·거래량·매입자·전세가율) + 국토부(공공데이터포털) ----------
async function rebRows(params) { // 여러 페이지 자동 수집
  let all = [];
  for (let p = 1; p <= 10; p++) {
    const j = await getJSON(`${REB}?KEY=${CONFIG.rebKey}&Type=json&pSize=1000&pIndex=${p}&${params}`);
    const t = j.SttsApiTblData;
    if (!Array.isArray(t)) break;
    const rows = t[1]?.row || [];
    all = all.concat(rows);
    if (all.length >= t[0].head[0].list_total_count || !rows.length) break;
  }
  return all;
}
const series = (rows, f = () => true) => rows.filter(f).map((r) => ({ t: r.WRTTIME_IDTFR_ID, label: r.WRTTIME_DESC, v: r.DTA_VAL })).sort((a, b) => a.t.localeCompare(b.t));
async function market() {
  const file = path.join(CACHE, 'market.json');
  if (fresh(file, 12 * 3600e3)) return readJSON(file, {});
  return once(file, async () => {
    const out = { updated: new Date().toISOString() };
    const tasks = {
      // 주간 매매·전세 수급지수 (구 단위 미공표 → 관악구가 속한 서남권과 서울 비교)
      supply: async () => {
        const r = {};
        for (const [k, id] of [['sale', 'T248163133074619'], ['jeonse', 'T245423133086632']]) {
          r[k] = {};
          for (const [reg, cls] of [['swr', 50014], ['seoul', 50008]]) r[k][reg] = series(await rebRows(`STATBL_ID=${id}&DTACYCLE_CD=WK&CLS_ID=${cls}`)).slice(-104);
        }
        return r;
      },
      // 월별 아파트 매매 거래량(동·호수) 관악구 / 서울
      volume: async () => ({
        gwanak: series(await rebRows('STATBL_ID=A_2024_00554&DTACYCLE_CD=MM&CLS_ID=510023'), (x) => x.ITM_ID === 100001),
        seoul: series(await rebRows('STATBL_ID=A_2024_00554&DTACYCLE_CD=MM&CLS_ID=500002'), (x) => x.ITM_ID === 100001),
      }),
      // 매입자 거주지별 (관악구 GRP 910023)
      buyerRes: async () => {
        const rows = (await rebRows('STATBL_ID=A_2024_00609&DTACYCLE_CD=MM&GRP_ID=910023')).filter((x) => x.ITM_ID === 100001);
        const by = (cls) => series(rows, (x) => x.CLS_ID === cls).slice(-36);
        return { total: by(500001), inGu: by(500002), inSeoul: by(500003), otherSeoul: by(500004), outside: by(500005) };
      },
      // 매입자 연령대별
      buyerAge: async () => {
        const rows = (await rebRows('STATBL_ID=A_2024_00610&DTACYCLE_CD=MM&GRP_ID=910023')).filter((x) => x.ITM_ID === 100001);
        const names = { 500002: '20대 이하', 500003: '30대', 500004: '40대', 500005: '50대', 500006: '60대', 500007: '70대 이상', 500008: '기타(법인 등)' };
        const r = {};
        for (const [id, nm] of Object.entries(names)) r[nm] = series(rows, (x) => x.CLS_ID === +id).slice(-36);
        return r;
      },
      // 매매가격 대비 전세가격 비율(전세가율)
      jeonseRatio: async () => ({
        gwanak: series(await rebRows('STATBL_ID=A_2024_00072&DTACYCLE_CD=MM&CLS_ID=530035')).slice(-60),
        seoul: series(await rebRows('STATBL_ID=A_2024_00072&DTACYCLE_CD=MM&CLS_ID=500008')).slice(-60),
      }),
    };
    const prev = readJSON(file, {});
    for (const [k, fn] of Object.entries(tasks)) {
      try { out[k] = await fn(); } catch (e) { console.error('[시장지표]', k, e.message); out[k] = prev[k] || null; }
    }
    writeJSON(file, out);
    console.log('[시장지표] 갱신');
    return out;
  });
}

// 국토교통부 아파트 매매 실거래 상세(공공데이터포털): 매수·매도자 구분, 직거래/중개, 등기여부
const MOLIT_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
let molitStatus = { ok: null, msg: '아직 조회 전' };
const xmlItems = (xml) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map((x) => [x[1], x[2].trim()])));
async function molitMonth(ym) {
  const file = path.join(CACHE, `molit_${ym}.json`);
  const curYm = new Date().toISOString().slice(0, 7).replace('-', '');
  if (fresh(file, ym >= String(+curYm - 1) ? 12 * 3600e3 : 90 * 24 * 3600e3)) return readJSON(file, []);
  let items = [];
  for (let p = 1; p <= 10; p++) {
    const u = `${MOLIT_URL}?serviceKey=${CONFIG.dataGoKrKey}&LAWD_CD=${GWANAK_CGG}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${p}`;
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) });
    const xml = await r.text();
    const code = (xml.match(/<resultCode>(.*?)<\/resultCode>/) || [])[1];
    if (code && !['00', '000'].includes(code)) throw new Error('공공데이터포털 응답: ' + ((xml.match(/<resultMsg>(.*?)<\/resultMsg>/) || [])[1] || code));
    const its = xmlItems(xml);
    items = items.concat(its);
    const total = +((xml.match(/<totalCount>(\d+)<\/totalCount>/) || [])[1] || 0);
    if (items.length >= total || !its.length) break;
  }
  const slim = items.map((i) => ({ d: `${i.dealYear}${String(i.dealMonth).padStart(2, '0')}${String(i.dealDay).padStart(2, '0')}`, nm: i.aptNm, dong: i.umdNm, amt: +String(i.dealAmount).replace(/,/g, ''), area: +i.excluUseAr, buyer: i.buyerGbn || '', seller: i.slerGbn || '', how: i.dealingGbn || '', rgst: i.rgstDate || '', cancel: i.cdealType || '' }));
  writeJSON(file, slim);
  return slim;
}
let molitFailAt = 0;
async function molit() {
  if (!CONFIG.dataGoKrKey) return { ok: false, msg: 'config.json 에 dataGoKrKey 없음' };
  if (Date.now() - molitFailAt < 10 * 60e3) return { ok: false, msg: molitStatus.msg + ' (10분 후 재시도)' };
  const months = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}`); }
  try {
    const res = [];
    for (const ym of months.reverse()) res.push({ ym, rows: await molitMonth(ym) });
    molitStatus = { ok: true, msg: '정상' };
    return { ok: true, months: res.map(({ ym, rows }) => {
      const valid = rows.filter((r) => !r.cancel);
      const c = (f) => valid.filter(f).length;
      return { ym, n: valid.length, cancel: rows.length - valid.length, buyerCorp: c((r) => /법인/.test(r.buyer)), buyerPerson: c((r) => /개인/.test(r.buyer)), sellerCorp: c((r) => /법인/.test(r.seller)), direct: c((r) => /직거래/.test(r.how)), broker: c((r) => /중개/.test(r.how)), rgst: c((r) => r.rgst) };
    }) };
  } catch (e) {
    molitFailAt = Date.now();
    molitStatus = { ok: false, msg: e.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ? '공공데이터포털 서버 접속 불가(연결 시간 초과)' : e.message };
    return { ok: false, msg: molitStatus.msg };
  }
}

// ---------- 위치: ① 수동 좌표(seed) ② OSM 주거단지 이름 매칭 ③ Nominatim 검색(검증) ----------
const GEO_FILE = path.join(DATA, 'geocache.json');
const SEED = readJSON(path.join(DATA, 'seed_coords.json'), {});
const geo = readJSON(GEO_FILE, {});
const HDONG = makeHdong(readJSON(path.join(DATA, 'gwanak_dongs.geojson'), { features: [] }));
const OSM_APT_FILE = path.join(DATA, 'osm_apts.json');
let aptIndex = buildIndex(readJSON(OSM_APT_FILE, { elements: [] }).elements, HDONG);
async function refreshOsmApts() { // 월 1회 OSM 주거단지 목록 갱신
  if (fresh(OSM_APT_FILE, 30 * 24 * 3600e3) && aptIndex.length) return;
  const q = `[out:json][timeout:80];(nwr(${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e})["landuse"="residential"]["name"];nwr(${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e})["building"~"apartments|residential"]["name"];);out center tags;`;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const j = await getJSON(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 90000 }, 2);
      const el = j.elements.map((e) => ({ tags: { name: e.tags.name }, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon })).filter((e) => e.lat);
      writeJSON(OSM_APT_FILE, { elements: el }); aptIndex = buildIndex(el, HDONG);
      console.log(`[위치] OSM 주거단지 ${aptIndex.length}곳 갱신`); return;
    } catch (e) { console.error('[위치] OSM 단지목록 갱신 실패', e.message); }
  }
}
let geoQueue = Promise.resolve();
const inBox = (la, lo) => la > BBOX.s && la < BBOX.n && lo > BBOX.w && lo < BBOX.e;
// 브이월드 지번→좌표 (실거래 자료의 지번 사용, 가장 정확). 응답에 행정동도 포함됨
const VW_FILE = path.join(DATA, 'vworld_geo.json');
const vw = readJSON(VW_FILE, {});
// 행정동: 브이월드 값이 관악구 행정동이 아니면(경계 부근 오류 등) 행정동 경계로 다시 판별
const GW_H = new Set(Object.values(LEGAL_TO_H).flat());
const fixHd = (a, lat, lon) => (GW_H.has(a) ? a : HDONG(lat, lon));
for (const v of Object.values(vw)) if (v) v.hd = fixHd(v.hd, v.lat, v.lon);
const JB = new Map(); // "법정동|단지명" → 지번
let vwSaveT = null;
const saveVw = () => { clearTimeout(vwSaveT); vwSaveT = setTimeout(() => writeJSON(VW_FILE, vw), 1000); };
async function vworldGeocode(dong, jb) {
  const k = `${dong}|${jb}`;
  if (vw[k] !== undefined || !CONFIG.vworldKey) return vw[k];
  return once('vw:' + k, async () => {
    try {
      const u = 'https://api.vworld.kr/req/address?' + new URLSearchParams({ service: 'address', request: 'getcoord', type: 'parcel', format: 'json', crs: 'epsg:4326', address: `서울특별시 관악구 ${dong} ${jb}`, key: CONFIG.vworldKey });
      const j = await getJSON(u, { timeout: 15000 }, 1);
      const r = j.response;
      if (r?.status === 'OK') {
        const lat = +r.result.point.y, lon = +r.result.point.x;
        vw[k] = { lat, lon, src: 'vworld', hd: fixHd(r.refined?.structure?.level4A, lat, lon), detail: r.refined?.structure?.detail || '' };
      } else if (r?.status === 'NOT_FOUND') vw[k] = null;
      else throw new Error(r?.error?.text || r?.status || '응답 오류');
      saveVw();
      return vw[k];
    } catch (e) { console.error('[브이월드]', k, e.message); return undefined; }
  });
}
function quick(name, dong) {
  const key = `${dong}|${name}`;
  if (SEED[key]) return { ...SEED[key], src: 'seed', hd: HDONG(SEED[key].lat, SEED[key].lon) };
  const jb = JB.get(key);
  if (jb && vw[`${dong}|${jb}`]) return vw[`${dong}|${jb}`];
  const m = match(aptIndex, dong, name);
  if (m) return m;
  return geo[key];
}
async function geocode(name, dong) {
  const key = `${dong}|${name}`;
  const jb = JB.get(key);
  if (jb && vw[`${dong}|${jb}`] === undefined && !SEED[key]) await vworldGeocode(dong, jb);
  const q0 = quick(name, dong);
  if (q0 !== undefined) return q0;
  return once('geo:' + key, () => (geoQueue = geoQueue.then(async () => {
    if (geo[key] !== undefined) return geo[key];
    const clean = name.replace(/\(.*?\)/g, '').trim();
    let hit = null;
    if (clean.length >= 2 && !/^\d/.test(clean)) {
      for (const q of [`${clean}, ${dong}, 관악구`, `${clean}, 관악구`]) {
        try {
          const u = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'kr' });
          const res = await getJSON(u, {}, 1);
          await sleep(1100);
          // 검증: 관악구 안 + 같은 법정동 소속 행정동 + 이름 일부 일치
          hit = res.find((r) => {
            const hd = HDONG(+r.lat, +r.lon);
            return hd && LEGAL_TO_H[dong]?.includes(hd) && !['boundary', 'place', 'highway'].includes(r.class) && norm(r.name || r.display_name).includes(norm(clean).slice(0, 3));
          });
          if (hit) break;
        } catch { await sleep(1500); }
      }
    }
    geo[key] = hit ? { lat: +hit.lat, lon: +hit.lon, src: 'nominatim', hd: HDONG(+hit.lat, +hit.lon) } : null;
    writeJSON(GEO_FILE, geo);
    return geo[key];
  })));
}
// 실거래 단지 전체의 좌표표(행정동 필터용). OSM 매칭으로 못 찾은 단지는 백그라운드로 검색
async function allNames() {
  const y = new Date().getFullYear();
  const names = new Map();
  for (const k of ['sale', 'rent']) for (const yy of [y - 1, y]) for (const r of await seoulYear(k, yy))
    if (r.nm) { names.set(`${r.dong}|${r.nm}`, r); if (r.jb) JB.set(`${r.dong}|${r.nm}`, r.jb); }
  return names;
}
async function geoTable() {
  const out = {};
  for (const [k, r] of await allNames()) { const v = quick(r.nm, r.dong); if (v) out[k] = v; }
  return out;
}
async function warmGeocode() {
  // ① 브이월드: 실거래 단지의 지번 좌표 확보. 아파트 → 오피스텔 → 빌라, 거래 많은 순으로 한 건씩 천천히
  if (CONFIG.vworldKey) {
    const y = new Date().getFullYear(), cnt = new Map();
    for (const k of ['sale', 'rent']) for (const yy of [y - 1, y]) for (const r of await seoulYear(k, yy)) if (r.jb) { const kk = `${r.dong}|${r.jb}`; cnt.set(kk, (cnt.get(kk) || 0) + 1); }
    const rank = { 아파트: 0, 오피스텔: 1, 연립다세대: 2 };
    const todo = [...(await allNames()).values()].filter((r) => r.jb && vw[`${r.dong}|${r.jb}`] === undefined)
      .sort((a, b) => rank[a.usg] - rank[b.usg] || (cnt.get(`${b.dong}|${b.jb}`) || 0) - (cnt.get(`${a.dong}|${a.jb}`) || 0));
    if (todo.length) console.log(`[브이월드] 단지 ${todo.length}곳 지번 좌표 확인을 백그라운드로 진행합니다(최초 1회, 아파트 우선).`);
    let fail = 0, done = 0;
    for (const r of todo) {
      if (vw[`${r.dong}|${r.jb}`] !== undefined) continue;
      const res = await vworldGeocode(r.dong, r.jb);
      if (res === undefined) { if (++fail >= 3) { console.log('[브이월드] 요청 제한으로 60초 대기'); await sleep(60000); fail = 0; } }
      else { fail = 0; if (++done % 200 === 0) console.log(`[브이월드] ${done}곳 확인`); }
      await sleep(400);
    }
    writeJSON(VW_FILE, vw);
    if (todo.length) console.log(`[브이월드] 완료 — 좌표 ${Object.values(vw).filter(Boolean).length}곳`);
  }
  await refreshOsmApts();
  const todo =[...(await allNames()).values()].filter((r) => r.usg === '아파트' && quick(r.nm, r.dong) === undefined);
  if (todo.length) console.log(`[위치] OSM 이름매칭 외 아파트 ${todo.length}곳 추가 검색을 백그라운드로 진행합니다(최초 1회).`);
  for (const r of todo) await geocode(r.nm, r.dong);
  if (todo.length) console.log('[위치] 완료');
}

// ---------- 주변시설: OSM Overpass, 캐시 ----------
const POI_FILE = path.join(DATA, 'poicache.json');
const poiCache = readJSON(POI_FILE, {});
async function pois(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (poiCache[key] && Date.now() - poiCache[key].ts < 30 * 24 * 3600e3) return poiCache[key].data;
  return once('poi:' + key, async () => {
    const a = (r) => `(around:${r},${lat},${lon})`;
    const q = `[out:json][timeout:40];(
      nwr${a(1500)}["railway"="station"];nwr${a(1500)}["public_transport"="station"]["subway"="yes"];
      node${a(500)}["highway"="bus_stop"];
      nwr${a(1500)}["amenity"~"^(school|kindergarten|university)$"];
      nwr${a(1200)}["amenity"~"^(marketplace|bank|townhall|police|post_office|hospital|library|fire_station|community_centre)$"];
      nwr${a(1200)}["shop"~"^(supermarket|department_store|mall)$"];
      nwr${a(1200)}["office"="government"];
      nwr${a(1200)}["leisure"="park"]["name"];
    );out center tags;`;
    const urls = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    let j, err;
    for (const u of urls) {
      try { j = await getJSON(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 45000 }, 1); break; } catch (e) { err = e; }
    }
    if (!j) throw err;
    const data = (j.elements || []).map((e) => ({ t: e.tags || {}, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon })).filter((e) => e.lat && e.t.name)
      .map((e) => ({ name: e.t.name, lat: e.lat, lon: e.lon, k: e.t.railway || (e.t.subway ? 'station' : '') || e.t.highway || e.t.amenity || e.t.shop || (e.t.office ? 'government' : '') || e.t.leisure, line: e.t.line || e.t['subway:line'] || e.t.network || '', op: e.t.operator || '' }));
    poiCache[key] = { ts: Date.now(), data };
    writeJSON(POI_FILE, poiCache);
    return data;
  });
}

async function warmPois() {
  const y = new Date().getFullYear();
  const cnt = new Map();
  for (const r of (await seoulYear('sale', y)).concat(await seoulYear('sale', y - 1))) if (r.usg === '아파트' && r.nm) cnt.set(`${r.dong}|${r.nm}`, (cnt.get(`${r.dong}|${r.nm}`) || 0) + 1);
  for (const l of readJSON(LIST_FILE, [])) cnt.set(`${l.dong}|${l.nm}`, 1e6);
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
  let n = 0;
  for (const [k] of top) {
    const [dong, nm] = k.split('|'); const g = quick(nm, dong);
    if (!g) continue;
    const key = `${g.lat.toFixed(4)},${g.lon.toFixed(4)}`;
    if (poiCache[key]) continue;
    try { await pois(g.lat, g.lon); n++; } catch {}
    await sleep(2000);
  }
  if (n) console.log(`[주변시설] 주요 단지 ${n}곳 미리 받기 완료`);
}

// ---------- 추천매물 (data/listings.json 에 저장) ----------
const LIST_FILE = path.join(DATA, 'listings.json');

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok, no) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { no(e); } }); });
const ymd = (s) => /^\d{8}$/.test(s || '');

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = Object.fromEntries(u.searchParams);
  try {
    if (u.pathname === '/api/trades') {
      if (!SEOUL_SVC[q.kind] || !ymd(q.from) || !ymd(q.to)) return send(res, 400, { error: 'kind/from/to 확인' });
      return send(res, 200, { kind: q.kind, rows: await trades(q.kind, q.from, q.to) });
    }
    if (u.pathname === '/api/config') return send(res, 200, { vworldKey: CONFIG.vworldKey || '' }); // 브이월드 지도 타일용(브라우저 키)
    if (u.pathname === '/api/market') return send(res, 200, await market());
    if (u.pathname === '/api/molit') return send(res, 200, await molit());
    if (u.pathname === '/api/reb') return send(res, 200, await reb(q.cycle === 'monthly' ? 'monthly' : 'weekly'));
    if (u.pathname === '/api/geocode') {
      const list = (q.items || '').split('~').filter(Boolean).slice(0, 40).map((s) => s.split('|'));
      const out = {};
      await Promise.all(list.map(async ([dong, nm]) => { out[`${dong}|${nm}`] = await geocode(nm, dong); }));
      return send(res, 200, out);
    }
    if (u.pathname === '/api/geocache') return send(res, 200, await geoTable());
    if (u.pathname === '/api/poi') {
      const la = +q.lat, lo = +q.lon;
      if (!inBox(la, lo)) return send(res, 400, { error: '관악구 범위 밖 좌표' });
      return send(res, 200, { pois: await pois(la, lo) });
    }
    if (u.pathname === '/api/development') return send(res, 200, readJSON(path.join(DATA, 'development.json'), []));
    if (u.pathname === '/api/listings') {
      if (req.method === 'GET') return send(res, 200, readJSON(LIST_FILE, []));
      if (req.method === 'POST') {
        const b = await body(req);
        const list = readJSON(LIST_FILE, []);
        if (b.deleteId) { writeJSON(LIST_FILE, list.filter((x) => x.id !== b.deleteId)); return send(res, 200, { ok: true }); }
        const item = { ...b, id: b.id || 'L' + Date.now() };
        const i = list.findIndex((x) => x.id === item.id);
        if (i >= 0) list[i] = item; else list.push(item);
        writeJSON(LIST_FILE, list);
        return send(res, 200, { ok: true, item });
      }
    }
    if (u.pathname === '/api/status') return send(res, 200, { osmApts: aptIndex.length, searched: Object.keys(geo).length, found: Object.values(geo).filter(Boolean).length, dataPortalKey: !!CONFIG.dataGoKrKey, molit: molitStatus });
    // 정적 파일
    let p = path.normalize(decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    let f = path.join(PUBLIC, p);
    if (p.startsWith('/data/')) f = path.join(__dirname, p);
    if (!f.startsWith(__dirname) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    console.error(u.pathname, e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`\n  SK부동산 관악구 부동산 대시보드 →  http://localhost:${PORT}\n`);
  (async () => { // 최근 3년 실거래 미리 받기 → 단지 위치 → 주요 단지 주변시설 미리 받기
    const y = new Date().getFullYear();
    for (const yy of [y, y - 1, y - 2]) { await seoulYear('sale', yy); await seoulYear('rent', yy); }
    warmGeocode().catch((e) => console.error('[위치] 백그라운드 실패', e.message));
    await warmPois();
  })().catch((e) => console.error('[준비] 실패', e.message));
  reb('weekly'); reb('monthly'); market();
});
