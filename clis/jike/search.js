import { cli, Strategy } from '@jackwener/opencli/registry';
import { getPostDataJs } from './utils.js';
/**
 * 即刻搜索适配器
 *
 * 策略：直接导航到 web.okjike.com 搜索页，
 * 通过 React fiber 树提取帖子数据。
 */
cli({
    site: 'jike',
    name: 'search',
    access: 'read',
    description: '搜索即刻帖子',
    domain: 'web.okjike.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: '即刻搜索关键词' },
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['id', 'author', 'content', 'likes', 'comments', 'time', 'url'],
    func: async (page, kwargs) => {
        const keyword = kwargs.query;
        const limit = kwargs.limit || 20;
        // 1. 直接导航到搜索页
        const encodedKeyword = encodeURIComponent(keyword);
        await page.goto(`https://web.okjike.com/search?q=${encodedKeyword}`);
        await page.wait({ selector: '[class*="_post_"], [class*="_postItem_"]', timeout: 10 });

        // 2. 提取当前可见帖子（单次快照）
        const extractVisible = () => page.evaluate(`(() => {
        ${getPostDataJs}

        const results = [];
        const elements = document.querySelectorAll('[class*="_post_"], [class*="_postItem_"]');

        for (const el of elements) {
          const data = getPostData(el);
          if (!data || !data.id) continue;

          const author = data.user?.screenName || data.target?.user?.screenName || '';
          const content = data.content || data.target?.content || '';
          if (!author && !content) continue;

          results.push({
            id: data.id,
            author,
            content: content.replace(/\\n/g, ' ').slice(0, 120),
            likes: data.likeCount || 0,
            comments: data.commentCount || 0,
            time: data.actionTime || data.createdAt || '',
            url: 'https://web.okjike.com/originalPost/' + data.id,
          });
        }

        return results;
      })()`);

        // 3. 增量收集：滚动 + 提取，合并去重（即刻使用虚拟滚动）
        const allPosts = new Map();
        const mergePosts = (posts) => {
            for (const p of posts) {
                if (!allPosts.has(p.id)) allPosts.set(p.id, p);
            }
        };

        mergePosts(await extractVisible());

        const maxScrolls = Math.max(5, Math.ceil(limit / 2));
        for (let i = 0; i < maxScrolls && allPosts.size < limit; i++) {
            const prevSize = allPosts.size;
            await page.evaluate(`(() => {
                const viewport = document.querySelector('.mantine-ScrollArea-viewport');
                if (viewport) viewport.scrollBy(0, viewport.clientHeight);
                else window.scrollTo(0, document.body.scrollHeight);
            })()`);
            await page.wait(3);
            mergePosts(await extractVisible());
            if (allPosts.size === prevSize && i > 0) break;
        }

        return Array.from(allPosts.values()).slice(0, limit);
    },
});
