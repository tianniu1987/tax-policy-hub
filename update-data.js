/**
 * 财税政策数据抓取脚本
 * 
 * 数据源（基于真实页面结构分析）：
 * 1. 国家税务总局政策法规库 - https://fgk.chinatax.gov.cn/zcfgk/c100027/list.html
 *    结构：div.list > ul > li > a > p.bt(标题) + p.fwzh(文号) + p.cwrq(日期)
 * 2. 财政部 - https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/
 *    结构：ul.xwfb_listbox > li > a(标题) + span(日期)
 * 3. 国务院政策文件库 - https://www.gov.cn/zhengce/zuixin/
 *    结构：ul#list-1-ajax-id > li > h4 > a(标题) + span.date(日期)
 * 
 * 运行方式：node scripts/update-data.js
 * 输出：data/policies.json
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'policies.json');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 格式化日期为 YYYY-MM-DD
function formatDate(dateStr) {
  if (!dateStr) return null;
  const patterns = [
    /(\d{4})[-年](\d{1,2})[-月](\d{1,2})[日]?/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
    /(\d{4})(\d{2})(\d{2})/
  ];
  for (const p of patterns) {
    const m = dateStr.match(p);
    if (m) {
      const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
  }
  return dateStr;
}

/**
 * 智能分类判断
 */
function classifyCategory(title) {
  if (!title) return '综合财税政策';
  const t = title;
  if (t.includes('增值税') || t.includes('留抵退税') || t.includes('发票') || t.includes('增值税法')) return '增值税';
  if (t.includes('所得税') || t.includes('研发费用') || t.includes('高新技术') || t.includes('小型微利')) return '企业所得税';
  if (t.includes('个税') || t.includes('个人所得税') || t.includes('专项附加') || t.includes('汇算清缴') || t.includes('个人养老金')) return '个人所得税';
  if (t.includes('消费税')) return '消费税';
  if (t.includes('关税') || t.includes('出口退税') || t.includes('进口') || t.includes('跨境电商')) return '关税';
  if (t.includes('房产') || t.includes('契税') || t.includes('土地使用税') || t.includes('房地产')) return '房产税';
  if (t.includes('环保') || t.includes('车辆购置') || t.includes('印花税') || t.includes('资源税') || t.includes('环境')) return '其他税种';
  if (t.includes('电动自行车') || t.includes('电动车') || t.includes('非机动车') || t.includes('锂电池') || t.includes('以旧换新') || t.includes('消防安全') || t.includes('CCC认证') || t.includes('新国标') || t.includes('gb 17761') || t.includes('gb 43854')) return '电动车行业';
  return '综合财税政策';
}

/**
 * 智能政策类型判断
 */
function classifyPolicyType(title, docNumber) {
  if (!title) return '规范性文件';
  const t = title;
  const d = docNumber || '';
  if (t.includes('法') && (t.includes('中华人民共和国') || t.includes('草案') || t.includes('修订'))) return '法律';
  if (t.includes('条例') || t.includes('国发') || t.includes('国务院关于')) return '行政法规';
  if (t.includes('令第') || t.includes('国家税务总局公告')) return '部门规章';
  if (d.includes('财税〔') || d.includes('财') || t.includes('财税')) return '财税文件';
  if (t.includes('通知') || t.includes('意见') || t.includes('印发') || t.includes('税总发') || t.includes('税总函')) return '工作通知';
  if (t.includes('解读') || t.includes('解答') || t.includes('图解')) return '政策解读';
  return '规范性文件';
}

/**
 * 智能主分类判断（法律/财务/税务）
 */
function classifyMainCategory(title, category, policyType) {
  if (!title) return '税务';
  const t = title;
  const cat = category || '';
  const pt = policyType || '';
  
  // 法律类：法律文件、行政法规、国家标准、安全规范、认证管理、处罚裁量、合规要求、地方性法规
  if (pt === '法律' || pt === '行政法规') {
    // 财税文件和工作通知中的行政法规归为法律类
    if (t.includes('中华人民共和国') && t.includes('法')) return '法律';
    if (t.includes('条例') && (t.includes('管理') || t.includes('安全') || t.includes('处罚') || t.includes('监督'))) return '法律';
    if (t.includes('国家标准') || t.includes('GB ') || t.includes('技术规范') || t.includes('安全规范')) return '法律';
    if (t.includes('CCC认证') || t.includes('强制性产品认证') || t.includes('认证管理')) return '法律';
    if (t.includes('行政处罚') || t.includes('裁量权') || t.includes('首违不罚')) return '法律';
    if (t.includes('整治行动') || t.includes('全链条') || t.includes('消防安全') || t.includes('安全生产')) return '法律';
    if (t.includes('规范条件') || t.includes('生产准入') || t.includes('登记实施') || t.includes('登记办法')) return '法律';
    if (t.includes('质量监督') || t.includes('抽查实施细则') || t.includes('监督抽查')) return '法律';
    if (t.includes('非机动车管理') || t.includes('电动车管理') || t.includes('管理规定')) return '法律';
  }
  
  // 财务类：以旧换新、补贴、财务处理
  if (t.includes('以旧换新') || t.includes('补贴') || t.includes('废旧电池回收') || t.includes('财税政策指引')) return '财务';
  
  // 税务类：所有税收相关
  if (cat !== '电动车行业' && cat !== '综合财税政策') return '税务';
  if (cat === '综合财税政策' && !t.includes('管理') && !t.includes('处罚')) return '税务';
  if (t.includes('税收') || t.includes('税率') || t.includes('退税') || t.includes('减税') || t.includes('税务')) return '税务';
  if (t.includes('增值税') || t.includes('所得税') || t.includes('消费税') || t.includes('关税') || t.includes('契税')) return '税务';
  if (t.includes('发票') || t.includes('汇算清缴') || t.includes('专项附加') || t.includes('留抵退税')) return '税务';
  
  return '税务';
}

/**
 * 抓取国家税务总局政策法规库最新政策列表
 * 实际页面结构：div.list > ul > li > a > p.bt(标题) + p.fwzh(文号,含title) + p.cwrq(日期)
 */
async function fetchChinataxPolicies() {
  console.log('[国家税务总局] 开始抓取...');
  const policies = [];
  try {
    // 抓取前2页共30条
    const urls = [
      'https://fgk.chinatax.gov.cn/zcfgk/c100027/list.html',
      'https://fgk.chinatax.gov.cn/zcfgk/c100027/list_2.html'
    ];
    
    for (const url of urls) {
      const resp = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000
      });
      const $ = cheerio.load(resp.data);
      
      // 精确选择器：div.list > ul > li > a > p.bt / p.fwzh / p.cwrq
      $('div.list ul li').each((i, el) => {
        const link = $(el).find('a').first();
        const href = link.attr('href') || '';
        const fullUrl = href.startsWith('http') ? href : `https://fgk.chinatax.gov.cn${href}`;
        
        const title = link.find('p.bt').text().trim();
        const docNumber = link.find('p.fwzh').text().trim();
        const dateText = link.find('p.cwrq').text().trim();
        const publishDate = formatDate(dateText);
        
        if (title && title.length > 4) {
          policies.push({
            id: `chinatax-${Date.now()}-${policies.length}`,
            title: title,
            docNumber: docNumber,
            authority: '国家税务总局',
            publishDate: publishDate || new Date().toISOString().split('T')[0],
            effectiveDate: publishDate || null,
            category: classifyCategory(title),
            policyType: classifyPolicyType(title, docNumber),
            status: '有效',
            sourceName: '国家税务总局',
            sourceUrl: fullUrl,
            mainCategory: classifyMainCategory(title, classifyCategory(title), classifyPolicyType(title, docNumber)),
            summary: ''
          });
        }
      });
    }
    console.log(`  [国家税务总局] 抓取到 ${policies.length} 条政策`);
  } catch (e) {
    console.error(`  [国家税务总局] 抓取失败: ${e.message}`);
  }
  return policies;
}

/**
 * 抓取财政部政策发布
 * 实际页面结构：ul.xwfb_listbox > li > a(标题,title属性) + span(日期)
 */
async function fetchMofPolicies() {
  console.log('[财政部] 开始抓取...');
  const policies = [];
  try {
    // 抓取前2页
    const urls = [
      'https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/',
      'https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/index_1.htm'
    ];
    
    for (const url of urls) {
      const resp = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000
      });
      const $ = cheerio.load(resp.data);
      
      // 每5条一个ul.xwfb_listbox，遍历所有
      $('ul.xwfb_listbox li').each((i, el) => {
        const link = $(el).find('a').first();
        const href = link.attr('href') || '';
        const fullUrl = href.startsWith('http') ? href : `https://www.mof.gov.cn${href}`;
        const title = link.text().trim() || link.attr('title') || '';
        const dateText = $(el).find('span').text().trim();
        const publishDate = formatDate(dateText);
        
        // 提取文号（财政部页面的标题中可能包含文号）
        let docNumber = '';
        const docMatch = title.match(/[（(][〔﹝]?[0-9]{4}[〕﹝]?[）)]\s*\d+\s*号?/);
        if (docMatch) docNumber = docMatch[0];
        
        if (title && title.length > 4) {
          policies.push({
            id: `mof-${Date.now()}-${policies.length}`,
            title: title.replace(/\s+/g, ' ').trim(),
            docNumber: docNumber,
            authority: '财政部',
            publishDate: publishDate || new Date().toISOString().split('T')[0],
            effectiveDate: publishDate || null,
            category: classifyCategory(title),
            policyType: classifyPolicyType(title, docNumber),
            status: '有效',
            sourceName: '财政部',
            sourceUrl: fullUrl,
            mainCategory: classifyMainCategory(title, classifyCategory(title), classifyPolicyType(title, docNumber)),
            summary: ''
          });
        }
      });
    }
    console.log(`  [财政部] 抓取到 ${policies.length} 条政策`);
  } catch (e) {
    console.error(`  [财政部] 抓取失败: ${e.message}`);
  }
  return policies;
}

/**
 * 抓取国务院最新政策列表
 * 实际页面结构：ul#list-1-ajax-id > li > h4 > a(标题) + span.date(日期)
 */
async function fetchGovPolicies() {
  console.log('[国务院] 开始抓取...');
  const policies = [];
  try {
    const url = 'https://www.gov.cn/zhengce/zuixin/';
    const resp = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000
    });
    const $ = cheerio.load(resp.data);
    
    $('ul#list-1-ajax-id li').each((i, el) => {
      const link = $(el).find('h4 a').first();
      const href = link.attr('href') || '';
      const fullUrl = href.startsWith('http') ? href : `https://www.gov.cn${href}`;
      const title = link.text().trim();
      const dateText = $(el).find('span.date').text().trim();
      const publishDate = formatDate(dateText);
      
      // 提取文号
      let docNumber = '';
      const docMatch = title.match(/[（(][〔﹝]?[0-9]{4}[〕﹝]?[）)]\s*\d+\s*号?/);
      if (docMatch) docNumber = docMatch[0];
      
      if (title && title.length > 4) {
        policies.push({
          id: `gov-${Date.now()}-${policies.length}`,
          title: title,
          docNumber: docNumber,
          authority: '国务院',
          publishDate: publishDate || new Date().toISOString().split('T')[0],
          effectiveDate: publishDate || null,
          category: classifyCategory(title),
          policyType: classifyPolicyType(title, docNumber),
          status: '有效',
          sourceName: '国务院',
          sourceUrl: fullUrl,
          mainCategory: classifyMainCategory(title, classifyCategory(title), classifyPolicyType(title, docNumber)),
          summary: ''
        });
      }
    });
    console.log(`  [国务院] 抓取到 ${policies.length} 条政策`);
  } catch (e) {
    console.error(`  [国务院] 抓取失败: ${e.message}`);
  }
  return policies;
}

/**
 * 合并去重，并保留已有数据的摘要信息
 */
function mergePolicies(existing, newPolicies) {
  // 新数据优先，按标题去重
  const seen = new Set();
  const merged = [];
  
  // 先添加新数据
  for (const p of newPolicies) {
    const key = p.title.trim();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }
  
  // 再添加旧数据中不重复的，保留其摘要
  for (const p of existing) {
    const key = p.title.trim();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }
  
  // 按发布日期降序排列
  merged.sort((a, b) => {
    const da = a.publishDate ? new Date(a.publishDate) : new Date(0);
    const db = b.publishDate ? new Date(b.publishDate) : new Date(0);
    return db - da;
  });
  
  return merged;
}

/**
 * 主函数
 */
async function main() {
  console.log('=== 财税政策数据更新脚本 ===');
  console.log(`开始时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`数据源: 国家税务总局 / 财政部 / 国务院\n`);
  
  // 读取现有数据
  let existingPolicies = [];
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      existingPolicies = data.policies || [];
      console.log(`读取现有数据: ${existingPolicies.length} 条政策`);
    }
  } catch (e) {
    console.log(`无现有数据或读取失败: ${e.message}`);
  }
  
  // 并行抓取三个数据源
  const [chinatax, mof, gov] = await Promise.allSettled([
    fetchChinataxPolicies(),
    fetchMofPolicies(),
    fetchGovPolicies()
  ]);
  
  const newPolicies = [
    ...(chinatax.status === 'fulfilled' ? chinatax.value : []),
    ...(mof.status === 'fulfilled' ? mof.value : []),
    ...(gov.status === 'fulfilled' ? gov.value : [])
  ];
  
  console.log(`\n抓取完成: 本次新增 ${newPolicies.length} 条`);
  console.log(`  国家税务总局: ${chinatax.status === 'fulfilled' ? chinatax.value.length : '失败'}`);
  console.log(`  财政部: ${mof.status === 'fulfilled' ? mof.value.length : '失败'}`);
  console.log(`  国务院: ${gov.status === 'fulfilled' ? gov.value.length : '失败'}`);
  
  // 合并去重
  const merged = mergePolicies(existingPolicies, newPolicies);
  console.log(`合并去重后总计: ${merged.length} 条政策`);
  
  // 标注入库时间
  const now = new Date();
  const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  // 写入文件
  const output = {
    lastUpdate: timeStr,
    version: `1.0.${Math.floor(Date.now() / 86400000)}`,
    totalCount: merged.length,
    policies: merged
  };
  
  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ 数据已写入: ${DATA_FILE}`);
  console.log(`   版本: ${output.version}`);
  console.log(`   完成时间: ${timeStr}`);
  console.log('=== 更新完成 ===');
}

main().catch(e => {
  console.error('❌ 脚本执行失败:', e.message);
  process.exit(1);
});