# RSS Scraper — Setup Guide

Playwright-based RSS feed generator for JS-heavy news sites.
Runs on GitHub Actions every 30 minutes, publishes feeds to GitHub Pages,
and FreshRSS subscribes to those static XML URLs.

```
GitHub Actions (cron every 30 min)
  → Playwright scrapes sites
  → Filters out already-seen articles
  → Appends new articles to XML (rolling 100-item window)
  → Commits feeds/ to repo
    → GitHub Pages serves XML
      → FreshRSS polls the XML URL
```

---

## Project structure

```
rss-scraper/
├── scrape.js                        # Main runner — auto-discovers all scrapers
├── scrapers/
│   ├── deccanherald.js              # Deccan Herald (Karnataka + Bengaluru)
│   └── thehindu.js                  # The Hindu (example — add/remove freely)
├── feeds/                           # Auto-created on first run
│   ├── deccanherald.xml             # RSS feed served to FreshRSS
│   ├── deccanherald.seen.json       # Tracks seen URLs (prevents duplicates)
│   ├── thehindu.xml
│   └── thehindu.seen.json
├── index.html                       # Auto-generated feed listing page
├── package.json
├── .gitignore
└── .github/
    └── workflows/
        └── scrape.yml               # GitHub Actions cron job
```

---

## First-time setup

### Step 1 — Create a GitHub repository

- Go to https://github.com/new
- Create a new **public** repository (e.g. `my-rss-feeds`)
- Do not initialise with a README

### Step 2 — Push this project

```bash
cd rss-scraper
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/my-rss-feeds.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

- Go to your repo on GitHub
- Click **Settings → Pages**
- Under "Source" select **Deploy from a branch**
- Branch: `main`, folder: `/ (root)`
- Click **Save**
- GitHub will show you your Pages URL:
  `https://YOUR_USERNAME.github.io/my-rss-feeds/`

### Step 4 — Allow Actions to write to the repo

- Go to **Settings → Actions → General**
- Scroll to "Workflow permissions"
- Select **Read and write permissions**
- Click **Save**

### Step 5 — Trigger the first run manually

- Go to **Actions** tab in your repo
- Click **Scrape RSS Feeds** in the left sidebar
- Click **Run workflow → Run workflow**
- Wait ~2–3 minutes for it to complete
- You should see green checkmark and `feeds/` folder appear in the repo

### Step 6 — Add feeds to FreshRSS

In FreshRSS go to **Subscriptions → Add a feed** and paste:

```
https://YOUR_USERNAME.github.io/my-rss-feeds/feeds/deccanherald.xml
```

Replace `YOUR_USERNAME` and `my-rss-feeds` with your actual values.

---

## How deduplication works

Every scraper run:

1. Scrapes fresh articles from the site
2. Loads `feeds/NAME.seen.json` — a map of `{ url: timestamp }` committed to the repo
3. Filters out any article whose URL is already in the seen map
4. Appends only **new** articles to the top of the XML feed
5. Saves updated seen map back to disk (committed with the feed)

The seen map auto-prunes URLs older than **7 days** so it never grows unboundedly.

The XML itself is capped at **100 items** — a rolling window. New articles go on
top, oldest fall off the bottom. FreshRSS only needs the last 50–100 anyway.

Within a single run, articles that appear on multiple scraped pages (e.g. same
story on both Karnataka and Bengaluru pages) are also deduplicated by URL.

---

## GitHub Actions — minute usage

The free tier gives **2,000 minutes/month**.

| Frequency | Runs/month | ~Time per run | Total |
|-----------|-----------|---------------|-------|
| Every 15 min | 2,880 | ~1.5 min | ~4,320 min ❌ over limit |
| Every 30 min | 1,440 | ~1.5 min | ~2,160 min ⚠ borderline |
| Every 60 min | 720 | ~1.5 min | ~1,080 min ✅ comfortable |

**Recommended: use a self-hosted runner on your Oracle E1 micro** (see below).
This uses zero GitHub Actions minutes — the job runs on your VM for free.

---

## Self-hosted runner on Oracle E1 micro (recommended)

This is the best option since you already have the VM. The scraper runs locally,
pushes only the small XML/JSON files to GitHub, and GitHub Pages serves them.
Your E1 micro never runs Playwright — that stays on GitHub's runners OR you run
it locally with low memory impact since you control the schedule.

### Install the runner on your Oracle VM

1. Go to your GitHub repo → **Settings → Actions → Runners**
2. Click **New self-hosted runner**
3. Select **Linux → x64**
4. Follow the commands shown — they look like:

```bash
# On your Oracle VM:
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64.tar.gz -L https://github.com/actions/runner/releases/download/vX.X.X/actions-runner-linux-x64-X.X.X.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz
./config.sh --url https://github.com/YOUR_USERNAME/my-rss-feeds --token YOUR_TOKEN
./run.sh
```

5. Install as a service so it survives reboots:

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

6. Update `.github/workflows/scrape.yml` — change one line:

```yaml
# Before:
runs-on: ubuntu-latest

# After:
runs-on: self-hosted
```

7. Install Node.js and Playwright on your VM once:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
cd /path/to/rss-scraper
npm ci
npx playwright install chromium --with-deps
```

Now all scraping happens on your VM, zero GitHub Actions minutes consumed.

---

## Adding a new website

1. Copy `scrapers/thehindu.js` to `scrapers/newsite.js`
2. Update the `config` block — `title`, `description`, `siteUrl`
3. Update the `sources` array with the correct section URLs
4. Adjust the article URL pattern in the `scrape()` function if needed
   (the key filter is the regex that identifies article URLs vs section pages)
5. Push to GitHub — it runs automatically on the next cron cycle

No changes to `scrape.js`, `scrape.yml`, or anything else needed.
The main runner auto-discovers all files in `scrapers/`.

Your new feed will appear at:
```
https://YOUR_USERNAME.github.io/my-rss-feeds/feeds/newsite.xml
```

---

## Changing scrape frequency

Edit `.github/workflows/scrape.yml`:

```yaml
- cron: "*/30 * * * *"   # every 30 min
- cron: "0 * * * *"      # every hour
- cron: "*/15 * * * *"   # every 15 min (use self-hosted runner)
```

---

## Troubleshooting

**Feed is empty after first run**
- Check the Actions tab for errors
- Most common cause: GitHub Pages not enabled, or write permissions not set

**Duplicate articles appearing**
- Check that `feeds/deccanherald.seen.json` is being committed (not in .gitignore)
- The `.gitignore` only ignores `node_modules/` and `.playwright/`

**Articles from wrong sections appearing**
- The scraper filters by URL pattern (`/-\d{5,}$/` — numeric ID at end)
- If DH changes their URL structure, update the regex in `scrapers/deccanherald.js`

**Self-hosted runner goes offline**
- SSH into your VM and check: `sudo ./svc.sh status`
- Restart: `sudo ./svc.sh start`
