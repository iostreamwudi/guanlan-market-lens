// Pure evidence engine. All thresholds describe observed states, never future returns.
export const INDICES = {
  sh000300: { name: '沪深300', thscode: '000300.SH' },
  sh000001: { name: '上证指数', thscode: '000001.SH' },
  sz399006: { name: '创业板指', thscode: '399006.SZ' },
  sh000905: { name: '中证500', thscode: '000905.SH' }
};
export const DOMAINS = ['行情结构', '市场宽度', '风格轮动', '估值', '流动性', '情绪', '重要事件'];
export const pct = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
export function boundary(question = '') {
  return /买入|卖出|买卖|加仓|减仓|仓位|满仓|抄底|做多|做空|涨跌预测|明天.*(涨|跌)|下周.*(涨|跌)|必涨|必跌|稳赚|收益承诺|保证.*收益|承诺.*收益|buy|sell|position|predict|guarantee|涨多少|跌多少|该不该买|能不能买|目标价|推荐.*股票|翻倍|暴涨|暴跌|赚多少|持仓建议/i.test(question);
}
export function planFor({ index, days, question = '' }) {
  let focus = /行业|板块/.test(question) ? '行业' : /风险|失效|切换/.test(question) ? '风险变量' : /历史|阶段/.test(question) ? '历史阶段' : /风格|大小盘|成长/.test(question) ? '风格' : '市场状态';
  return { focus, index, days, tasks: [
    { tool: 'get_index_history', purpose: `${INDICES[index].name}：读取至少 ${days + 20} 根日线，剔除当日未收盘数据`, fields: ['date', 'close', 'volume'] },
    { tool: 'get_style_history', purpose: '沪深300 / 创业板指 / 中证500：对齐交易日期后比较同期变化', fields: ['date', 'close'] },
    { tool: 'check_evidence_quality', purpose: '核对缺失、过期、样本长度与来源冲突', fields: DOMAINS },
    { tool: 'derive_market_state', purpose: '计算观察指标，区分事实与归纳；列出证据补齐和状态切换条件', fields: ['period_return', 'ma20_gap', 'volume_ratio', 'annual_volatility'] }
  ] };
}
export function validateBars(bars, now = new Date()) {
  if (!Array.isArray(bars)) throw new Error('日线数据不是数组');
  const china = new Date(now.getTime() + 8 * 3600000);
  const today = china.toISOString().slice(0, 10);
  const closed = china.getUTCHours() >= 15;
  const seen = new Set();
  const result = bars.map(b => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(b.close) || b.close <= 0 || !Number.isFinite(b.volume) || b.volume < 0) throw new Error('日线字段非法或缺失');
    if (seen.has(b.date)) throw new Error('日线日期重复，来源存在冲突');
    seen.add(b.date);
    return b;
  }).filter(b => b.date < today || (b.date === today && closed)).sort((a, b) => a.date.localeCompare(b.date));
  if (result.length < 25) throw new Error('完整日线不足25根，无法计算稳定指标');
  return result;
}
const mean = a => a.reduce((s, n) => s + n, 0) / a.length;
export function calculate(bars, days) {
  if (bars.length < days + 1) throw new Error(`样本不足：需要${days + 1}根完整日线`);
  const recent = bars.slice(-days - 1), last = recent.at(-1);
  const returns = recent.slice(1).map((b, i) => b.close / recent[i].close - 1);
  const m = mean(returns);
  const vol = Math.sqrt(returns.reduce((s, r) => s + (r - m) ** 2, 0) / Math.max(returns.length - 1, 1)) * Math.sqrt(252) * 100;
  const prior = mean(bars.slice(-25, -5).map(b => b.volume));
  return { last: last.close, date: last.date, change: (last.close / recent[0].close - 1) * 100,
    maGap: (last.close / mean(bars.slice(-20).map(b => b.close)) - 1) * 100,
    volumeRatio: prior > 0 ? mean(bars.slice(-5).map(b => b.volume)) / prior : null,
    volatility: vol, chart: recent };
}
export function demoBars(code, scenario = 'divergence') {
  const dates = [];
  for (let d = new Date('2025-07-01T00:00:00Z'); dates.length < 100; d.setUTCDate(d.getUTCDate() + 1)) {
    if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
  }
  const bases = { sh000300: 3800, sh000001: 3200, sz399006: 2200, sh000905: 6000 };
  const drift = scenario === 'stress' ? -0.0035 : ({ sh000300: 0.0015, sh000001: 0.0008, sz399006: -0.0007, sh000905: -0.0003 }[code]);
  return dates.map((date, i) => ({ date, close: +(bases[code] * Math.exp(drift * i + Math.sin(i * .72) * (scenario === 'stress' ? .03 : .007))).toFixed(2), volume: Math.round(160000000 * (1 + Math.sin(i * .3) * .15) * (i > 85 ? .78 : 1)) }));
}
export function buildReport({ index, days, mode, scenario, datasets, logs, question, now = new Date() }) {
  const primary = datasets[index];
  if (!primary?.bars) throw new Error('所选指数数据不可用，停止研判');
  const metric = calculate(primary.bars, days);
  const stale = mode !== 'demo' && now.getTime() - Date.parse(metric.date + 'T15:00:00+08:00') > 7 * 86400000;
  const evidence = [];
  const add = (id, domain, label, value, unit, formula, raw, interpretation) => evidence.push({ id, domain, label, value, unit, formula, raw, interpretation, source: primary.source, sourceUrl: primary.url, asOf: metric.date + ' 15:00 北京时间', quality: mode === 'demo' ? '构造样本' : stale ? '过期' : '完整日线', status: 'available' });
  add('E1', '行情结构', `${days}日区间变化`, pct(metric.change), '%', '(区间末收盘价 / 区间初收盘价 - 1) × 100；N日使用N+1根日线', { first: metric.chart[0], last: metric.chart.at(-1) }, metric.change > 1 ? '区间指数重心抬升' : metric.change < -1 ? '区间指数重心下移' : '区间变化有限');
  add('E2', '行情结构', '相对20日均线', pct(metric.maGap), '%', '(最新收盘价 / 最近20日收盘均值 - 1) × 100', { closes: primary.bars.slice(-20).map(b => ({ date: b.date, close: b.close })) }, metric.maGap > 0 ? '位于均线上方' : '位于均线下方');
  add('E3', '流动性', '指数成交量比（代理）', metric.volumeRatio === null ? '不可计算' : metric.volumeRatio.toFixed(2), '倍', '最近5日平均成交量 / 此前20日平均成交量；仅代表该指数成交活跃度，不等于全市场流动性', { recent5: primary.bars.slice(-5), previous20: primary.bars.slice(-25, -5) }, metric.volumeRatio === null ? '前期成交量为零' : metric.volumeRatio < 1 ? '指数成交活跃度相对收缩' : '指数成交活跃度相对扩张');
  add('E4', '情绪', '实现波动率（风险代理）', metric.volatility.toFixed(2), '% / 年化', '区间日简单收益率样本标准差 × √252 × 100；不代表情绪指标或未来波动率', { dailyReturns: metric.chart.slice(1).map((b, i) => +(b.close / metric.chart[i].close - 1).toFixed(6)) }, '仅描述已实现价格波动，情绪证据仍缺失');
  const styles = [];
  for (const code of ['sh000300', 'sz399006', 'sh000905']) {
    const item = datasets[code];
    if (!item?.bars) continue;
    const common = item.bars.filter(b => b.date >= metric.chart[0].date && b.date <= metric.date);
    if (common.length !== metric.chart.length || common.some((b, i) => b.date !== metric.chart[i].date)) continue;
    styles.push({ code, name: INDICES[code].name, change: (common.at(-1).close / common[0].close - 1) * 100, raw: { first: common[0], last: common.at(-1) }, source: item.source, sourceUrl: item.url });
  }
  const spread = styles.length >= 2 ? Math.max(...styles.map(x => x.change)) - Math.min(...styles.map(x => x.change)) : null;
  if (spread !== null) {
    add('E5', '风格轮动', '宽基区间表现差', spread.toFixed(2), '百分点', '同期宽基指数区间变化最大值 - 最小值；仅为大盘/成长/中盘代理，非纯因子归因', styles, spread > 3 ? '宽基之间呈现分化' : '宽基之间差异相对有限');
    evidence.at(-1).source = [...new Set(styles.map(x => x.source))].join(' / ');
  }
  if (mode === 'demo' && scenario !== 'missing') {
    add('E6', '市场宽度', '高于20日均线的样本比例', scenario === 'stress' ? '18.00' : '38.00', '%', '构造的500只样本中，高于自身20日均线的数量 / 500 × 100；仅用于演示', { above: scenario === 'stress' ? 90 : 190, universe: 500, excludedSuspended: 12, membership: '构造固定样本，不对应真实股票' }, '样本参与度有限');
    add('E7', '估值', 'PE-TTM历史分位（演示）', '62.00', '%', '构造的60个月内50个有效月末PE-TTM样本，低于当前值的比例；非真实估值', { currentPE: 14.2, lowerCount: 31, totalCount: 50, sample: '构造数据' }, '仅用于展示估值证据形态');
  }
  const covered = ['行情结构', ...(spread !== null ? ['风格轮动'] : []), ...(evidence.some(e => e.id === 'E6') ? ['市场宽度', '估值'] : [])];
  const quality = DOMAINS.map(name => ({ name, status: covered.includes(name) ? 'available' : ['流动性', '情绪'].includes(name) ? 'proxy' : 'missing', note: covered.includes(name) ? '已具备直接或样本证据' : name === '流动性' ? '仅指数成交量代理，资金/利率未接入' : name === '情绪' ? '仅价格波动代理，涨跌停/情绪未接入' : name === '重要事件' ? '无可核验事件原文，暂不归因' : '未获取有效数据，暂停该维度判断' }));
  const divergent = spread !== null && spread > 3;
  const state = stale ? '数据过期 · 暂停综合研判' : divergent ? '结构分化 · 待广度验证' : metric.change < -1 && metric.maGap < 0 ? '指数承压 · 待交叉验证' : metric.change > 1 && metric.maGap > 0 ? '指数修复 · 待交叉验证' : '区间震荡 · 方向证据有限';
  const title = stale ? '证据已过期，当前市场状态无法确认' : divergent ? '指数表现不同步，市场共识尚待验证' : metric.change < -1 ? '指数重心下移，广度与资金仍待核实' : metric.change > 1 ? '指数有所修复，参与范围仍是关键问题' : '区间变化有限，需要更多交叉证据';
  const claims = [
    { type: '事实', text: `${INDICES[index].name}在观察区间变化${pct(metric.change)}，相对20日均线${pct(metric.maGap)}。`, evidence_ids: ['E1', 'E2'] },
    { type: '归纳', text: divergent ? '宽基指数区间表现存在分化，单一指数无法概括市场整体状态。' : '目前只可描述所选指数的价格结构，尚不足以确认全市场状态。', evidence_ids: spread !== null ? ['E1', 'E5'] : ['E1', 'E2'] },
    { type: '不确定', text: '广度、资金与事件的独立验证不足；指数成交量和实现波动率不能替代这些证据。', evidence_ids: ['E3', 'E4'] }
  ];
  const conditions = [
    { title: '参与范围扩展', detail: '取得同一股票池的市场宽度数据；高于20日均线比例连续3个交易日超过60%，才可讨论参与改善。', status: evidence.some(e => e.id === 'E6') ? '未满足 · 演示阈值' : '无法评估 · 数据缺失', refs: evidence.some(e => e.id === 'E6') ? ['E6'] : [] },
    { title: '分化明显收敛', detail: '同期宽基表现差低于3个百分点，并观察至少3个完整交易日；阈值用于研究分层，未经预测回测。', status: spread === null ? '无法评估' : spread > 3 ? '当前不满足' : '单次满足 · 待持续验证', refs: spread === null ? [] : ['E5'] },
    { title: '价格结构切换', detail: '相对20日均线从负转正或从正转负，并有独立宽度证据同向确认；仅复核观察状态。', status: '需新增交易日与交叉证据', refs: ['E2'] }
  ];
  const research = question && /行业|板块/.test(question) ? '行业研究需要点时成分、行业指数日线和成交额。当前没有这些证据，不能从宽基表现编造行业排名。' : question && /历史|阶段/.test(question) ? '历史阶段比较需同口径样本、点时成分与长区间数据。当前仅展示所选区间，未给出历史相似度或未来表现推演。' : question && /风险|失效|切换/.test(question) ? '优先复核宽基表现差、价格与均线关系，以及数据更新和缺失情况。下方条件均为待验证的研究阈值。' : '优先补齐同口径市场宽度与全市场成交额，再核验风格分化是否有更广泛的参与基础。';
  return { id: crypto.randomUUID(), createdAt: now.toISOString(), index, name: INDICES[index].name, days, mode, scenario, metric, styles, evidence, quality, state, title, claims, conditions, research,
    confidence: stale ? '低' : covered.length >= 4 ? '中' : '低', confidenceReason: `直接证据覆盖${covered.length}/7个维度；代理不计入覆盖。置信度是解释充分程度，不是涨跌概率。${mode === 'demo' ? '当前为构造演示，不能用于实际市场判断。' : ''}`,
    stale, logs, ai: { status: '未启用', note: '当前由可复核规则生成；连接模型后可进行受证据约束的归纳。' }, question: question || '解释当前市场状态、主要矛盾及判断可能改变的条件',
    plan: planFor({ index, days, question }), coverage: covered.length, boundary: boundary(question), warnings: [mode === 'demo' ? '所有数据均为构造样本，日期仅是场景标签，非真实历史行情。' : '公开接口无服务承诺，可能延迟或中断；以返回的完整日线时点为准。', '资金、利率、新闻未取得有效证据；不做因果归因。', ...(stale ? ['数据距今超过7个自然日，暂停当前市场综合判断；节假日需人工核验交易日历。'] : [])] };
}
export function validateAIClaims(claims, report) {
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > 5) throw new Error('模型输出条数无效');
  const valid = new Set(report.evidence.map(e => e.id));
  return claims.map(c => {
    if (!['归纳', '不确定'].includes(c.type) || typeof c.text !== 'string' || c.text.length > 400 || !Array.isArray(c.evidence_ids) || !c.evidence_ids.length || c.evidence_ids.some(id => !valid.has(id)) || boundary(c.text)) throw new Error('模型越界或引用无法追溯');
    if (/\d/.test(c.text)) throw new Error('模型解释不得新增数字，数值事实由代码展示');
    return { type: c.type, text: c.text, evidence_ids: c.evidence_ids };
  });
}
