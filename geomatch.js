// OSM 주거단지(이름·좌표)와 실거래 단지명을 매칭해 좌표를 찾는 모듈
import fs from 'node:fs';
export const LEGAL_TO_H = {
  봉천동: ['보라매동', '청림동', '성현동', '행운동', '낙성대동', '청룡동', '은천동', '중앙동', '인헌동'],
  남현동: ['남현동'],
  신림동: ['서원동', '신원동', '서림동', '신사동', '신림동', '난향동', '조원동', '대학동', '삼성동', '미성동', '난곡동'],
};
function pip(pt, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
export function makeHdong(geojson) {
  return (lat, lon) => {
    for (const f of geojson.features) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      if (polys.some((p) => pip([lon, lat], p[0]))) return f.properties.name;
    }
    return null;
  };
}
const DONG_WORDS = /^(서울|관악|봉천|신림|남현|서울대입구|서울대|낙성대|보라매|성현|은천|청림|행운|인헌|난곡|난향|미성|삼성산)/;
export function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/아파트|apt|단지|주상복합/g, '')
    .replace(/제?(\d+)차/g, '$1').replace(/(\d+)동$/g, '')
    .replace(/[\s·\-_.,'"]/g, '')
    .replace(/ii$/, '2').replace(/i$/, '1')
    .replace(/이편한세상/g, 'e편한세상').replace(/래미안/g, '레미안');
}
const dig = (s) => { const d = (s.match(/\d+/g) || []).join(''); return s.replace(/\d+/g, '') + d; }; // 숫자 위치 통일
export function buildIndex(osmElements, hdongOf) {
  const out = [];
  for (const e of osmElements) {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon, nm = e.tags?.name;
    if (!lat || !nm) continue;
    const hd = hdongOf(lat, lon);
    if (!hd) continue; // 관악구 밖 제외
    const legal = Object.keys(LEGAL_TO_H).find((k) => LEGAL_TO_H[k].includes(hd));
    out.push({ nm, n: norm(nm), n2: norm(nm).replace(DONG_WORDS, ''), nd: dig(norm(nm)), lat, lon, hd, legal });
  }
  return out;
}
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111e3, (a.lon - b.lon) * 88e3);
export function match(index, dong, name) {
  return matchIn(index, dong, name, false) || matchIn(index, dong, name, true);
}
function matchIn(index, dong, name, anyDong) {
  const raw = String(name || '');
  const paren = (raw.match(/\((.*?)\)/) || [])[1] || '';
  const q = norm(raw), q2 = q.replace(DONG_WORDS, ''), qp = norm(raw.replace(/[()]/g, ''));
  if (!q || /^\d/.test(q)) return null;
  const cands = anyDong ? index : index.filter((c) => c.legal === dong);
  const qd = dig(q);
  const scored = [];
  for (const c of cands) {
    let s = 0;
    if (c.n === q || c.n === qp) s = 100;
    else if (c.n2 && (c.n2 === q2 || c.n2 === q)) s = 92;
    else if (/\d/.test(qd) && c.nd === qd) s = 90;
    else if (q.length >= 3 && c.n.includes(q)) s = 80 - (c.n.length - q.length);
    else if (c.n.length >= 4 && q.includes(c.n)) s = 70 - (q.length - c.n.length);
    else if (q2.length >= 3 && c.n2.includes(q2)) s = 65 - (c.n2.length - q2.length);
    if (s && paren && !/^\d/.test(paren) && c.nm.includes(paren)) s += 5;
    if (s >= (anyDong ? 92 : 55)) scored.push({ ...c, s });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.s - a.s);
  const best = scored[0];
  // 동점 후보가 멀리 떨어져 있으면 모호 → 매칭하지 않음
  const rivals = scored.filter((c) => c.s === best.s && dist(c, best) > 350);
  if (rivals.length) return null;
  return { lat: best.lat, lon: best.lon, src: 'osm-match', osm: best.nm, hd: best.hd, score: best.s };
}
