const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const path = require("path");

// Configuration constants
const CONFIG = {
	STATIC_DIR: path.join(__dirname, "..", "static"),
	ITEMS_API_BASE_URL: "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en",
	MARKET_SEARCH_URL: "https://steamcommunity.com/market/search/render/",
	STEAM_APP_ID: 730,
	OUTPUT_FILE: "images.json",
	SEARCH_QUERY: "sticker slab",
	START: 0,
};

// Ensure static directory exists
function ensureStaticDir() {
	if (!fs.existsSync(CONFIG.STATIC_DIR)) {
		fs.mkdirSync(CONFIG.STATIC_DIR);
	}
}

// Market search scraper class
class MarketSearchScraper {
	constructor() {
		this.community = new SteamCommunity();
		this.existingImageUrls = {};
		this.outputPath = path.join(CONFIG.STATIC_DIR, CONFIG.OUTPUT_FILE);
		this.allItemsMap = {}; // Map of market_hash_name -> item data
		this.newImagesFound = 0; // Track images found in this run
	}

	// Load existing image URLs from file
	loadExistingImageUrls() {
		if (fs.existsSync(this.outputPath)) {
			const data = fs.readFileSync(this.outputPath);
			this.existingImageUrls = JSON.parse(data);
		}
	}

	// Load all items from API to match market_hash_name with image_inventory
	async loadAllItems() {
		const response = await fetch(`${CONFIG.ITEMS_API_BASE_URL}/all.json`);
		const data = await response.json();
		
		const items = Object.values(data)
			.map(item => ({
				id: item.id,
				name: item.name,
				market_hash_name: item.market_hash_name,
				image_inventory: item.original?.image_inventory,
				phase: item?.phase,
			}))
			.filter(item => item.market_hash_name && item.image_inventory && !item.phase);

		// Create map for quick lookup
		for (const item of items) {
			this.allItemsMap[item.market_hash_name] = item;
		}
		return items;
	}

	// Fetch market search results (with pagination)
	async fetchMarketSearch(start = 0) {
		return new Promise((resolve, reject) => {
			const params = new URLSearchParams({
				query: CONFIG.SEARCH_QUERY,
				appid: CONFIG.STEAM_APP_ID.toString(),
				norender: "1",
				start: start.toString(),
			});

			const url = `${CONFIG.MARKET_SEARCH_URL}?${params.toString()}`;
			
			
			this.community.request.get(url, (err, res) => {
				if (err) {
					reject(err);
					return;
				}

				try {
					if (res.statusCode === 429) {
						console.log("Rate limited! Stopping script.");
						resolve(null);
						return;
					}

					if (res.statusCode !== 200) {
						console.log(`HTTP ${res.statusCode} for market search`);
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
		// Use asset_description.icon_url and construct the full CDN URL
		if (listing.asset_description && listing.asset_description.icon_url) {
			const iconUrl = listing.asset_description.icon_url;
			// Construct full URL: https://community.akamai.steamstatic.com/economy/image/{icon_url}
			return `https://community.akamai.steamstatic.com/economy/image/${iconUrl}`;
		}
		
		return null;
	}

	// Process all market search results
	async processMarketSearch() {
		let start = CONFIG.START;
		let totalProcessed = 0;
		let totalFound = 0;
		let totalUpdated = 0;
		let pageNumber = 1;
		let totalCount = null;

		while (true) {
			const data = await this.fetchMarketSearch(start);
			
			if (!data || !data.results || data.results.length === 0) {
				console.log("[INFO] No more results to fetch");
				break;
			}

			// Store total_count from first response
			if (totalCount === null && data.total_count !== undefined) {
				totalCount = data.total_count;
				console.log(`[INFO] Total items available: ${totalCount}`);
			}

			console.log(`[INFO] Page ${pageNumber}: Found ${data.results.length} items (${start + 1}-${start + data.results.length}${totalCount ? ` of ${totalCount}` : ''})`);

			for (const listing of data.results) {
				// Use hash_name from the listing to match with market_hash_name in all.json
				const hashName = listing.hash_name;
				if (!hashName) {
					console.log(`[WARNING] No hash_name found in listing:`, listing);
					continue;
				}

				// Find matching item from API using market_hash_name
				const item = this.allItemsMap[hashName];
				if (!item) {
					console.log(`[WARNING] No matching item found for hash_name: ${hashName}`);
					continue;
				}
				// Skip if we already have a value (unless it's null and we found a new one)
				const existingValue = this.existingImageUrls[item.image_inventory];
				if (existingValue !== null && existingValue !== undefined && !existingValue.includes("cdn.steamstatic")) {
					totalProcessed++;
					continue;
				}

				// Extract image URL
				const imageUrl = this.extractImageUrl(listing);
				if (imageUrl) {
					this.existingImageUrls[item.image_inventory] = imageUrl;
					totalFound++;
					if (existingValue === null) {
						totalUpdated++;
					}
					console.log(`[INFO] Found image for: ${hashName}`);
				} else {
					console.log(`[WARNING] No image URL found for: ${hashName}`);
				}

				totalProcessed++;
			}

			// Calculate next start position
			const nextStart = start + data.results.length;
			
			// Determine if there are more pages
			// Stop if we got no results
			if (data.results.length === 0) {
				console.log(`[INFO] Reached end of results (got 0 items)`);
				break;
			}

			// If we have total_count, use it to determine if there are more pages
			if (totalCount !== null) {
				// Continue as long as we haven't reached total_count, regardless of page size
				if (nextStart >= totalCount) {
					console.log(`[INFO] Reached end of results (nextStart: ${nextStart} >= totalCount: ${totalCount})`);
					break;
				}
			}

			// Continue to next page - update start position
			start = nextStart;
			pageNumber++;
			
			// Small delay to avoid rate limiting
			console.log(`[INFO] Waiting 10 seconds before fetching page ${pageNumber}...`);
			await this.delay(5000);
		}

		console.log(`[INFO] Processed ${totalProcessed} items across ${pageNumber} page(s), found ${totalFound} image URLs (${totalUpdated} updated from null)`);
		this.newImagesFound = totalFound;
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
			console.log(`[SUCCESS] Saved ${this.newImagesFound} image URLs from this run to ${CONFIG.OUTPUT_FILE}`);
		} catch (err) {
			console.error("Error saving file:", err);
		}
	}

	// Main execution method
	async run() {
		try {
			this.loadExistingImageUrls();
			await this.loadAllItems();
			await this.processMarketSearch();
			this.saveImageUrls();
		} catch (error) {
			console.error("An error occurred while processing items:", error);
		}
	}

	// Login to Steam community (optional, but may help avoid rate limits)
	login(accountName, password) {
		return new Promise((resolve, reject) => {
			console.log("Logging into Steam community....");
			
			this.community.login({
				accountName,
				password,
				disableMobile: true,
			}, (err) => {
				if (err) {
					console.log("Login error:", err);
					reject(err);
				} else {
					console.log("Login successful");
					resolve();
				}
			});
		});
	}
}

// Main execution
async function main() {
	ensureStaticDir();

	const scraper = new MarketSearchScraper();
	
	// Handle Ctrl+C gracefully - save data before exiting
	let isExiting = false;
	const handleExit = () => {
		if (isExiting) return;
		isExiting = true;
		console.log("\n[INFO] Interrupt received. Saving current data...");
		scraper.saveImageUrls();
		process.exit(0);
	};
	
	process.on('SIGINT', handleExit);
	process.on('SIGTERM', handleExit);
	
	try {
		// Optional: login if credentials provided
		if (process.argv.length >= 4) {
			await scraper.login(process.argv[2], process.argv[3]);
		}
		
		await scraper.run();
	} catch (error) {
		console.error("Failed to execute:", error);
		process.exit(1);
	}
}

// Run the application
main();

