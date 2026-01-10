const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const path = require("path");

// Parse command line arguments
// Usage: node sync-market-images.js [username] [password] [query] [category]
// Category examples: tag_Type_Hands (gloves), tag_Type_Knife (knives), tag_Type_Rifle (rifles)
const args = process.argv.slice(2);
const USERNAME = args[0] || null;
const PASSWORD = args[1] || null;
const SEARCH_QUERY = args[2] || ""; // Default to empty (all items)
const CATEGORY_TYPE = args[3] || ""; // Default to empty (all categories)

// Configuration constants
const CONFIG = {
	STATIC_DIR: path.join(__dirname, "..", "static"),
	ITEMS_API_BASE_URL: "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en",
	MARKET_SEARCH_URL: "https://steamcommunity.com/market/search/render/",
	STEAM_APP_ID: 730,
	OUTPUT_FILE: "images.json",
	PROGRESS_FILE: "sync-progress.json",
	SEARCH_QUERY: SEARCH_QUERY,
	CATEGORY_TYPE: CATEGORY_TYPE, // e.g., tag_Type_Hands for gloves
	DELAY_MS: 15000, // 15 seconds between requests
	MAX_DURATION: 3600 * 1000 * 5.5, // 5.5 hours in milliseconds
};

// Ensure static directory exists
function ensureStaticDir() {
	if (!fs.existsSync(CONFIG.STATIC_DIR)) {
		fs.mkdirSync(CONFIG.STATIC_DIR);
	}
}

// Market image updater class
class MarketImageUpdater {
	constructor() {
		this.community = new SteamCommunity();
		this.existingImageUrls = {};
		this.outputPath = path.join(CONFIG.STATIC_DIR, CONFIG.OUTPUT_FILE);
		this.progressPath = path.join(CONFIG.STATIC_DIR, CONFIG.PROGRESS_FILE);
		this.allItemsMap = {}; // Map of market_hash_name -> item data
		this.progress = { lastStart: 0, lastUpdated: null, query: "", category: "" };
		this.stats = {
			processed: 0,
			updated: 0,
			skipped: 0,
			notFound: 0,
			preserved: 0, // cdn.steamstatic URLs preserved
		};
		this.notFoundItems = []; // Track items not found in API
		this.dopplerItems = new Set(); // Track doppler/phase items from CSGO-API
		this.startTime = Date.now();
	}

	// Check if max duration has been reached
	isMaxDurationReached() {
		return Date.now() - this.startTime >= CONFIG.MAX_DURATION;
	}

	// Get elapsed time in human readable format
	getElapsedTime() {
		const elapsed = Date.now() - this.startTime;
		const hours = Math.floor(elapsed / (1000 * 60 * 60));
		const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
		return `${hours}h ${minutes}m`;
	}

	// Load existing image URLs from file
	loadExistingImageUrls() {
		if (fs.existsSync(this.outputPath)) {
			const data = fs.readFileSync(this.outputPath);
			this.existingImageUrls = JSON.parse(data);
			console.log(`[INFO] Loaded ${Object.keys(this.existingImageUrls).length} existing image URLs`);
		}
	}

	// Load progress for resuming
	loadProgress() {
		if (fs.existsSync(this.progressPath)) {
			const data = fs.readFileSync(this.progressPath);
			this.progress = JSON.parse(data);

			// Only resume if query and category match
			if (this.progress.query !== CONFIG.SEARCH_QUERY || this.progress.category !== CONFIG.CATEGORY_TYPE) {
				console.log(`[INFO] Query/category changed, starting fresh`);
				console.log(`[INFO]   Previous: query="${this.progress.query}", category="${this.progress.category}"`);
				console.log(`[INFO]   Current: query="${CONFIG.SEARCH_QUERY}", category="${CONFIG.CATEGORY_TYPE}"`);
				this.progress = { lastStart: 0, lastUpdated: null, query: CONFIG.SEARCH_QUERY, category: CONFIG.CATEGORY_TYPE };
			} else {
				console.log(`[INFO] Resuming from position ${this.progress.lastStart} (last updated: ${this.progress.lastUpdated})`);
			}
		} else {
			console.log(`[INFO] Starting fresh (no progress file found)`);
			this.progress.query = CONFIG.SEARCH_QUERY;
			this.progress.category = CONFIG.CATEGORY_TYPE;
		}
	}

	// Save progress for resuming later
	saveProgress() {
		this.progress.lastUpdated = new Date().toISOString();
		this.progress.query = CONFIG.SEARCH_QUERY;
		this.progress.category = CONFIG.CATEGORY_TYPE;
		fs.writeFileSync(this.progressPath, JSON.stringify(this.progress, null, 4));
	}

	// Load all items from API to match market_hash_name with image_inventory
	async loadAllItems() {
		console.log(`[INFO] Fetching items from CSGO-API...`);
		const response = await fetch(`${CONFIG.ITEMS_API_BASE_URL}/all.json`);
		const data = await response.json();

		const allItems = Object.values(data)
			.map(item => ({
				id: item.id,
				name: item.name,
				market_hash_name: item.market_hash_name,
				image_inventory: item.original?.image_inventory,
				phase: item?.phase,
			}))
			.filter(item => item.market_hash_name && item.image_inventory);

		// Track doppler items and create map for non-doppler items
		for (const item of allItems) {
			if (item.phase) {
				this.dopplerItems.add(item.market_hash_name);
			} else {
				this.allItemsMap[item.market_hash_name] = item;
			}
		}

		console.log(`[INFO] Loaded ${Object.keys(this.allItemsMap).length} items from API (excluding ${this.dopplerItems.size} doppler/phase items)`);
		return allItems;
	}

	// Fetch market search results (with pagination)
	async fetchMarketSearch(start = 0) {
		return new Promise((resolve, reject) => {
			const params = new URLSearchParams({
				query: CONFIG.SEARCH_QUERY,
				appid: CONFIG.STEAM_APP_ID.toString(),
				norender: "1",
				start: start.toString(),
				count: "10", // Request max items per page
			});

			// Add category filter if specified (e.g., tag_Type_Hands for gloves)
			if (CONFIG.CATEGORY_TYPE) {
				params.append("category_730_Type[]", CONFIG.CATEGORY_TYPE);
			}

			const url = `${CONFIG.MARKET_SEARCH_URL}?${params.toString()}`;

			this.community.request.get(url, (err, res) => {
				if (err) {
					reject(err);
					return;
				}

				try {
					if (res.statusCode === 429) {
						console.log("[WARNING] Rate limited! Saving progress and stopping.");
						resolve({ rateLimited: true });
						return;
					}

					if (res.statusCode !== 200) {
						console.log(`[WARNING] HTTP ${res.statusCode} for market search`);
						resolve(null);
						return;
					}

					const data = JSON.parse(res.body);
					resolve(data);
				} catch (parseError) {
					reject(parseError);
				}
			});
		});
	}

	// Extract image URL from market listing
	extractImageUrl(listing) {
		if (listing.asset_description && listing.asset_description.icon_url) {
			const iconUrl = listing.asset_description.icon_url;
			return `https://community.akamai.steamstatic.com/economy/image/${iconUrl}`;
		}
		return null;
	}

	// Check if URL should be preserved (locally generated cdn.steamstatic URLs)
	shouldPreserveUrl(url) {
		return url && url.includes("cdn.steamstatic.com");
	}

	// Check if item is a doppler/phase item (intentionally excluded)
	isDopplerItem(hashName) {
		return this.dopplerItems.has(hashName);
	}

	// Process all market search results
	async processMarketSearch() {
		let start = this.progress.lastStart;
		let pageNumber = Math.floor(start / 10) + 1;
		let totalCount = null;

		console.log(`[INFO] Starting market search from position ${start}...`);
		console.log(`[INFO] Search query: "${CONFIG.SEARCH_QUERY || "(all items)"}"`);
		console.log(`[INFO] Category filter: "${CONFIG.CATEGORY_TYPE || "(all categories)"}"`);
		console.log(`[INFO] Max duration: 5.5 hours`);

		while (true) {
			// Check max duration
			if (this.isMaxDurationReached()) {
				console.log(`[INFO] Max duration reached (${this.getElapsedTime()}). Saving progress and stopping.`);
				break;
			}

			const data = await this.fetchMarketSearch(start);

			// Check for rate limiting
			if (data && data.rateLimited) {
				console.log(`[INFO] Rate limited. Progress saved at position ${start}.`);
				break;
			}

			if (!data || !data.results || data.results.length === 0) {
				console.log("[INFO] No more results to fetch");
				break;
			}

			// Store total_count from first response
			if (totalCount === null && data.total_count !== undefined) {
				totalCount = data.total_count;
				console.log(`[INFO] Total items available in market: ${totalCount}`);
			}

			console.log(`[INFO] Page ${pageNumber}: Processing ${data.results.length} items (${start + 1}-${start + data.results.length}${totalCount ? ` of ${totalCount}` : ''}) [${this.getElapsedTime()}]`);

			for (const listing of data.results) {
				const hashName = listing.hash_name;
				if (!hashName) {
					continue;
				}

				// Find matching item from API using market_hash_name
				const item = this.allItemsMap[hashName];
				if (!item) {
					// Skip doppler/phase items as they're intentionally excluded
					if (this.isDopplerItem(hashName)) {
						continue;
					}
					this.stats.notFound++;
					if (!this.notFoundItems.includes(hashName)) {
						this.notFoundItems.push(hashName);
					}
					continue;
				}

				// Check if we should preserve the existing URL (cdn.steamstatic URLs)
				const existingUrl = this.existingImageUrls[item.image_inventory];
				if (this.shouldPreserveUrl(existingUrl)) {
					this.stats.preserved++;
					this.stats.processed++;
					continue;
				}

				// Extract new image URL
				const newImageUrl = this.extractImageUrl(listing);
				if (newImageUrl) {
					// Check if URL actually changed
					if (existingUrl !== newImageUrl) {
						this.existingImageUrls[item.image_inventory] = newImageUrl;
						this.stats.updated++;
						console.log(`[UPDATED] ${item.image_inventory}`);
					} else {
						this.stats.skipped++;
					}
				}

				this.stats.processed++;
			}

			// Update progress
			const nextStart = start + data.results.length;
			this.progress.lastStart = nextStart;
			this.saveProgress();

			// Check if we've reached the end
			if (data.results.length === 0) {
				console.log(`[INFO] Reached end of results (got 0 items)`);
				break;
			}

			if (totalCount !== null && nextStart >= totalCount) {
				console.log(`[INFO] Reached end of results (${nextStart} >= ${totalCount})`);
				// Reset progress since we're done
				this.progress.lastStart = 0;
				this.saveProgress();
				break;
			}

			// Continue to next page
			start = nextStart;
			pageNumber++;

			// Delay to avoid rate limiting
			console.log(`[INFO] Waiting ${CONFIG.DELAY_MS / 1000} seconds before next page...`);
			await this.delay(CONFIG.DELAY_MS);
		}

		this.printStats();
	}

	// Print statistics
	printStats() {
		console.log(`\n[STATS] Processing complete (${this.getElapsedTime()}):`);
		console.log(`  - Processed: ${this.stats.processed}`);
		console.log(`  - Updated: ${this.stats.updated}`);
		console.log(`  - Unchanged: ${this.stats.skipped}`);
		console.log(`  - Preserved (cdn.steamstatic): ${this.stats.preserved}`);
		console.log(`  - Not in API: ${this.stats.notFound}`);

		if (this.notFoundItems.length > 0) {
			console.log(`\n[NOT FOUND] Items not in CSGO-API (${this.notFoundItems.length} unique):`);
			this.notFoundItems.sort().forEach(name => {
				console.log(`  - ${name}`);
			});
		}
	}

	// Utility delay function
	delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	// Save image URLs to file
	saveImageUrls() {
		const orderedImageUrls = Object.keys(this.existingImageUrls)
			.sort()
			.reduce((acc, key) => {
				acc[key] = this.existingImageUrls[key];
				return acc;
			}, {});

		try {
			fs.writeFileSync(this.outputPath, JSON.stringify(orderedImageUrls, null, 4));
			console.log(`[SUCCESS] Saved ${this.stats.updated} updated image URLs to ${CONFIG.OUTPUT_FILE}`);
		} catch (err) {
			console.error("[ERROR] Error saving file:", err);
		}
	}

	// Main execution method
	async run() {
		try {
			this.loadExistingImageUrls();
			this.loadProgress();
			await this.loadAllItems();
			await this.processMarketSearch();
			this.saveImageUrls();
		} catch (error) {
			console.error("[ERROR] An error occurred while processing items:", error);
		}
	}

	// Login to Steam community (optional, but may help avoid rate limits)
	login(accountName, password) {
		return new Promise((resolve, reject) => {
			console.log("[INFO] Logging into Steam community...");

			this.community.login({
				accountName,
				password,
				disableMobile: true,
			}, (err) => {
				if (err) {
					console.log("[ERROR] Login error:", err);
					reject(err);
				} else {
					console.log("[SUCCESS] Login successful");
					resolve();
				}
			});
		});
	}
}

// Main execution
async function main() {
	ensureStaticDir();

	console.log("[INFO] Steam Market Image Sync");
	console.log(`[INFO] Query: "${SEARCH_QUERY || "(all items)"}"`);
	console.log(`[INFO] Category: "${CATEGORY_TYPE || "(all categories)"}"`);
	if (USERNAME) {
		console.log(`[INFO] Login: ${USERNAME}`);
	}

	const updater = new MarketImageUpdater();

	// Handle Ctrl+C gracefully - save data before exiting
	let isExiting = false;
	const handleExit = () => {
		if (isExiting) return;
		isExiting = true;
		console.log("\n[INFO] Interrupt received. Saving current data...");
		updater.saveImageUrls();
		updater.saveProgress();
		updater.printStats();
		process.exit(0);
	};

	process.on('SIGINT', handleExit);
	process.on('SIGTERM', handleExit);

	try {
		// Optional: login if credentials provided
		if (USERNAME && PASSWORD) {
			await updater.login(USERNAME, PASSWORD);
		}

		await updater.run();
	} catch (error) {
		console.error("[ERROR] Failed to execute:", error);
		process.exit(1);
	}
}

// Run the application
main();
