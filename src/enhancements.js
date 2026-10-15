// Browser-only extensions. No credentials or provider responses are bundled here.
settings = { fuyaoKey: '', modelKey: '', provider: 'openai', model: 'gpt-4.1-mini', accessToken: '' };
$('#scenarioLabel').classList.toggle('hidden', $('#mode').value !== 'demo');
const providerDefaults = { openai: 'gpt-4.1-mini', deepseek: 'deepseek-flash', ark: '' };
showSettings = function () {
  modal('数据与模型连接', '<p>公开产品采用访客自带凭证。凭证只在当前页面内存中保存，经本站服务端转发到所选供应商；刷新后清除，不进入研究报告或浏览器研究记录。</p>' +
    '<h4>扶摇金融数据 API</h4><p><a href="https://fuyao.aicubes.cn/admin/" target="_blank" rel="noopener noreferrer">管理 API Key ↗</a>。可读取指数日线、全市场快照与涨跌停池。</p>' +
    '<label>扶摇 API Key<input id="fuyaoKey" type="password" autocomplete="off" placeholder="仅当前会话使用" value="' + esc(settings.fuyaoKey) + '"></label>' +
    '<h4>模型规划与证据归纳</h4><p>配置后执行“模型研究计划 → 白名单工具 → 证据校验 → 模型归纳”。无凭证时保留明确标记的规则模式。模型API可能按量计费，研究问题和证据摘要会发送给所选供应商。</p>' +
    '<label>模型供应商<select id="modelProvider"><option value="openai">OpenAI 标准API</option><option value="deepseek">DeepSeek 标准API</option><option value="ark">火山方舟标准API（按量计费）</option></select></label>' +
    '<label>模型 API Key<input id="modelKey" type="password" autocomplete="off" placeholder="标准模型API凭证，仅当前会话使用" value="' + esc(settings.modelKey) + '"></label>' +
    '<label>已开通的模型名称 / Model ID<input id="modelName" value="' + esc(settings.model) + '" maxlength="80" placeholder="火山方舟请填写控制台Model ID或推理接入点ID"></label>' +
    '<p id="providerHint">Ark Coding Plan 是编程工具套餐，专用Key和 ark-code-latest 不能用于此投研业务应用。这里的火山方舟入口使用标准API，会按其规则计费；不会自动套用Coding Plan配置。<a href="https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh" target="_blank" rel="noopener noreferrer">官方说明 ↗</a></p>' +
    '<details><summary>部署者服务端凭证（可选）</summary><label>服务端访问口令<input id="ownerAccessToken" type="password" autocomplete="off" value="' + esc(settings.accessToken) + '" placeholder="仅部署者使用，与RESEARCH_ACCESS_TOKEN一致"></label><p>未提供正确口令时，公开访客无法使用部署者的模型或金融数据Key。模型连接测试使用上方自带的API Key。</p></details>' +
    '<div id="modelTestResult" class="qualitynote" role="status">尚未进行真实连接验证。测试会发送一个小型JSON请求，可能消耗少量Token。</div>' +
    '<div class="settingsfoot"><button class="btn" id="testModel">验证模型连接</button><button class="btn" id="clearKeys">清除凭证</button><button class="btn primary" id="applySettings">应用设置</button></div>');
  $('#modelProvider').value = settings.provider;
  $('#modelProvider').onchange = () => { $('#modelName').value = providerDefaults[$('#modelProvider').value]; };
  const read = () => ({ fuyaoKey: $('#fuyaoKey').value.trim(), modelKey: $('#modelKey').value.trim(), provider: $('#modelProvider').value, model: $('#modelName').value.trim(), accessToken: $('#ownerAccessToken').value });
  $('#applySettings').onclick = () => { settings = read(); $('#dialog').close(); toast('会话连接已更新，下次研究时生效'); };
  $('#clearKeys').onclick = () => { settings = { fuyaoKey: '', modelKey: '', provider: 'openai', model: 'gpt-4.1-mini', accessToken: '' }; $('#dialog').close(); toast('当前页面凭证已清除'); };
  $('#testModel').onclick = async () => {
    const config = read();
    if (!config.modelKey || !config.model) { $('#modelTestResult').textContent = '请填写标准API Key和已开通的模型名称。'; return; }
    $('#testModel').disabled = true; $('#modelTestResult').textContent = '正在进行真实API与JSON输出验证…';
    try {
      const response = await fetch('/api/model-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const r = await response.json();
      if (!response.ok || !r.ok) throw new Error(r.message || r.error || '连接测试失败');
      $('#modelTestResult').textContent = '真实连接已验证 · ' + r.provider + ' / ' + r.model + ' · 请求编号 ' + r.requestId + ' · ' + new Date(r.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    } catch (e) { $('#modelTestResult').textContent = '验证未通过：' + e.message + '。当前没有成功验证真实模型，不会显示“AI已启用”。'; }
    finally { if ($('#testModel')) $('#testModel').disabled = false; }
  };
};
$('#settingsBtn').onclick = showSettings;
$('#topSettings').onclick = showSettings;

function researchDetails(r) {
  const sections = [], ref = id => refs([id]);
  const names = { plan_research: '模型研究规划', get_index_history: '指数日线', get_style_history: '比较指数', get_market_snapshot: '全市场宽度与成交额', get_limit_structure: '涨跌停结构', get_official_events: '官方事件原文', get_industry_snapshot: '行业板块', compare_historical_windows: '历史阶段对照', interpret_evidence: '模型证据归纳' };
  const logs = (r.logs || []).filter(l => names[l.tool]);
  const missing = r.quality.filter(q => q.status !== 'available').map(q => q.name + (q.status === 'proxy' ? '（仅代理）' : ''));
  sections.push('<section class="panel deep-panel"><div class="sectionhead"><span>本次取证状态</span><small>' + (r.mode === 'demo' ? '构造演示' : '以实际返回为准') + '</small></div><div class="research"><p>' + (missing.length ? '待补证据：' + missing.map(esc).join('、') + '。缺失维度不参与完整判断。' : '当前维度已有取证，仍需复核口径与推论。') + '</p><ul class="sourcechecks">' + logs.map(l => {
    const cached = l.cache?.status === 'hit' || l.cache?.status === 'shared';
    const detail = l.status === 'failed' ? (l.message === 'fetch failed' ? '数据源网络连接中断，尚未取得有效资料' : l.message || '未取得有效证据') : (l.source || '已完成核验') + (cached ? ' · 复用公开资料，缓存年龄' + l.cache.ageSeconds + '秒' : '') + (l.fallback ? ' · 已使用备用官方来源' : '');
    const attempts = l.attempts?.length ? '<details><summary>查看原文取证记录</summary>' + l.attempts.map(a => '<p>' + esc(a.source) + ' · ' + (a.status === 'success' ? '已核验' : '未取得') + '<br>' + esc(a.message) + '<br><a href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">查看来源 ↗</a></p>').join('') + '</details>' : '';
    return '<li><b>' + esc(names[l.tool]) + (l.index ? ' · ' + esc(l.index) : '') + '</b><span class="' + (l.status === 'success' ? 'available' : 'missing') + '">' + (l.status === 'success' ? '已取得' : '未取得') + '</span><small>' + esc(detail) + '</small>' + attempts + '</li>';
  }).join('') + '</ul><p>公开快照最多复用两分钟，官方事件资料最多十五分钟；原始取证时间和每条资料发布日期保留。缓存仅在当前服务进程内有效，失败结果不缓存。保存快照以其原始时点为准。</p></div></section>');
  const width = r.evidence.find(e => e.id === 'E6' && e.raw?.up !== undefined), turnover = r.evidence.find(e => e.id === 'E8'), limits = r.evidence.find(e => e.id === 'E9');
  if (width || limits) {
    let html = '<section class="panel deep-panel"><div class="sectionhead"><span>个股参与与盘面结构</span><small>每项时点独立列示</small></div><div class="research">';
    if (width) { const w = width.raw; html += '<div class="breadthnumbers"><div><small>上涨</small><strong>' + w.up + '</strong></div><div><small>下跌</small><strong>' + w.down + '</strong></div><div><small>平盘</small><strong>' + w.flat + '</strong></div></div><p>上涨占比 ' + esc(width.value) + '% ' + ref('E6') + ' · 有效样本 ' + w.valid + ' / ' + w.total + '，剔除 ' + w.excluded + ' 只无有效同日成交或过期报价。</p><p>' + esc(width.asOf) + ' · 全部分页已校验 · 与高于均线比例口径不同。</p>'; }
    if (turnover) html += '<p><b>全筛选集成交额 ' + esc(turnover.value) + ' 亿元</b> ' + ref('E8') + '<br>只描述成交活跃度，资金净流入和利率仍未取得。</p>';
    if (limits) html += '<p><b>涨停 / 跌停：' + esc(limits.value) + ' 家</b> ' + ref('E9') + '<br>' + esc(limits.asOf) + '，使用供应商股票池口径。</p>';
    html += '</div></section>'; sections.push(html);
  }
  const industry = r.supplement?.industry;
  if (industry) {
    const chosen = [...industry.rows.slice(0, 3), ...industry.rows.slice(-3)];
    const row = (s, i) => '<tr><td>' + esc(s.name) + '<small class="tablecode">' + esc(s.code) + '</small></td><td class="mono">' + fmt(s.change) + '</td></tr>';
    sections.push('<section class="panel deep-panel"><div class="sectionhead"><span>行业板块分化</span><small>' + esc(industry.date) + ' · 当日截面 ' + ref('E10') + '</small></div><div class="research"><p>供应商行业板块的同日领先与落后项；层级混合、分组可能重叠。不是所选观察区间的行业表现，也不代表推荐。</p><table class="deeptable"><thead><tr><th>板块</th><th>相对前收盘变化</th></tr></thead><tbody>' + chosen.map(row).join('') + '</tbody></table><details><summary>查看全部 ' + industry.rows.length + ' 个有效板块</summary><input id="industrySearch" class="deepinput" placeholder="搜索板块名称或代码" aria-label="搜索行业板块"><div class="tableclip"><table class="deeptable"><tbody id="industryAll">' + industry.rows.map(row).join('') + '</tbody></table></div></details></div></section>');
  }
  const history = r.supplement?.history;
  if (history) {
    sections.push('<section class="panel deep-panel"><div class="sectionhead"><span>等长历史区间对照</span><small>观察特征 · 非未来推演 ' + (history.windows.length ? ref('E12') : '') + '</small></div><div class="research"><p>' + esc(history.note) + '</p>' + (history.windows.length ? '<div class="tableclip"><table class="deeptable"><thead><tr><th>观察区间</th><th>区间变化</th><th>实现波动</th><th>特征距离</th></tr></thead><tbody>' + history.windows.slice(0, 4).map(w => '<tr><td>' + esc(w.start) + '<br>' + esc(w.end) + '</td><td class="mono">' + fmt(w.change) + '</td><td class="mono">' + w.volatility.toFixed(2) + '%</td><td class="mono">' + w.distance.toFixed(2) + '</td></tr>').join('') + '</tbody></table></div><p>历史窗口互不重叠，也不与当前窗口重叠；标准化距离不是胜率或收益预测。</p>' : '') + '</div></section>');
  }
  if (r.supplement?.events?.length) {
    sections.push('<section class="panel deep-panel"><div class="sectionhead"><span>已核验官方事件原文</span><small>近30日 · 不作因果归因 ' + ref('E11') + '</small></div><div class="research">' + r.supplement.events.map(e => '<article class="eventitem"><a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.title) + ' ↗</a><small class="tablecode">' + esc(e.source) + ' · 发布于 ' + esc(e.date) + '</small><p>' + esc(e.excerpt) + '</p></article>').join('') + '<p>这里只核实原文与发布日期。政策或交易所活动是否影响市场定价、影响方向和程度仍未证实。</p></div></section>');
  }
  return sections.length ? '<div class="deepgrid">' + sections.join('') + '</div>' : '';
}
const baseRender = render;
render = function (r) {
  baseRender(r);
  if (r.mode === 'public') $('#connectionText').textContent = '公开市场连接';
  $('#evidence').insertAdjacentHTML('beforebegin', researchDetails(r));
  if ($('#industrySearch')) $('#industrySearch').oninput = () => {
    const value = $('#industrySearch').value.toLowerCase();
    document.querySelectorAll('#industryAll tr').forEach(row => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(value)));
  };
};
const style = document.createElement('style');
style.textContent = '.sourcechecks{list-style:none;padding:0;margin:0}.sourcechecks li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:11px}.sourcechecks li b{font-weight:500}.sourcechecks li small,.sourcechecks li details{grid-column:1/-1;color:var(--muted);font-size:10px;overflow-wrap:anywhere}.deepgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:20px}.deep-panel{min-width:0}.breadthnumbers{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.breadthnumbers small{display:block;color:var(--muted);font-size:10px}.breadthnumbers strong{font:24px ui-monospace,monospace;color:var(--teal)}.deeptable{width:100%;border-collapse:collapse;font-size:11px}.deeptable th{text-align:left;color:var(--muted);font-weight:400;border-bottom:1px solid var(--line);padding:8px 5px}.deeptable td{padding:9px 5px;border-bottom:1px solid #edf0ee}.deeptable td:not(:first-child),.deeptable th:not(:first-child){text-align:right;white-space:nowrap}.mono{font-family:ui-monospace,monospace}.tablecode{display:block;color:var(--muted);font-size:9px}.tableclip{overflow:auto;max-height:300px}.deepinput{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;margin:10px 0;font-size:12px}.deep-panel details{margin-top:12px;font-size:11px}.deep-panel summary{cursor:pointer;color:var(--teal)}.eventitem{padding:11px 0;border-bottom:1px solid var(--line)}.eventitem a{font-size:12px}.eventitem p{font-size:11px}#modelProvider{display:block;width:100%;max-width:none;margin-top:7px}#providerHint{font-size:10px}@media(max-width:1000px){.deepgrid{grid-template-columns:1fr}}';
document.head.appendChild(style);
$('#methodBtn').onclick = () => modal('观澜的证据研究方法', '<h4>先规划与取证，再解释</h4><p>无模型Key时使用受控规则计划。配置标准模型API后，模型从工具白名单选择研究焦点与扩展工具；指数、宽度、涨跌停和官方事件构成系统最低取证计划。模型规划失败时明确降级。</p><h4>完整分页与独立时点</h4><p>全市场与行业接口按实际返回页长取齐，核对总数、唯一代码和时间。缺失或重复就停止该项聚合。盘中指数日线剔除未收盘记录，补充快照时点独立列示。跨日宽度不用于验证历史区间状态。</p><h4>七个维度与置信度</h4><p>行情结构、市场宽度、风格轮动、估值、流动性、情绪和重要事件。已有来源字段不代表完整因果解释。宽度缺失、跨日或主数据过期时维持低置信度；本版本不输出高。置信度不是涨跌概率。</p><h4>行业和历史研究</h4><p>行业板块展示同日截面，供应商分组可能混合层级、相互重叠，不汇总行业成交额。历史研究读取长区间日线，比较同一指数等长、不重叠窗口的观察特征，不推演后续收益。</p><h4>政策与情绪证据</h4><p>涨跌停使用供应商股票池口径，不用固定涨跌幅阈值推断，也不等于心理测量。事件线索优先读取中国政府网原文；失败时核验上海证券交易所近30日官方动态的标题、日期和正文。备用来源单独标明，只核实事件存在，不证明价格因果关系。</p><h4>AI与数据边界</h4><p>数值事实由代码产生，模型只给出带有效引用、不新增数字的归纳与不确定判断。估值统一口径、净资金、利率和多日宽度仍不完整。公开接口可能断连；具体成功、失败与当前覆盖以实际报告为准。</p><h4>模型配置</h4><p>支持OpenAI、DeepSeek和火山方舟标准模型API。Coding Plan专用配置属于编程工具用途，未用于本网页业务。访客自带Key仅当前页面内存保存；部署者Key需要访问口令，不向公开访客开放。</p>');
