import { calculate, pct } from './engine.js';

const EM_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const chinaDate = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const sum = rows => rows.reduce((n, r) => n + r.turnover, 0);
const latest = rows => Math.max(...rows.map(r => r.timestamp));
const cleanText = s => String(s || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export async function mapLimited(items, count, fn) {
  const out = new Array(items.length); let cursor = 0, failure = null;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (cursor < items.length && !failure) {
      const i = cursor++;
      try { out[i] = await fn(items[i], i); } catch (e) { failure = e; }
    }
  }));
  if (failure) throw failure;
  return out;
}
export async function collectPages(getPage, idOf, maxPages = 80) {
  const first = await getPage(1);
  if (!Number.isInteger(first.total) || first.total < 0 || !Array.isArray(first.rows)) throw new Error('分页元数据非法');
  if (first.total === 0) {
    if (first.rows.length) throw new Error('空总数与记录矛盾');
    return { rows: [], pages: [first.trace], total: 0 };
  }
  if (!first.rows.length) throw new Error('首页为空，数据不完整');
  const pageSize = first.rows.length, pages = Math.ceil(first.total / pageSize);
  if (pages > maxPages) throw new Error('数据分页超过预算，停止聚合');
  const rest = await mapLimited(Array.from({ length: pages - 1 }, (_, i) => i + 2), 6, getPage);
  const all = [first, ...rest];
  if (all.some(p => p.total !== first.total || !Array.isArray(p.rows))) throw new Error('取数期间总数变化，快照不一致');
  const rows = all.flatMap(p => p.rows);
  if (rows.length !== first.total || new Set(rows.map(idOf)).size !== first.total) throw new Error('分页缺失或重复，拒绝生成全市场结论');
  return { rows, total: first.total, pages: all.map(p => p.trace) };
}
export async function loadMarketSnapshot(mode, key, jsonGet, now = new Date()) {
  const fuyao = mode === 'fuyao';
  if (fuyao && !key) throw new Error('扶摇凭证未配置');
  const all = await collectPages(async page => {
    const url = fuyao
      ? `https://fuyao.aicubes.cn/api/a-share/prices/snapshot?limit=100&offset=${(page - 1) * 100}`
      : `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=${EM_FS}&fields=f12,f3,f6,f9,f124`;
    const j = await jsonGet(url, fuyao ? { 'X-api-key': key } : {});
    if ((fuyao ? j.code : j.rc) !== 0 || !j.data) throw new Error('市场快照业务异常');
    const raw = fuyao ? j.data.item : j.data.diff;
    if (!Array.isArray(raw)) throw new Error('市场快照字段缺失');
    const rows = raw.map(r => ({ code: fuyao ? r.thscode : r.f12,
      change: fuyao ? r.price_change_ratio_pct : r.f3,
      turnover: fuyao ? r.turnover : r.f6,
      timestamp: fuyao ? j.data.timestamp : r.f124 * 1000,
      valuationField: fuyao ? null : r.f9 }));
    return { total: j.data.total, rows, trace: { page, count: rows.length, url, requestId: j.request_id } };
  }, r => r.code);
  const dated = all.rows.filter(r => Number.isFinite(r.timestamp) && r.timestamp > 0 && r.timestamp <= now.getTime() + 60000);
  if (!dated.length) throw new Error('快照缺少可核验时点');
  const date = chinaDate(latest(dated));
  if (now.getTime() - Date.parse(date + 'T15:00:00+08:00') > 7 * 86400000) throw new Error('市场快照过期');
  const rows = dated.filter(r => chinaDate(r.timestamp) === date && Number.isFinite(r.change) && Number.isFinite(r.turnover) && r.turnover > 0);
  if (rows.length < all.total * .7) throw new Error('有效同日样本不足70%，不生成全市场宽度');
  const up = rows.filter(r => r.change > 0).length, down = rows.filter(r => r.change < 0).length, flat = rows.length - up - down;
  return { rows, total: all.total, active: rows.length, excluded: all.total - rows.length, up, down, flat,
    upRatio: up / rows.length * 100, turnover: sum(rows), date, timestamp: latest(rows), pages: all.pages,
    source: fuyao ? '扶摇全市场行情快照' : '东方财富公开A股快照', url: all.pages[0].url,
    universe: fuyao ? '扶摇A股代码表全部分页；剔除无有效当日成交与过期报价' : '沪深主板、创业板、科创板、北交所A股筛选集全部分页；剔除无有效当日成交与过期报价' };
}
export async function loadLimitStructure(date, mode, key, jsonGet) {
  const fetchPool = async direction => {
    const fuyao = mode === 'fuyao';
    const dateMs = Date.parse(date + 'T00:00:00+08:00');
    const all = await collectPages(async page => {
      const url = fuyao
        ? `https://fuyao.aicubes.cn/api/a-share/special-data/limit-${direction}-pool?date_ms=${dateMs}&page=${page}&size=100`
        : `https://push2ex.eastmoney.com/getTopic${direction === 'up' ? 'ZT' : 'DT'}Pool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=${page - 1}&pagesize=100&sort=${direction === 'up' ? 'fbt' : 'fund'}:asc&date=${date.replaceAll('-', '')}`;
      const j = await jsonGet(url, fuyao ? { 'X-api-key': key } : {});
      if ((fuyao ? j.code : j.rc) !== 0 || !j.data) throw new Error('涨跌停池响应失败');
      if (!fuyao && String(j.data.qdate) !== date.replaceAll('-', '')) throw new Error('涨跌停池日期与查询日不一致');
      return { total: fuyao ? j.data.pagination?.total : j.data.tc, rows: (fuyao ? j.data.item : j.data.pool), trace: { url, page, requestId: j.request_id } };
    }, r => r.thscode || r.c, 10);
    return all;
  };
  const [up, down] = await Promise.all([fetchPool('up'), fetchPool('down')]);
  return { date, up: up.total, down: down.total, upRows: up.rows, downRows: down.rows, pages: [...up.pages, ...down.pages],
    source: mode === 'fuyao' ? '扶摇涨跌停股票池' : '东方财富公开涨跌停股票池', url: up.pages[0].url };
}
export async function loadIndustries(jsonGet, now = new Date()) {
  const all = await collectPages(async page => {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=m:90+t:2+f:!50&fields=f12,f14,f3,f6,f124`;
    const j = await jsonGet(url);
    if (j.rc !== 0 || !j.data || !Array.isArray(j.data.diff)) throw new Error('行业板块接口异常');
    return { total: j.data.total, rows: j.data.diff.map(r => ({ code: r.f12, name: r.f14, change: r.f3, turnover: r.f6, timestamp: r.f124 * 1000 })), trace: { page, url } };
  }, r => r.code, 10);
  const valid = all.rows.filter(r => Number.isFinite(r.change) && Number.isFinite(r.timestamp) && r.timestamp > 0 && r.timestamp <= now.getTime() + 60000);
  if (!valid.length) throw new Error('行业数据缺少有效时点');
  const date = chinaDate(latest(valid));
  if (now.getTime() - Date.parse(date + 'T15:00:00+08:00') > 7 * 86400000) throw new Error('行业数据过期');
  const rows = valid.filter(r => chinaDate(r.timestamp) === date).sort((a, b) => b.change - a.change);
  if (!rows.length) throw new Error('无有效同日行业样本');
  return { rows, date, total: all.total, source: '东方财富公开行业板块', url: all.pages[0].url, pages: all.pages };
}
const OFFICIAL_ORIGINS = new Set(['https://www.gov.cn', 'https://www.sse.com.cn']);
async function officialHTML(url, fetcher) {
  const origin = new URL(url).origin;
  if (!OFFICIAL_ORIGINS.has(origin)) throw new Error('官方原文域名不在白名单');
  let current = url;
  for (let step = 0; step <= 2; step++) {
    const response = await fetcher(current, { headers: { 'User-Agent': 'MarketLens/1.2 (+https://market-lens-ashare.freshanole18.chatgpt.site)' }, signal: AbortSignal.timeout(6000), redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || step === 2) throw new Error('官方原文重定向超过预算');
      const target = new URL(location, current);
      if (target.origin !== origin || target.username || target.password) throw new Error('官方原文重定向越出白名单');
      current = target.href;
      continue;
    }
    if (!response.ok) throw new Error(`官方原文HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 2000000) throw new Error('官方原文超过大小预算');
    return { html, url: current };
  }
}
function officialFailure(error) {
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return '请求超时或超过取证预算';
  return /^(官方原文|官方政策|交易所|近30日)/.test(error?.message || '') ? error.message : '公开来源连接或结构异常';
}
export async function loadOfficialEvents(jsonGet, fetcher = fetch, now = new Date()) {
  const govURL = 'https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json';
  const sseURL = 'https://www.sse.com.cn/aboutus/mediacenter/hotandd/';
  const since = chinaDate(now.getTime() - 30 * 86400000), today = chinaDate(now.getTime());
  const attempts = [];
  const record = (source, url, status, message) => attempts.push({ source, url, status, message, checkedAt: now.toISOString() });
  try {
    const raw = await jsonGet(govURL);
    if (!Array.isArray(raw)) throw new Error('官方政策索引结构变化');
    const selected = raw.filter(r => typeof r.TITLE === 'string' && /生产力|经济|财政|金融|货币|资本|证券|消费|科技|投资|产业/.test(r.TITLE) && /^https:\/\/www\.gov\.cn\//.test(r.URL) && /^\d{4}-\d{2}-\d{2}$/.test(r.DOCRELPUBTIME) && r.DOCRELPUBTIME >= since && r.DOCRELPUBTIME <= today).slice(0, 3);
    const extracted = await mapLimited(selected, 3, async item => {
      try {
        const original = await officialHTML(item.URL, fetcher);
        const body = /id=["']UCAP-CONTENT["'][^>]*>([\s\S]*?)(?:<\/div>|<!--)/i.exec(original.html)?.[1];
        const text = cleanText(body);
        if (text.length < 30) throw new Error('官方原文正文未通过核验');
        record('中国政府网原文', original.url, 'success', '正文已读取');
        return { title: cleanText(item.TITLE), date: item.DOCRELPUBTIME, url: original.url, excerpt: text.slice(0, 120), source: '中国政府网政策原文', kind: 'policy', fetchedAt: now.toISOString() };
      } catch (e) { record('中国政府网原文', item.URL, 'failed', officialFailure(e)); return null; }
    });
    const events = extracted.filter(Boolean);
    if (events.length) return { events, source: '中国政府网政策索引与原文', url: govURL, attempts, fallback: false };
    throw new Error('近30日无可核验中国政府网政策原文');
  } catch (e) { record('中国政府网索引', govURL, 'failed', officialFailure(e)); }
  // Independent official source, never a fabricated substitute for failed policy text.
  try {
    const index = await officialHTML(sseURL, fetcher);
    const candidates = [];
    for (const m of index.html.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
      const block = m[1], date = /<span\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/i.exec(block)?.[1];
      const a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
      const href = /href=["']([^"']+)["']/i.exec(a?.[1] || '')?.[1], title = cleanText(a?.[2]);
      if (!date || date < since || date > today || !href || !/市场|投资|资金|交易|上市|证券|监管|规则|科创|金融|信息商/.test(title)) continue;
      const url = new URL(href, sseURL);
      if (url.origin !== 'https://www.sse.com.cn' || !/^\/aboutus\/mediacenter\/hotandd\/c\/c_\d{8}_\d+\.shtml$/.test(url.pathname)) continue;
      if (url.pathname.match(/c_(\d{8})_/)?.[1] !== date.replaceAll('-', '')) continue;
      if (!candidates.some(x => x.url === url.href)) candidates.push({ title, date, url: url.href });
    }
    const extracted = await mapLimited(candidates.slice(0, 3), 3, async item => {
      try {
        const original = await officialHTML(item.url, fetcher);
        const html = original.html;
        const titles = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => cleanText(m[1]).replace(/\s/g, ''));
        const date = /class=["']article_opt["'][\s\S]*?<i[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/i>/i.exec(html)?.[1];
        const text = cleanText(/class=["']allZoom["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1]);
        if (!titles.includes(item.title.replace(/\s/g, '')) || date !== item.date || text.length < 30) throw new Error('交易所原文标题、日期或正文核验失败');
        record('上海证券交易所原文', original.url, 'success', '标题、发布日期和正文已核验');
        return { ...item, url: original.url, excerpt: text.slice(0, 120), source: '上海证券交易所官方动态', kind: 'exchange_update', fetchedAt: now.toISOString() };
      } catch (e) { record('上海证券交易所原文', item.url, 'failed', officialFailure(e)); return null; }
    });
    const events = extracted.filter(Boolean);
    if (!events.length) throw new Error('近30日无可核验交易所动态原文');
    return { events, source: '上海证券交易所热点动态与原文（备用官方来源）', url: sseURL, attempts, fallback: true };
  } catch (e) {
    record('上海证券交易所索引', sseURL, 'failed', officialFailure(e));
    throw Object.assign(new Error('近30日无可核验官方原文，事件维度保持缺失'), { attempts });
  }
}
export function historicalWindows(bars, days) {
  if (bars.length < days * 2 + 25) return { windows: [], note: '历史样本不足，至少需要两个不重叠区间及均线预热数据。' };
  const current = calculate(bars, days), windows = [];
  for (let end = bars.length - days - 1; end >= days + 25 && windows.length < 10; end -= days + 1) {
    const sample = bars.slice(0, end);
    const m = calculate(sample, days);
    windows.push({ start: m.chart[0].date, end: m.date, change: m.change, volatility: m.volatility, maGap: m.maGap, volumeRatio: m.volumeRatio, raw: { first: m.chart[0], last: m.chart.at(-1) } });
  }
  const features = ['change', 'volatility', 'maGap'];
  const scale = Object.fromEntries(features.map(f => { const a = windows.map(w => w[f]), avg = a.reduce((s, n) => s + n, 0) / a.length; return [f, Math.sqrt(a.reduce((s, n) => s + (n - avg) ** 2, 0) / a.length) || 1]; }));
  for (const w of windows) w.distance = Math.sqrt(features.reduce((s, f) => s + ((w[f] - current[f]) / scale[f]) ** 2, 0));
  windows.sort((a, b) => a.distance - b.distance);
  return { windows, note: '同一指数、不重叠的等长历史观察区间；按区间变化、已实现波动和均线偏离的标准化距离排序。距离只描述样本内特征接近程度，不推演后续表现。', scale };
}
export function applySupplement(report, data) {
  report.supplement = { industry: data.industry || null, events: data.events?.events || [], eventSource: data.events ? { source: data.events.source, url: data.events.url, fallback: data.events.fallback || false, attempts: data.events.attempts || [] } : null, history: data.history || null };
  const add = e => { report.evidence = report.evidence.filter(x => x.id !== e.id); report.evidence.push({ ...e, status: 'available', quality: report.mode === 'demo' ? '构造样本' : '实时来源 · 时点独立列示' }); };
  const cover = (domain, note) => { const q = report.quality.find(x => x.name === domain); q.status = 'available'; q.note = note; };
  if (data.market) {
    const s = data.market, asOf = new Date(s.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' 北京时间';
    const mixed = s.date !== report.metric.date;
    add({ id: 'E6', domain: '市场宽度', label: '当日上涨家数占比', value: s.upRatio.toFixed(2), unit: '%', source: s.source, sourceUrl: s.url, asOf,
      formula: '当日上涨且有成交的A股数 / 同日有效成交A股数 × 100；相对前收盘价。完整分页后去重，停牌/无成交/过期报价不入分母。不是高于均线比例。',
      raw: { total: s.total, valid: s.active, excluded: s.excluded, up: s.up, down: s.down, flat: s.flat, universe: s.universe, pages: s.pages, fields: ['code', 'price_change_pct', 'turnover_yuan'], rows: s.rows.map(r => [r.code, r.change, r.turnover]) },
      interpretation: mixed ? '当前快照与指数日线不在同一交易日，不用于验证该历史区间的广度。' : s.upRatio < 40 ? '同日个股参与范围有限' : s.upRatio > 60 ? '同日上涨参与范围较广' : '同日涨跌参与分布较均衡' });
    add({ id: 'E8', domain: '流动性', label: '全筛选集当日成交额', value: (s.turnover / 1e8).toFixed(2), unit: '亿元', source: s.source, sourceUrl: s.url, asOf,
      formula: '对E6完整同日有效股票集的turnover_yuan字段求和 / 100000000；仅刻画成交活跃度，不等于资金净流入或宏观流动性。', raw: { datasetEvidence: 'E6', totalYuan: s.turnover, validStocks: s.active, universe: s.universe }, interpretation: '补齐股票层面的成交额证据；资金净流入与利率仍需独立数据。' });
    cover('市场宽度', `同日上涨/下跌/平盘家数；${s.active}/${s.total}只有效${mixed ? '，与指数日线跨时点' : ''}`);
    cover('流动性', '已具备全筛选集成交额；资金净流入/利率仍未获取');
    report.claims.push({ type: '事实', text: `${s.date}同日有效样本中，上涨${s.up}家、下跌${s.down}家、平盘${s.flat}家；上涨占比${s.upRatio.toFixed(2)}%。`, evidence_ids: ['E6'] });
    report.conditions[0] = { title: '参与范围持续扩展', detail: '当前仅有单日涨跌家数；需保存同口径多日宽度序列并独立获取高于20日均线比例，才能检验持续性。', status: '单日已取证 · 持续性待验证', refs: ['E6'] };
    if (!mixed && !report.stale) {
      report.state = s.upRatio < 40 ? '参与偏弱 · 持续性待验证' : s.upRatio > 60 ? '参与较广 · 持续性待验证' : '参与分化 · 持续性待验证';
      report.title = s.upRatio < 40 ? '个股参与范围有限，需结合指数结构复核' : s.upRatio > 60 ? '当日参与范围较广，持续性仍需验证' : '涨跌参与仍有分化，需要连续观察';
      report.claims = report.claims.filter(c => c.type !== '归纳');
      report.claims.push({ type: '归纳', text: '同日个股宽度与所选指数价格结构可交叉观察；单日宽度不足以确认观察区间内的持续状态。', evidence_ids: ['E1', 'E2', 'E6'] });
    } else if (mixed) report.warnings.push('补充快照与指数完整日线跨交易日，已分开列示时点，禁止混作同日验证。');
  }
  if (data.limits) {
    const s = data.limits;
    add({ id: 'E9', domain: '情绪', label: '涨停 / 跌停家数', value: `${s.up} / ${s.down}`, unit: '家', source: s.source, sourceUrl: s.url, asOf: s.date + ' · 查询时供应商股票池',
      formula: '完整获取同一交易日涨停池与跌停池并分别按证券代码去重；采用供应商池口径，不用固定涨跌幅阈值推算，不代表投资者心理测量。',
      raw: { date: s.date, upCount: s.up, downCount: s.down, upCodes: s.upRows.map(x => x.thscode || x.c), downCodes: s.downRows.map(x => x.thscode || x.c), pages: s.pages }, interpretation: '盘面极端价格分布证据；不能由单次家数推导后续涨跌。' });
    cover('情绪', '已具备涨跌停盘面结构证据；不等于投资者心理测量');
  }
  if (data.industry) {
    const s = data.industry;
    add({ id: 'E10', domain: '风格轮动', label: '行业板块同日截面', value: String(s.rows.length), unit: '个板块', source: s.source, sourceUrl: s.url, asOf: s.date + ' · 字段时间戳见原始值',
      formula: '完整分页获取供应商行业板块后按代码去重，以相对前收盘变化排序；包含混合层级和重叠板块，不汇总板块成交额，不等于所选区间的行业表现。', raw: { pages: s.pages, rows: s.rows }, interpretation: '可查看同日行业分化，不能当作互斥行业归因或推荐。' });
  }
  if (data.events) {
    const events = data.events.events;
    add({ id: 'E11', domain: '重要事件', label: '已核验官方事件线索', value: String(events.length), unit: '条', source: data.events.source, sourceUrl: data.events.url, asOf: events.map(e => e.date).join(' / '),
      formula: '优先读取近30日中国政府网经济/产业政策原文，失败时核验交易所官方动态原文；备用来源核对标题及发布日期。不把交易所动态称为宏观政策，不据此推断市场影响。发布日期与获取时间分别保留。', raw: events, interpretation: '原文与发布日期可追溯；是否被市场定价、影响哪些行业仍是不确定判断。' });
    cover('重要事件', '已核验近30日官方事件原文；市场影响尚未证实');
  }
  if (data.history?.windows.length) {
    add({ id: 'E12', domain: '行情结构', label: '等长历史区间对照', value: String(data.history.windows.length), unit: '个区间', source: report.evidence[0].source, sourceUrl: report.evidence[0].sourceUrl, asOf: report.metric.date + ' 15:00 北京时间',
      formula: data.history.note, raw: data.history, interpretation: '只作历史特征对照，不包含未来收益、胜率或预测。' });
  }
  report.claims = report.claims.filter(c => !(c.type === '不确定' && c.text.includes('广度、资金')));
  report.claims.push({ type: '不确定', text: '估值统一口径、资金净流入和多日宽度持续性仍不完整；' + (data.events ? '已核验官方事件原文不代表市场影响已证实。' : '官方政策原文当前未取得，不作事件归因。'), evidence_ids: data.market ? ['E6', 'E8'] : ['E3', 'E4'] });
  report.coverage = report.quality.filter(q => q.status === 'available').length;
  const hasAlignedBreadth = data.market ? data.market.date === report.metric.date : report.mode === 'demo' && report.evidence.some(e => e.id === 'E6');
  report.confidence = report.stale || !hasAlignedBreadth ? '低' : report.coverage >= 4 ? '中' : '低';
  report.confidenceReason = `已有直接来源字段的证据覆盖${report.coverage}/7维；市场宽度缺失或跨日时保持低置信度。维度覆盖不代表完整因果解释，也不是涨跌概率。${report.mode === 'demo' ? '全部为构造样本。' : ''}`;
  if (report.plan.focus === '行业') report.research = data.industry ? '已取得同日行业板块截面。下面列示领先与落后板块；这些是供应商混合层级分组，不能替代所选指数成分的行业贡献。' : '行业工具取数失败或未配置来源，不能生成行业排名。';
  if (report.plan.focus === '历史阶段') report.research = data.history?.windows.length ? '已用同一指数的等长、不重叠历史区间作特征对照。距离仅描述样本特征差异，不推演后续市场表现。' : data.history?.note || '历史样本不足，无法生成阶段对照。';
  if (report.plan.focus === '风险变量') report.research = '优先复核指数结构、个股参与范围和涨跌停结构是否一致；估值、净资金和多日持续性仍是判断盲点。';
  if (report.plan.focus === '市场状态' && data.market) report.research = '继续核验多日宽度持续性、统一口径估值与资金证据。可进一步比较行业截面、历史区间或风险变量。';
  report.warnings = report.warnings.filter(w => !w.includes('资金、利率、新闻未取得'));
  report.warnings.push('资金净流入与利率未获取；估值口径未核验。行业板块不互斥，政策原文不构成价格因果解释。');
  return report;
}
