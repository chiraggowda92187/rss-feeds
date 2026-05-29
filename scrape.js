import { chromium } from "playwright";
import { Feed } from "feed";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEEDS_DIR = path.join(__dirname, "feeds");
const MAX_FEED_ITEMS = 100;       // max articles kept in the XML
const SEEN_TTL_DAYS = 7;          // forget seen URLs after 7 days (prevents infinite growth)

if (!fs.existsSync(FEEDS_DIR)) fs.mkdirSync(FEEDS_DIR);

// ─── Seen URL store ───────────────────────────────────────────────────────────

function loadSeen(scraperName) {
  const seenPath = path.join(FEEDS_DIR, `${scraperName}.seen.json`);
  if (!fs.existsSync(seenPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(seenPath, "utf8"));
  } catch {
    return {};
  }
}

function saveSeen(scraperName, seenMap) {
  // Prune entries older than SEEN_TTL_DAYS to prevent unbounded growth
  const cutoff = Date.now() - SEEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const pruned = Object.fromEntries(
    Object.entries(seenMap).filter(([, ts]) => ts > cutoff)
  );
  const seenPath = path.join(FEEDS_DIR, `${scraperName}.seen.json`);
  fs.writeFileSync(seenPath, JSON.stringify(pruned, null, 2));
  return pruned;
}

function filterNew(articles, seenMap) {
  return articles.filter((a) => !seenMap[a.url]);
}

function markSeen(articles, seenMap) {
  const now = Date.now();
  for (const a of articles) {
    seenMap[a.url] = now;
  }
  return seenMap;
}

// ─── Existing feed items (for rolling window) ────────────────────────────────

function loadExistingItems(scraperName) {
  const xmlPath = path.join(FEEDS_DIR, `${scraperName}.xml`);
  if (!fs.existsSync(xmlPath)) return [];
  // Parse existing items from the XML — simple regex extraction is fine here
  const xml = fs.readFileSync(xmlPath, "utf8");
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || [])[1] || "";
    const link = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || "";
    const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(block) || [])[1] || "";
    const category = (/<category><!\[CDATA\[(.*?)\]\]><\/category>/.exec(block) || [])[1] || "";
    if (link) items.push({ title, url: link, date: pubDate ? new Date(pubDate) : new Date(), category });
  }
  return items;
}

// ─── Main runner ─────────────────────────────────────────────────────────────

const scraperDir = path.join(__dirname, "scrapers");
const scraperFiles = fs.readdirSync(scraperDir).filter((f) => f.endsWith(".js"));

async function runAll() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  for (const file of scraperFiles) {
    const scraperName = file.replace(".js", "");
    console.log(`\n▶ Running scraper: ${scraperName}`);

    try {
      const mod = await import(`./scrapers/${file}`);
      const scraper = mod.default;

      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      });

      const page = await context.newPage();
      await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}", (r) => r.abort());

      // 1. Scrape fresh articles
      const freshArticles = await scraper.scrape(page);
      await context.close();

      if (!freshArticles || freshArticles.length === 0) {
        console.warn(`  ⚠ No articles found`);
        continue;
      }
      console.log(`  📥 Scraped ${freshArticles.length} total articles`);

      // 2. Load seen URLs from disk
      let seenMap = loadSeen(scraperName);
      console.log(`  🗂  Known URLs in seen store: ${Object.keys(seenMap).length}`);

      // 3. Filter to only NEW articles
      const newArticles = filterNew(freshArticles, seenMap);
      console.log(`  ✨ New articles (not seen before): ${newArticles.length}`);

      if (newArticles.length === 0) {
        console.log(`  ✅ Nothing new — feed unchanged`);
        continue;
      }

      // 4. Mark new articles as seen and persist
      seenMap = markSeen(newArticles, seenMap);
      saveSeen(scraperName, seenMap);

      // 5. Load existing feed items and prepend new ones (newest first)
      const existingItems = loadExistingItems(scraperName);
      const combined = [...newArticles, ...existingItems];

      // 6. Trim to rolling window of MAX_FEED_ITEMS
      const trimmed = combined.slice(0, MAX_FEED_ITEMS);

      // 7. Build and write RSS feed
      const feed = new Feed({
        title: scraper.config.title,
        description: scraper.config.description,
        id: scraper.config.siteUrl,
        link: scraper.config.siteUrl,
        language: "en",
        updated: new Date(),
        generator: "rss-scraper",
      });

      for (const article of trimmed) {
        feed.addItem({
          title: article.title,
          id: article.url,
          link: article.url,
          description: article.description || "",
          date: article.date ? new Date(article.date) : new Date(),
          category: article.category ? [{ name: article.category }] : [],
        });
      }

      const xmlPath = path.join(FEEDS_DIR, `${scraperName}.xml`);
      fs.writeFileSync(xmlPath, feed.rss2());
      console.log(`  ✅ Feed updated: ${newArticles.length} new + ${existingItems.length} existing → ${trimmed.length} total items`);

    } catch (err) {
      console.error(`  ❌ Error in ${scraperName}:`, err.message);
    }
  }

  await browser.close();
  generateIndex();
}

function generateIndex() {
  const files = fs.readdirSync(FEEDS_DIR).filter((f) => f.endsWith(".xml"));
  const links = files
    .map((f) => `<li><a href="feeds/${f}">${f.replace(".xml", "")}</a></li>`)
    .join("\n");
  const html = `<!DOCTYPE html>
<html>
<head><title>RSS Feeds</title></head>
<body>
  <h1>Available RSS Feeds</h1>
  <ul>${links}</ul>
  <p>Last updated: ${new Date().toISOString()}</p>
</body>
</html>`;
  fs.writeFileSync(path.join(__dirname, "index.html"), html);
  console.log("\n📄 index.html updated");
}

runAll().catch(console.error);
