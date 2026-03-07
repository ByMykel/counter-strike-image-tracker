# Scripts

Scripts for tracking and collecting Counter-Strike 2 item images. They populate `static/images.json`, which maps `image_inventory` paths to image URLs.

## Image URL types

There are two kinds of CDN URLs that images can resolve to:

- **Static CDN** (`cdn.steamstatic.com/apps/730/icons/...`) — built from local game files by computing their SHA1 hash. Easiest to obtain since they can be generated locally.
- **Economy CDN** (`community.akamai.steamstatic.com/economy/image/...`) — scraped from Steam Market pages. Required for items that aren't available on the static CDN.

## Pipeline overview

The main automated workflow (`download-and-extract-game-images.yml`) runs hourly:

1. **download-game-files.js** — downloads VPK archives from Steam
2. Decompile textures with Source2Viewer (done in the workflow, not a script)
3. **list-default-generated.js** — records the `default_generated` file list

After images are extracted locally, a separate workflow resolves their URLs:

4. **resolve-cdn-urls.js** — checks if images without a URL can be found on the static CDN

For the remaining items, economy CDN URLs are scraped from the Steam Market:

5. **scrape-individual-listings.js** — visits individual listing HTML pages to fetch economy CDN URLs

Additional:

6. **extract-highlight-thumbnails.js** — extracts thumbnail frames from Souvenir Highlight videos

**Note:** `utils.js` contains shared helpers used by the scripts above.

---

## download-game-files.js

Downloads Counter-Strike 2 VPK game files from Steam using [steam-user](https://github.com/DoctorMcKay/node-steam-user). Only downloads archives that have changed since the last run (tracked via `static/fileSha.json`).

```bash
node scripts/download-game-files.js <username> <password> [--force|--ignore-manifest-diff]
```

**Arguments:**
- `<username>` — Steam account username
- `<password>` — Steam account password

**Flags:**
- `--force` — download all VPK archives even if the manifest ID hasn't changed
- `--ignore-manifest-diff` — re-download even if the manifest matches, but only archives that differ by SHA

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

## resolve-cdn-urls.js

For each `null` entry in `static/images.json`, checks if the image is available on the static CDN by computing the local file's SHA1 hash, constructing the URL, and verifying it exists with a HEAD request.

```bash
node scripts/resolve-cdn-urls.js
```

No flags. Runs without arguments.

**Key features:**
- Processes 5 concurrent requests at a time
- Only processes entries that currently have `null` values

**Output file:** `static/images.json` (replaces `null` with static CDN URLs)

---

## scrape-individual-listings.js

Fetches economy CDN URLs by visiting individual Steam Market listing pages. Requires Steam login.

```bash
node scripts/scrape-individual-listings.js <username> <password> [--all] [--type <type>] [--query <query>]
```

**Arguments:**
- `<username>` — Steam account username
- `<password>` — Steam account password

**Flags:**
- `--all` — re-fetch all items, not just missing ones. Static CDN URLs are preserved.
- `--type <type>` — filter by item type using [CSGO-API](https://github.com/ByMykel/CSGO-API) endpoints: `skins`, `stickers`, `sticker_slabs`, `keychains`, `keys`, `collectibles`, `agents`, `patches`, `graffiti`, `music_kits`, `crates`
- `--query <query>` — filter items by name (e.g. `--query "AK-47"`)

**Key features:**
- By default, only processes items with `null` URLs in `images.json`
- With `--all`, re-fetches economy CDN URLs while preserving static CDN URLs
- 10-second delay between requests to respect rate limits
- Max runtime of 5.5 hours (fits GitHub Actions limits)
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
