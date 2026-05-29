// scrapers/deccanherald.js

export default {
  config: {
    title: "Deccan Herald – Karnataka & Bengaluru",
    description: "Karnataka and Bengaluru news from Deccan Herald",
    siteUrl: "https://www.deccanherald.com",
  },

  sources: [
    { url: "https://www.deccanherald.com/top-karnataka-news", category: "Karnataka", pages: 2 },
    { url: "https://www.deccanherald.com/india/karnataka/bengaluru", category: "Bengaluru", pages: 2 },
    { url: "https://www.deccanherald.com/top-bengaluru-news", category: "Bengaluru", pages: 2 },
  ],

  async scrape(page) {
    const allArticles = [];
    const seenUrls = new Set(); // within-run dedup only

    for (const source of this.sources) {
      for (let pageNum = 1; pageNum <= source.pages; pageNum++) {
        // DH uses ?page=N for pagination
        const url = pageNum === 1 ? source.url : `${source.url}?page=${pageNum}`;
        console.log(`    Fetching [${source.category}] page ${pageNum}: ${url}`);

        try {
          await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

          await page
            .waitForSelector("a[href*='/india/karnataka'], a[href*='/bengaluru']", { timeout: 15000 })
            .catch(() => {});

          const articles = await page.evaluate((sourceCategory) => {
            const results = [];
            const anchors = document.querySelectorAll("a[href]");

            for (const a of anchors) {
              const href = a.href;
              const title = a.innerText?.trim();

              if (
                !href.startsWith("https://www.deccanherald.com") ||
                !title ||
                title.length < 15
              ) continue;

              if (
                href.match(/\/(tag|author|search|video|photos|epaper|newsletter|brandspot)\//i) ||
                href.match(/\/(top-karnataka-news|top-bengaluru-news|bengaluru-latest-news|top-india-news|latest-news)\/?(\?.*)?$/) ||
                href === "https://www.deccanherald.com/"
              ) continue;

              // Article URLs have a numeric ID at the end e.g. /some-slug-1234567
              if (!href.match(/-\d{5,}$/)) continue;

              const parent =
                a.closest("article, li, div[class*='card'], div[class*='story'], div[class*='item']") ||
                a.parentElement;
              const timeEl = parent?.querySelector("time");
              const dateStr =
                timeEl?.getAttribute("datetime") || timeEl?.innerText?.trim() || null;

              results.push({ title, url: href, date: dateStr, category: sourceCategory });

              if (results.length >= 40) break;
            }
            return results;
          }, source.category);

          // Within-run dedup
          for (const article of articles) {
            if (!seenUrls.has(article.url)) {
              seenUrls.add(article.url);
              allArticles.push(article);
            }
          }

          console.log(`    → ${articles.length} articles found`);

          // Polite delay between pages
          await page.waitForTimeout(1500);

        } catch (err) {
          console.warn(`    ⚠ Failed: ${url} — ${err.message}`);
        }
      }
    }

    return allArticles;
  },
};
