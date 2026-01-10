# Scripts

## sync-market-images.js

A script that synchronizes Counter-Strike 2 item images from the Steam Community Market.

### Purpose

This script fetches item images from the Steam Market and maps them to their corresponding `image_inventory` paths from the [CSGO-API](https://github.com/ByMykel/CSGO-API). The results are saved to `static/images.json`.

### Usage

```bash
node scripts/sync-market-images.js [username] [password] [query] [category]
```

**Arguments (all optional):**
- `username` - Steam account username for authenticated requests
- `password` - Steam account password
- `query` - Search query to filter items (default: empty string for all items)
- `category` - Category type filter (default: empty string for all categories)

**Category values:**
| Category | Value |
|----------|-------|
| Gloves | `tag_Type_Hands` |
| Charm | `tag_CSGO_Tool_Keychain` |

**Examples:**

```bash
# Fetch all items (no login)
node scripts/sync-market-images.js

# Fetch all items with Steam login
node scripts/sync-market-images.js myusername mypassword

# Fetch only AK-47 items
node scripts/sync-market-images.js "" "" "AK-47"

# Fetch only gloves
node scripts/sync-market-images.js "" "" "" "tag_Type_Hands"

# Fetch only knives with login
node scripts/sync-market-images.js myusername mypassword "" "tag_Type_Knife"
```

### How It Works

1. Loads existing image URLs from `static/images.json`
2. Loads progress from `static/sync-progress.json` (for resuming)
3. Fetches all items from CSGO-API to get `market_hash_name` to `image_inventory` mappings
4. Queries the Steam Market search API with pagination (10 items per page)
5. For each market listing, extracts the image URL and maps it to the item's `image_inventory` path
6. Saves updated URLs to `static/images.json`

### Features

- **Resume support**: Progress is saved to `sync-progress.json`, allowing the script to resume from where it left off
- **Rate limit handling**: Automatically stops and saves progress when rate limited
- **Max duration**: Stops after 5.5 hours to fit within GitHub Actions limits
- **URL preservation**: Preserves existing `cdn.steamstatic.com` URLs (locally generated) over market URLs
- **Graceful shutdown**: Handles SIGINT/SIGTERM to save data before exiting

### Configuration

Key settings in the script:
- `DELAY_MS`: 15 seconds between API requests
- `MAX_DURATION`: 5.5 hours maximum runtime
- `STEAM_APP_ID`: 730 (Counter-Strike 2)

### Output Files

| File | Description |
|------|-------------|
| `static/images.json` | Map of `image_inventory` paths to image URLs |
| `static/sync-progress.json` | Progress tracking for resume functionality |

### Notes

- Doppler/phase items are excluded from processing
- Items not found in the CSGO-API are skipped
- Steam login is optional but may help avoid rate limits
