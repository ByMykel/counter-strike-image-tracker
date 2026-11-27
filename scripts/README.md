# Scripts

Scripts for tracking and collecting Counter-Strike 2 item images. They populate `static/images.json`, which maps `image_inventory` paths to image URLs.

## Image URL types

There are three kinds of image URLs in `images.json`:

- **Raw GitHub** (`raw.githubusercontent.com/...`) — points to the local file in this repo. Assigned automatically when a new image is extracted from game files.
- **Static CDN** (`cdn.steamstatic.com/apps/730/icons/...`) — built from local game files by computing their SHA1 hash. Easiest to obtain since they can be generated locally.
- **Economy CDN** (`community.akamai.steamstatic.com/economy/image/...`) — scraped from Steam Market pages. Required for items that aren't available on the static CDN.

Raw GitHub URLs are upgraded to CDN URLs when possible by the resolve and scrape scripts.

## Pipeline overview

Hourly (`download-and-extract-game-images.yml`):

1. **download-game-files.js** — downloads VPK archives from Steam
2. Decompile textures with Source2Viewer (done in the workflow, not a script)
3. **list-default-generated.js** — records the `default_generated` file list
4. **register-new-images.js** — adds new images to `images.json` with raw GitHub URLs

Daily (`scrape-market-search.yml`):

5. **scrape-market-search.js** — upgrades raw GitHub URLs to economy CDN URLs, in bulk

Weekly (`scrape-individual-listings.yml`):

6. **scrape-individual-listings.js** — same upgrade, one item at a time (resolves every wear)

Manual (`resolve-cdn-urls.yml`):

7. **resolve-cdn-urls.js** — upgrades raw GitHub URLs to static CDN URLs

Manual (run locally, ~2x per year):

8. **extract-highlight-thumbnails.js** — extracts thumbnail frames from Souvenir Highlight videos

**Note:** `utils.js` contains shared helpers used by the scripts above.

---

## download-game-files.js

Downloads Counter-Strike 2 VPK game files from Steam using [steam-user](https://github.com/DoctorMcKay/node-steam-user). Only downloads archives that have changed since the last run (tracked via `static/fileSha.json`).

```bash
node scripts/download-game-files.js <username> <password> [--recheck|--force]
```

**Arguments:**
- `<username>` — Steam account username
- `<password>` — Steam account password

**Flags:**
- `--recheck` — skip the manifest ID cache and re-check for changed archives (only downloads archives with different SHAs)
- `--force` — re-download all archives regardless of manifest ID or SHA differences

**Key features:**
- Compares the latest depot manifest ID against `static/manifestId.txt` to skip unnecessary downloads
- Downloads `pak01_dir.vpk` and only the changed `pak01_XXX.vpk` archives
- Retries failed downloads with exponential backoff (up to 3 attempts)
- Outputs files to `temp/` for subsequent decompilation

**Output files:** `temp/pak01_*.vpk`, `static/manifestId.txt`, `static/fileSha.json`

---

## list-default-generated.js

Records filenames from `static/panorama/images/econ/default_generated/` into `static/default_generated.json`. Merges with existing entries and deduplicates.

```bash
node scripts/list-default-generated.js
```

No flags. Runs without arguments.

**Output file:** `static/default_generated.json`

---

## register-new-images.js

Scans `static/panorama/images/econ/` for PNG and SVG files not yet in `images.json` and adds them with their raw GitHub URL. Runs automatically as part of the hourly workflow.

```bash
node scripts/register-new-images.js
```

No flags. Runs without arguments.

**Key features:**
- Supports both `_png.png` and `.svg` files
- Adds entries for new files and fills in URLs for existing entries with `null` values
- Assigns raw GitHub URLs so images are immediately accessible

**Output file:** `static/images.json`

---

## resolve-cdn-urls.js

For each unresolved entry (raw GitHub URL) in `static/images.json`, checks if the image is available on the static CDN by computing the local file's SHA1 hash, constructing the URL, and verifying it exists with a HEAD request.

```bash
node scripts/resolve-cdn-urls.js
```

No flags. Runs without arguments.

**Key features:**
- Processes 5 concurrent requests at a time
- Processes entries with raw GitHub URLs or `null` values

**Output file:** `static/images.json` (upgrades to static CDN URLs)

---

## scrape-market-search.js

Fetches economy CDN URLs from the Steam Market **search** endpoint. Every search result carries the
item's `asset_description.icon_url`, so one request resolves a whole page of items instead of one.

```bash
node scripts/scrape-market-search.js [username] [password] [--all|--non-cdn] [--type <type>] [--query <query>] [--delay <ms>] [--start <n>] [--max-requests <n>] [--keep-going]
```

**Arguments:**
- `[username] [password]` — optional and ignored (the endpoint is public); still accepted so existing invocations keep working

**Flags:**
- `--all` — re-fetch all items, not just missing ones
- `--non-cdn` — only items whose source image is not the community economy CDN
- `--type <type>` — filter which items count as missing, using the same [CSGO-API](https://github.com/ByMykel/CSGO-API) endpoints as the script below
- `--query <query>` — only scan search results for this query (e.g. `--query "Cologne 2026"`). Omit to sweep the whole market
- `--delay <ms>` — delay between requests (default `1400`)
- `--start <n>` — resume a sweep from this result offset
- `--max-requests <n>` — stop after this many requests (prints the `--start` value to resume from)
- `--keep-going` — keep scanning after every tracked item is resolved

**Key features:**
- ~10 items per request instead of 1, so a full sweep of the market (~35k listed items) takes about an hour
- Stops early once every tracked item has an image
- Backs off and retries on rate limits, saves progress every 100 requests
- Falls back to the whole catalog when harvesting, so a page resolves items outside `--type` too
- Search groups a skin's wears into one row, so other wears' images (`_light`/`_heavy`) often only resolve via `scrape-individual-listings.js`

**Limitation:** Steam's search only indexes items with at least one active listing. Brand-new or very
rare items (a Major sticker nobody has listed yet) are invisible until someone lists one — the same
limitation applies to their individual listing pages.

**Output file:** `static/images.json`

---

## scrape-individual-listings.js

Fetches economy CDN URLs one item at a time through Steam Market's `QueryDescription` action
(`/market/actions?q=QueryDescription`), which returns an exact `market_hash_name`'s description
including `icon_url`. Steam's rebuilt listing pages render client-side and no longer embed item data,
so the old HTML scraping is gone. Unlike `scrape-market-search.js`, this resolves every wear
separately — search groups a skin's wears into one row, so `_light`/`_heavy` images are often only
reachable here.

```bash
node scripts/scrape-individual-listings.js [username] [password] [--all | --non-cdn] [--type <type>] [--query <query>] [--delay <ms>]
```

**Arguments:**
- `[username] [password]` — optional and ignored (the endpoint is public); still accepted so existing invocations keep working

**Flags:**
- `--all` — re-fetch all items, not just missing ones. Static CDN URLs are preserved.
- `--non-cdn` — only items whose source image is not the community economy CDN
- `--type <type>` — filter by item type using [CSGO-API](https://github.com/ByMykel/CSGO-API) endpoints: `skins`, `stickers`, `sticker_slabs`, `keychains`, `keys`, `collectibles`, `agents`, `patches`, `graffiti`, `music_kits`, `crates`
- `--query <query>` — filter items by name (e.g. `--query "AK-47"`)
- `--delay <ms>` — delay between requests (default `5000`)

**Key features:**
- By default, only processes items without a CDN URL (raw GitHub URLs or `null`)
- One request per market name; fills every `image_inventory` sharing it, and skips names whose image an earlier name already filled (StatTrak™, FN/MW sharing `_light`)
- Requests go through Node's `fetch`: Steam answers the `steamcommunity` package's HTTP client with 429 on `/market/actions` even when the IP isn't throttled
- Rate limits back off and retry (60s, 120s, … up to 5 attempts) instead of aborting on the first 429
- Names Steam doesn't know (`{"data": null}`) are listed at the end of the run
- Max runtime of 5 hours (fits GitHub Actions limits); progress flushed every 25 items
- Graceful shutdown on SIGINT/SIGTERM
- Phase/doppler items are skipped

**Output file:** `static/images.json`

---

## extract-highlight-thumbnails.js

Extracts a single thumbnail frame from each Souvenir Highlight video listed in the [CSGO-API highlights endpoint](https://github.com/ByMykel/CSGO-API). Saves frames as WebP images.

```bash
node scripts/extract-highlight-thumbnails.js
```

No flags. Runs without arguments.

**Key features:**
- Processes both English (`ww/`) and Chinese (`cn/`) Souvenir Highlights
- Extracts a frame at ~2–3 seconds (varies by tournament event)
- Skips thumbnails that already exist
- Requires `ffmpeg-static`

**Output directory:** `static/highlightreels/{ww,cn}/<def_index>.webp`
