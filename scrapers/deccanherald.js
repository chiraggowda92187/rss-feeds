// scrapers/deccanherald.js

export default {
  config: {
    title: "Deccan Herald – Karnataka & Bengaluru",
    description: "Karnataka and Bengaluru news from Deccan Herald",
    siteUrl: "https://www.deccanherald.com",
  },

  sources: [
    { url: "https://www.deccanherald.com/karnataka-latest-news", category: "Karnataka - Latest", pages: 3 },
    { url: "https://www.deccanherald.com/top-karnataka-news",    category: "Karnataka - Top",    pages: 1 },
    { url: "https://www.deccanherald.com/india/karnataka/bengaluru", category: "Bengaluru",      pages: 2 },
    { url: "https://www.deccanherald.com/top-bengaluru-news",    category: "Bengaluru - Top",    pages: 1 },
  ],

  async scrape(page) {
    const allArticles = [];
    const seenUrls = new Set();

    for (const source of this.sources) {
      for (let pageNum = 1; pageNum <= source.pages; pageNum++) {
        const url = pageNum === 1 ? source.url : `${source.url}/${pageNum}`;
        console.log(`    Fetching [${source.category}] page ${pageNum}: ${url}`);

        try {
          // domcontentloaded is far more reliable than networkidle on JS-heavy sites.
          // networkidle never fires if the page keeps background-polling (DH does this).
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

          // Give JS time to render the article grid
          await page.waitForTimeout(4000);

          // Then wait for any internal link to confirm render is done
          await page
            .waitForSelector("a[href*='deccanherald.com']", { timeout: 10000 })
            .catch(() => {});

          const articles = await page.evaluate((sourceCategory) => {
            const results = [];

            // ── Exclude footer, nav, sidebar ─────────────────────────────────
            const excluded = new Set();
            for (const el of document.querySelectorAll(
              "footer, nav, header, [class*='footer'], [class*='sidebar'], [class*='widget'], [class*='trending'], [class*='brewing'], [class*='explainer'], [class*='header']"
            )) {
              for (const a of el.querySelectorAll("a")) excluded.add(a);
            }

            // ── Scope to main content area ────────────────────────────────────
            const container =
              document.querySelector("main") ||
              document.querySelector("[class*='listing']") ||
              document.querySelector("[class*='content']") ||
              document.body;

            const anchors = container.querySelectorAll("a[href]");

            for (const a of anchors) {
              if (excluded.has(a)) continue;

              const href = a.href;
              const title = a.innerText?.trim();

              if (
                !href.startsWith("https://www.deccanherald.com") ||
                !title ||
                title.length < 15
              ) continue;

              // Skip section/utility pages
              if (
                href.match(/\/(tag|author|search|video|photos|epaper|newsletter|brandspot|most-brewing|news-shots|newsletters)\//i) ||
                href.match(/\/(top-karnataka-news|top-bengaluru-news|karnataka-latest-news|top-india-news|latest-news|top-sports-news|top-business-news|top-opinion-news|top-videos-today|top-news-photos|top-news-entertainment-today|dh-specials|assembly-elections-2026)\/?(\?.*)?$/) ||
                href === "https://www.deccanherald.com/" ||
                href.match(/\/(india|karnataka|bengaluru|world|sports|entertainment|technology|health|education|lifestyle|opinion|explainers|india-south|india-north|india-west|india-east-north-east)\/?$/)
              ) continue;

              // Article URLs end with 6-7 digit numeric ID e.g. slug-3964987
              if (!href.match(/-\d{6,7}$/)) continue;

              const parent =
                a.closest("article, li, div[class*='card'], div[class*='story'], div[class*='item']") ||
                a.parentElement;
              const timeEl = parent?.querySelector("time");
              const dateStr =
                timeEl?.getAttribute("datetime") || timeEl?.innerText?.trim() || null;

              results.push({ title, url: href, date: dateStr, category: sourceCategory });

              if (results.length >= 50) break;
            }

            return results;
          }, source.category);

          for (const article of articles) {
            if (!seenUrls.has(article.url)) {
              seenUrls.add(article.url);
              allArticles.push(article);
            }
          }

          console.log(`    → ${articles.length} articles found`);
          await page.waitForTimeout(1500);

        } catch (err) {
          console.warn(`    ⚠ Failed: ${url} — ${err.message}`);
        }
      }
    }

    return allArticles;
  },
};