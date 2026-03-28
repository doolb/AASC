const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    // 建议先 headless: false，方便观察是否有人机验证
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // 模拟正常浏览器
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
  );

  // 你指定的测试地址
  const url = 'https://cn.bing.com/search?q=nodejs';
  console.log('正在打开：', url);

  await page.goto(url, {
    waitUntil: 'domcontentloaded', // 只等 DOM，不等于所有资源加载完
    timeout: 60000
  });

  // 等待结果容器出现（防止动态渲染时取不到）
  await page.waitForSelector('#b_results', { timeout: 10000 });

  // 在页面里执行提取逻辑
  const result = await page.evaluate(() => {
    // 1. 尝试拿 AI 回答区域（你指定的 #b_pole）
    const poleEl = document.querySelector('#b_pole');

    if (poleEl) {
      // 如果存在，直接返回 AI 回答
      return {
        type: 'ai_answer',
        content: (poleEl.innerText || '').trim()
      };
    }

    // 2. 没有 #b_pole，就按你说的拿 #b_results 里的第一个 li
    const resultsEl = document.querySelector('#b_results');
    if (!resultsEl) {
      return {
        type: 'error',
        message: '没有找到 #b_results 容器'
      };
    }

    // 第一个 li（可能是广告、第一条结果等）
    const firstLi = resultsEl.querySelector('li');
    if (!firstLi) {
      return {
        type: 'error',
        message: '#b_results 里没有 li'
      };
    }

    // 常见结构：li 里有 h2 > a（标题+链接），以及摘要 p
    const titleA = firstLi.querySelector('h2 a');
    const snippetP = firstLi.querySelector('.b_caption p') || firstLi.querySelector('p');

    return {
      type: 'first_result',
      title: titleA ? (titleA.innerText || '').trim() : '',
      link: titleA ? (titleA.href || '').trim() : '',
      snippet: snippetP ? (snippetP.innerText || '').trim() : ''
    };
  });

  console.log('提取结果：', JSON.stringify(result, null, 2));

  await browser.close();
})();
