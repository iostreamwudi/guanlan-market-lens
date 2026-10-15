import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimited, collectPages, loadMarketSnapshot, loadLimitStructure, loadIndustries, loadOfficialEvents, historicalWindows, applySupplement } from '../src/supplement.js';
import { requestModel, planWithModel, testModelConnection, MODEL_TIMEOUT_MS, modelFailure } from '../src/model.js';
import { research, publicCached } from '../src/server.js';
import { demoBars } from '../src/engine.js';
const now = new Date('2026-10-15T08:00:00Z');
const ts = Date.parse('2026-10-15T15:00:00+08:00');
const noNetwork = () => { throw new Error('Unexpected network call'); };
const base = { mode:'demo',index:'sh000300',days:20,scenario:'divergence',extended:false };
const marketRows = [
  {f12:'600000',f3:2,f6:1000000,f124:ts/1000},
  {f12:'000001',f3:-1,f6:2000000,f124:ts/1000},
  {f12:'300001',f3:0,f6:3000000,f124:ts/1000},
  {f12:'920000',f3:-2,f6:4000000,f124:ts/1000}
];
const reply = j => new Response(JSON.stringify(j),{headers:{'Content-Type':'application/json'}});
test('分页完整获取，使用首页实际页长，校验总数与唯一代码', async()=>{
  const r=await collectPages(async p=>({total:7,rows:[1,2,3,4,5,6,7].slice((p-1)*3,p*3).map(id=>({id})),trace:{page:p}}),r=>r.id);
  assert.equal(r.rows.length,7);assert.equal(r.pages.length,3);
});
test('重复、截断与总数漂移不生成全市场结论',async()=>{
  for(const get of [async p=>({total:4,rows:[{id:1},{id:2}],trace:{p}}),async p=>({total:4,rows:p===1?[{id:1},{id:2}]:[{id:3}],trace:{p}}),async p=>({total:p===1?4:5,rows:[{id:p*2},{id:p*2+1}],trace:{p}})])await assert.rejects(collectPages(get,r=>r.id));
});
test('空市场、分页预算非法数据不冒充正常样本',async()=>{
  const empty=await collectPages(async()=>({total:0,rows:[],trace:{}}),r=>r.id);assert.equal(empty.total,0);
  await assert.rejects(collectPages(async()=>({total:1000,rows:[{id:1}],trace:{}}),r=>r.id,10),/预算/);
});
test('真实快照宽度与成交额由同日原始字段计算',async()=>{
  const m=await loadMarketSnapshot('public',null,async()=>({rc:0,data:{total:4,diff:marketRows}}),now);
  assert.equal(m.up,1);assert.equal(m.down,2);assert.equal(m.flat,1);assert.equal(m.upRatio,25);assert.equal(m.turnover,10000000);assert.equal(m.date,'2026-10-15');
});
test('同日有效样本不足、过期快照均拒绝',async()=>{
  await assert.rejects(loadMarketSnapshot('public',null,async()=>({rc:0,data:{total:4,diff:marketRows.map((r,i)=>({...r,f6:i?0:100}))}}),now),/70%/);
  await assert.rejects(loadMarketSnapshot('public',null,async()=>({rc:0,data:{total:4,diff:marketRows.map(r=>({...r,f124:ts/1000-30*86400}))}}),now),/过期/);
});
test('扶摇市场快照适配字段与分页鉴权，Key不进入结果',async()=>{
  const m=await loadMarketSnapshot('fuyao','fixture-only',async(url,headers)=>{assert.equal(headers['X-api-key'],'fixture-only');return {code:0,request_id:'req_fixture',data:{total:4,timestamp:ts,item:marketRows.map(r=>({thscode:r.f12+'.SH',price_change_ratio_pct:r.f3,turnover:r.f6}))}}},now);
  assert.equal(m.turnover,10000000);assert.ok(!JSON.stringify(m).includes('fixture-only'));
});
test('涨跌停池日期错误或重复股票拒绝',async()=>{
  await assert.rejects(loadLimitStructure('2026-10-15','public',null,async()=>({rc:0,data:{tc:1,qdate:20261014,pool:[{c:'x'}]}})),/日期/);
  await assert.rejects(loadLimitStructure('2026-10-15','public',null,async()=>({rc:0,data:{tc:2,qdate:20261015,pool:[{c:'x'},{c:'x'}]}})),/重复/);
});
test('涨跌停采用供应商池数量，不用固定涨跌幅推断',async()=>{
  const r=await loadLimitStructure('2026-10-15','public',null,async url=>({rc:0,data:{tc:1,qdate:20261015,pool:[{c:url.includes('ZTPool')?'up':'down'}]}}));
  assert.equal(r.up,1);assert.equal(r.down,1);assert.equal(r.pages.length,2);
});
test('行业板块按完整数据排序并保留源时间',async()=>{
  const r=await loadIndustries(async()=>({rc:0,data:{total:2,diff:[{f12:'BK1',f14:'行业甲',f3:-2,f6:100,f124:ts/1000},{f12:'BK2',f14:'行业乙',f3:1,f6:200,f124:ts/1000}]}}),now);
  assert.equal(r.rows[0].code,'BK2');assert.equal(r.date,'2026-10-15');
});
test('官方事件只读取允许域名，并要求成功解析原文',async()=>{
  let calls=0;
  const r=await loadOfficialEvents(async()=>[
    {TITLE:'金融政策原文',URL:'https://www.gov.cn/zhengce/test.htm',DOCRELPUBTIME:'2026-10-14'},
    {TITLE:'金融恶意链接',URL:'https://evil.test/content',DOCRELPUBTIME:'2026-10-14'},
    {TITLE:'金融过期文件',URL:'https://www.gov.cn/old.htm',DOCRELPUBTIME:'2020-01-01'}
  ],async()=>{calls++;return new Response('<div id="UCAP-CONTENT"><p>'+('这是官方政策测试原文，仅用于校验来源解析。'.repeat(8))+'</p></div>')},now);
  assert.equal(calls,1);assert.equal(r.events.length,1);assert.equal(r.events[0].date,'2026-10-14');
});
test('官方原文缺失或结构变化不算已核验事件',async()=>{
  await assert.rejects(loadOfficialEvents(async()=>[{TITLE:'金融政策',URL:'https://www.gov.cn/test.htm',DOCRELPUBTIME:'2026-10-14'}],async()=>new Response('<html>无正文</html>'),now),/无可核验/);
});
const ssePath='/aboutus/mediacenter/hotandd/c/c_20261014_12345678.shtml';
const sseTitle='交易所举办国际投资者调研活动';
const sseIndex=(title=sseTitle,date='2026-10-14',path=ssePath)=>`<dd><span>${date}</span><a href="${path}">${title}</a></dd>`;
const sseArticle=(title=sseTitle,date='2026-10-14')=>`<h2>上交所APP栏目</h2><h2>${title}</h2><div class="article_opt"><i>${date}</i></div><div class="allZoom"><p>${'这是交易所官方动态测试正文，并不代表真实资金流入或政策影响。'.repeat(3)}</p></div>`;
test('政府原文失败后切换独立官方来源，保留失败记录并核验交易所标题和日期',async()=>{
  const seen=[];
  const r=await loadOfficialEvents(async()=>{throw new Error('fixture primary unavailable')},async url=>{seen.push(url);return new Response(url.endsWith('/')?sseIndex()+sseIndex():sseArticle())},now);
  assert.equal(r.fallback,true);assert.equal(r.events.length,1);assert.equal(seen.length,2);assert.equal(r.events[0].source,'上海证券交易所官方动态');
  assert.equal(r.attempts[0].status,'failed');assert.equal(r.attempts.at(-1).status,'success');
});
test('备用官方原文标题或日期不匹配时拒绝，不将索引标题冒充已核验事件',async()=>{
  for(const html of [sseArticle('不同标题'),sseArticle(sseTitle,'2026-10-13')]){
    await assert.rejects(loadOfficialEvents(async()=>[],async url=>new Response(url.endsWith('/')?sseIndex():html),now),e=>{assert.ok(e.attempts.some(a=>a.message.includes('核验失败')));return true});
  }
});
test('备用索引的外部链接、未来日期及过期条目不请求',async()=>{
  const seen=[];
  await assert.rejects(loadOfficialEvents(async()=>[],async url=>{seen.push(url);return new Response(sseIndex(sseTitle,'2026-10-14','https://evil.test/a')+sseIndex(sseTitle,'2026-10-16')+sseIndex(sseTitle,'2020-01-01'))},now),/无可核验/);
  assert.equal(seen.length,1);assert.ok(seen[0].startsWith('https://www.sse.com.cn/'));
});
test('官方原文仅跟随同源有限重定向，跨域重定向拒绝并保留原因',async()=>{
  const index=async()=>[{TITLE:'金融政策',URL:'https://www.gov.cn/start.htm',DOCRELPUBTIME:'2026-10-14'}];
  const body='<div id="UCAP-CONTENT">'+('这是官方原文解析测试。'.repeat(8))+'</div>';
  const same=await loadOfficialEvents(index,async url=>url.endsWith('start.htm')?new Response(null,{status:302,headers:{location:'/final.htm'}}):new Response(body),now);
  assert.equal(same.events[0].url,'https://www.gov.cn/final.htm');
  const seen=[];
  await assert.rejects(loadOfficialEvents(index,async url=>{seen.push(url);return url.includes('gov.cn')?new Response(null,{status:302,headers:{location:'https://evil.test/a'}}):new Response('empty')},now),e=>{assert.ok(e.attempts.some(a=>a.message.includes('白名单')));return true});
  assert.ok(seen.every(url=>!url.includes('evil.test')));
});
test('公开资料缓存共享成功结果并标注年龄，失败不缓存，过期重新获取',async()=>{
  const name='fixture-cache-'+crypto.randomUUID();let count=0;
  const fn=async()=>{count++;return{source:'fixture',value:count}};
  const [a,b]=await Promise.all([publicCached(name,fn,true),publicCached(name,fn,true)]);
  assert.equal(count,1);assert.equal(a.cache.status,'fresh');assert.equal(b.cache.status,'shared');assert.equal(b.value,a.value);
  const c=await publicCached(name,fn,true);assert.equal(c.cache.status,'hit');assert.ok(c.cache.storedAt);assert.equal(c.cache.ttlSeconds,120);
  await publicCached(name,fn,true,0);assert.equal(count,2);
  const failedName=name+'failed';let attempts=0;
  const fail=()=>{attempts++;throw new Error('fixture failure')};
  await assert.rejects(publicCached(failedName,fail,true));await assert.rejects(publicCached(failedName,fail,true));assert.equal(attempts,2);
});
test('不允许缓存的凭证资料不读写公共缓存',async()=>{
  let calls=0;const name='fixture-private-'+crypto.randomUUID();
  for(let i=0;i<2;i++){const r=await publicCached(name,async()=>({value:++calls}),false);assert.equal(r.cache,undefined)}
  assert.equal(calls,2);
});
test('历史区间互不重叠且不包含当前区间，不提供后续收益',()=>{
  const bars=demoBars('sh000300');const h=historicalWindows(bars,20);assert.ok(h.windows.length>0);
  const sorted=[...h.windows].sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<sorted.length;i++)assert.ok(sorted[i-1].end<sorted[i].start);
  for(const w of h.windows){assert.ok(w.end<bars.at(-21).date);assert.ok(Number.isFinite(w.distance));assert.equal(w.futureReturn,undefined)}
  assert.equal(historicalWindows(bars,60).windows.length,0);
});
test('跨时点宽度不用于更改历史区间状态，保持低置信度',async()=>{
  const r=await research(base,{},noNetwork,now),state=r.state;
  const m=await loadMarketSnapshot('public',null,async()=>({rc:0,data:{total:4,diff:marketRows}}),now);
  applySupplement(r,{market:m});assert.equal(r.state,state);assert.equal(r.confidence,'低');assert.ok(r.warnings.some(w=>w.includes('跨交易日')));
  assert.ok(r.claims.some(c=>c.type==='不确定'&&c.text.includes('官方政策原文当前未取得')));
});
test('DeepSeek结构化连接测试，供应商端点固定且凭证不输出',async()=>{
  const r=await testModelConnection({provider:'deepseek',key:'fixture-only',model:'test-model'},async(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(JSON.parse(init.body).response_format.type,'json_object');
    return reply({id:'fixture_request',choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{total_tokens:10}});
  });assert.equal(r.ok,true);assert.ok(!JSON.stringify(r).includes('fixture-only'));
});
test('模型任意供应商、Coding Plan配置和未完成响应拒绝',async()=>{
  await assert.rejects(requestModel({provider:'arbitrary',key:'x'},noNetwork),/供应商/);
  await assert.rejects(requestModel({provider:'ark',key:'fixture-only',model:'ark-code-latest'},noNetwork),/Coding Plan/);
  await assert.rejects(testModelConnection({provider:'deepseek',key:'fixture-only',model:'test'},async()=>reply({choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]})),/未完成/);
});
test('模型超时、网络、HTTP及输出预算错误可区分且不泄露上游文本',async()=>{
  assert.equal(MODEL_TIMEOUT_MS,90000);
  const cases=[
    {code:'timeout',fetcher:async()=>{throw new DOMException('fixture-secret upstream','TimeoutError')}},
    {code:'network',fetcher:async()=>{throw new TypeError('fixture-secret upstream')}},
    {code:'http',fetcher:async()=>new Response('fixture-secret upstream',{status:401})},
    {code:'output_incomplete',fetcher:async()=>reply({choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]})}
  ];
  for(const c of cases){
    await assert.rejects(testModelConnection({provider:'deepseek',key:'fixture-secret',model:'test'},c.fetcher),error=>{
      assert.equal(modelFailure(error).code,c.code);assert.ok(!error.message.includes('fixture-secret'));return true;
    });
  }
});
test('模型规划只能选择白名单工具，不能指定任意取数能力',async()=>{
  const stub=tools=>async()=>reply({id:'plan_fixture',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({focus:'行业',tools,reason:'需要补充行业截面'})}]}]});
  const config={provider:'openai',key:'fixture-only',model:'test'};
  const r=await planWithModel('行业分化',config,stub(['industry_snapshot']));assert.equal(r.value.focus,'行业');
  await assert.rejects(planWithModel('行业分化',config,stub(['arbitrary_http'])),/白名单/);
});
test('公开访客不能未经口令使用部署者模型Key',async()=>{
  const r=await research(base,{OPENAI_API_KEY:'fixture-server-key',RESEARCH_ACCESS_TOKEN:'fixture-owner-token'},noNetwork,now);
  assert.equal(r.ai.status,'未启用');assert.ok(!JSON.stringify(r).includes('fixture-server-key'));
});
test('模型规划超时停止后续模型请求，明确原因并保留受控证据结果',async()=>{
  let calls=0;
  const r=await research({...base,extended:true,modelKey:'fixture-secret',model:'test'},{},async()=>{calls++;throw new DOMException('fixture-secret','TimeoutError')},now);
  assert.equal(calls,1);assert.equal(r.ai.errorCode,'timeout');assert.equal(r.plan.origin,'受控规则规划');
  assert.ok(r.evidence.length);assert.equal(r.logs[0].errorCode,'timeout');assert.ok(!JSON.stringify(r).includes('fixture-secret'));
});
test('分页中途失败后停止派发新请求，避免继续消耗供应商额度',async()=>{
  let count=0;
  await assert.rejects(mapLimited(Array.from({length:20},(_,i)=>i),2,async i=>{count++;if(i===0)throw new Error('fixture_failure');return i}),/fixture_failure/);
  assert.ok(count<=3);
});
