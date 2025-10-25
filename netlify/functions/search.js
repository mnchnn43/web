// netlify/functions/search.js — same filters for serverless env
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BRANDS = [
  ['슈어', ['Shure', '슈어']],
  ['젠하이저', ['Sennheiser', '젠하이저']],
  ['오디오테크니카', ['Audio-Technica', 'Audio Technica', '오디오테크니카']],
  ['소니', ['Sony', '소니']],
  ['보스', ['Bose', '보스']],
];

const PRICE_RANGES = {
  entry: [0, 300000],
  mid: [300000, 1000000],
  high: [1000000, Number.POSITIVE_INFINITY],
};

const QUERY_BY_LEVEL = {
  entry: { sort: 'asc', display: 15 },
  mid:   { sort: 'sim', display: 60 },
  high:  { sort: 'dsc', display: 60 },
};

const KEYWORD_RULES = {
  '헤드폰': { cats: ['헤드폰'], exclude: /(카메라|렌즈|미러리스|바디|ILCE|ZV-|SEL|알파)/i },
  '이어폰': { cats: ['이어폰'], exclude: /(카메라|렌즈|미러리스|바디|ILCE|ZV-|SEL|알파)/i },
  '마이크': { cats: ['마이크'], exclude: /(카메라|렌즈|미러리스|바디|ILCE|ZV-|SEL|알파|EOS|RF|Z\s*mount|캠코더|짐벌)/i },
};

const SERIES_WHITELIST = {
  '젠하이저': {
    '헤드폰': [/\b(momentum|모멘텀)\b/i, /\bhd\s?\d{2,3}\b/i],
    '이어폰': [/\bie\s?\d{2,3}\b/i],
    '마이크': []
  },
  '슈어': {
    '헤드폰': [/\bsrh\s?\d{2,3}\b/i],
    '이어폰': [/\bse\s?\d{2,3}\b/i],
    '마이크': [/\bsm\s?\d{2,3}\b/i, /\bmv\d{1,3}\b/i]
  },
  '오디오테크니카': {
    '헤드폰': [/\bath[-\s]?m/i, /\bath[-\s]?ad/i],
    '이어폰': [/\bath[-\s]?ck/i],
    '마이크': [/\bat2?0\d{2}\b/i, /\bat4?0\d{2}\b/i]
  },
  '소니': {
    '헤드폰': [/\bwh[-\s]?\w+/i, /\bmdr[-\s]?\w+/i],
    '이어폰': [/\bwf[-\s]?\w+/i],
    '마이크': [/\becm[-\s]?\w+/i]
  },
  '보스': {
    '헤드폰': [/\b(qc|quiet\s?comfort|nc700)\b/i],
    '이어폰': [/\b(qc|quiet\s?comfort)\b/i],
    '마이크': []
  }
};

const stripHtml = (s='') => s.replace(/<[^>]*>/g, '');
const normPrice = (v) => { try { return parseInt(String(v).replace(/[^0-9]/g,''),10)||0; } catch { return 0; } };
const matchesBrand = (apiBrand='') => {
  const v = apiBrand.toLowerCase();
  return ['shure','슈어','sennheiser','젠하이저','audio-technica','audio technica','오디오테크니카','sony','소니','bose','보스']
    .some(b => v.includes(b));
};
function matchesKeyword(r, keyword) {
  const rule = KEYWORD_RULES[keyword] || { cats:[], exclude:null };
  const inCat = rule.cats.some(c =>
    (r.category3 && r.category3.includes(c)) ||
    (r.category2 && r.category2.includes(c))
  );
  const inTitle = (r.title || '').toLowerCase().includes(keyword.toLowerCase());
  const excluded = rule.exclude ? rule.exclude.test(r.title || '') : false;
  return (inCat || inTitle) && !excluded;
}
function matchesSeries(brandName, keyword, title='') {
  const rules = SERIES_WHITELIST[brandName]?.[keyword];
  if (!rules || rules.length === 0) return true;
  return rules.some(rx => rx.test(title));
}
const buildUrl = (query, sort, display) =>
  `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;

exports.handler = async (event) => {
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    const params = event.queryStringParameters || {};
    const keyword = params.keyword || '헤드폰';
    const level = params.level || 'entry';
    if (!PRICE_RANGES[level]) return { statusCode: 400, headers: CORS, body: 'invalid level' };

    const id = process.env.NAVER_CLIENT_ID || '';
    const sec = process.env.NAVER_CLIENT_SECRET || '';
    if (!id || !sec) return { statusCode: 500, headers: CORS, body: 'NAVER keys missing' };
    const headers = { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': sec, 'Accept': 'application/json' };

    const [low, high] = PRICE_RANGES[level];
    const strat = QUERY_BY_LEVEL[level] || { sort: 'sim', display: 40 };

    let collected = [];
    for (const [brandName, aliases] of BRANDS) {
      for (const alias of aliases) {
        const query = `${alias} ${keyword}`;
        const url = buildUrl(query, strat.sort, strat.display);
        const resp = await fetch(url, { headers, timeout: 8000 });
        if (!resp.ok) continue;
        const data = await resp.json();
        const items = data.items || [];
        if (items.length) {
          for (const it of items) {
            collected.push({
              brand: brandName, apiBrand: it.brand || '',
              title: stripHtml(it.title || ''), price: normPrice(it.lprice || it.price || 0),
              image: it.image || '', link: it.link || '',
              category1: it.category1 || '', category2: it.category2 || '', category3: it.category3 || '', category4: it.category4 || ''
            });
          }
          break; // 다음 브랜드
        }
      }
    }

    let relevant = collected.filter(r => matchesBrand(r.apiBrand) && matchesKeyword(r, keyword));
    relevant = relevant.filter(r => matchesSeries(r.brand, keyword, r.title));
    let filtered = relevant.filter(r => r.price && r.price >= low && r.price < high);

    // 브랜드별 최저가
    const lowestByBrand = {};
    for (const r of filtered) {
      if (!lowestByBrand[r.brand] || r.price < lowestByBrand[r.brand].price) lowestByBrand[r.brand] = r;
    }
    const output = Object.values(lowestByBrand).sort((a,b) => a.price - b.price);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ items: output }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'internal', message: String(e.message || e) }) };
  }
};
