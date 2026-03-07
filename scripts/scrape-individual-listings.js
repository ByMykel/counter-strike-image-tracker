const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const path = require("path");
const { cleanupLocalImages, isCdnUrl } = require("./utils");

// Parse command line arguments
// Usage: node scripts/scrape-individual-listings.js <username> <password> [--all] [--query <query>] [--type <type>]
const args = process.argv.slice(2);
const USERNAME = args[0];
const PASSWORD = args[1];
const flags = args.slice(2);
const REFETCH_ALL = flags.includes('--all');
const QUERY_INDEX = flags.indexOf('--query');
const QUERY = QUERY_INDEX !== -1 ? flags[QUERY_INDEX + 1] || '' : '';
const TYPE_INDEX = flags.indexOf('--type');
const TYPE = TYPE_INDEX !== -1 ? flags[TYPE_INDEX + 1] || '' : '';

// Configuration constants
const CONFIG = {
	STATIC_DIR: path.join(__dirname, "..", "static"),
	ITEMS_API_BASE_URL: "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en",
	MARKET_BASE_URL: "https://steamcommunity.com/market",
	MAX_DURATION: 3600 * 1000 * 5.5, // 5.5 hours
	DELAY_PER_ITEM: 10 * 1000, // 10 seconds
	STEAM_APP_ID: 730,
	OUTPUT_FILE: "images.json"
};

// Input validation
function validateInput() {
	if (!USERNAME || !PASSWORD) {
		console.error("Usage: node scripts/scrape-individual-listings.js <username> <password> [--all] [--query <query>]");
		process.exit(1);
	}
}

// Ensure static directory exists
function ensureStaticDir() {
	if (!fs.existsSync(CONFIG.STATIC_DIR)) {
		fs.mkdirSync(CONFIG.STATIC_DIR);
	}
}

// CDN image scraper class to find and track image URLs
class CDNImageScraper {
	constructor({ refetchAll = false, query = '', type = '' } = {}) {
		this.community = new SteamCommunity();
		this.startTime = Date.now();
		this.errorFound = false;
		this.existingImageUrls = {};
		this.outputPath = path.join(CONFIG.STATIC_DIR, CONFIG.OUTPUT_FILE);
		this.refetchAll = refetchAll;
		this.query = query.toLowerCase();
		this.type = type;
	}

	// Load existing image URLs from file
	loadExistingImageUrls() {
		if (fs.existsSync(this.outputPath)) {
			const data = fs.readFileSync(this.outputPath);
			this.existingImageUrls = JSON.parse(data);
			console.log(`[INFO] Already have ${Object.keys(this.existingImageUrls).length} image URLs in ${CONFIG.OUTPUT_FILE}`);
		}
	}

	// Fetch all items from API
	async getAllItems() {
		const endpoint = this.type ? `${this.type}.json` : 'all.json';
		const response = await fetch(`${CONFIG.ITEMS_API_BASE_URL}/${endpoint}`);
		const data = await response.json();

		// Some endpoints return arrays, others return objects
		const items = Array.isArray(data) ? data : Object.values(data);

		return items
			.map(item => ({
				name: item.name,
				market_hash_name: item.market_hash_name,
				image_inventory: item.original?.image_inventory,
				phase: item?.phase,
			}))
			.filter(item => {
				// Only include items with image_inventory
				if (!item.image_inventory) {
					console.warn(`[WARNING] No 'image_inventory' for '${item.name || 'unknown'}'`);
					return false;
				}

				// Skip items with phase
				if (item.phase) {
					return false;
				}

				return true;
			});
	}

	// Get items that need image URL fetching (have market_hash_name)
	getItemsToProcess(items) {
		return items.filter(item => {
			// Skip items without market_hash_name
			if (!item.market_hash_name) {
				return false;
			}

			// Apply query filter
			if (this.query && !item.market_hash_name.toLowerCase().includes(this.query)) {
				return false;
			}

			const existingUrl = this.existingImageUrls[item.image_inventory];

			if (this.refetchAll) {
				// Re-fetch all items, but preserve static CDN URLs
				if (existingUrl && existingUrl.includes('cdn.steamstatic.com')) {
					return false;
				}
				return true;
			}

			// Default: only process items without a CDN URL
			return !isCdnUrl(existingUrl);
		});
	}

	// Add all items to the inventory file (with null for those without market_hash_name)
	addAllItemsToInventory(items) {
		let addedCount = 0;

		for (const item of items) {
			if (!this.existingImageUrls[item.image_inventory]) {
				// Assign null initially for all items
				this.existingImageUrls[item.image_inventory] = null;
				addedCount++;
			}
		}

		if (addedCount > 0) {
			console.log(`[INFO] Added ${addedCount} items to inventory`);
		}

		return addedCount;
	}

	// Fetch image URL for a specific market hash name
	async fetchImageUrl(marketHashName) {
		return new Promise((resolve, reject) => {
			const url = `${CONFIG.MARKET_BASE_URL}/listings/${CONFIG.STEAM_APP_ID}/${encodeURIComponent(marketHashName)}`;

			this.community.request.get(url, (err, res) => {
				if (err) {
					reject(err);
					return;
				}

				try {
					if (res.statusCode === 429) {
						console.log("Rate limited! Stopping script.");
						this.errorFound = true;
						resolve(null);
						return;
					}

					if (res.statusCode !== 200) {
						console.log(`HTTP ${res.statusCode} for ${marketHashName}`);
						resolve(null);
						return;
					}

					const imageUrl = this.extractImageUrl(res.body);
					if (!imageUrl) {
						console.log(`No image URL found for '${url}'`);
					}
					resolve(imageUrl);
				} catch (parseError) {
					reject(parseError);
				}
			});
		});
	}

	// Extract image URL from HTML response
	extractImageUrl(html) {
		const imageMatch = html.match(/economy\/image\/([^"'\s\/]+)/);
		return imageMatch ? `https://community.akamai.steamstatic.com/economy/image/${imageMatch[1]}` : null;
	}

	// Process items with rate limiting
	async processItems(items) {
		for (let i = 0; i < items.length; i++) {
			if (this.isMaxDurationReached()) {
				console.log("Max duration reached. Stopping the process.");
				return;
			}

			const item = items[i];
			try {
				const imageUrl = await this.fetchImageUrl(item.market_hash_name);
				if (imageUrl) {
					this.existingImageUrls[item.image_inventory] = imageUrl;
				}
			} catch (error) {
				console.log(`Error processing ${item.market_hash_name}:`, error);
			}

			if (this.errorFound) {
				return;
			}

			console.log(`[INFO] Processed item ${i + 1}/${items.length}`);
			console.log(`[INFO] Waiting for ${CONFIG.DELAY_PER_ITEM / 1000} seconds to respect rate limit...`);

			await this.delay(CONFIG.DELAY_PER_ITEM);
		}
	}

	// Check if max duration has been reached
	isMaxDurationReached() {
		return Date.now() - this.startTime >= CONFIG.MAX_DURATION;
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
			console.log(`Saved ${Object.keys(this.existingImageUrls).length} total image URLs to ${CONFIG.OUTPUT_FILE}`);
		} catch (err) {
			console.error("Error saving file:", err);
		}
	}

	// Main execution method
	async run() {
		try {
			console.log("[INFO] Loading all items...");
			const allItems = await this.getAllItems();
			console.log(`\n[INFO] Found ${allItems.length} total items with image_inventory.`);

			this.loadExistingImageUrls();

			// Add all items to inventory (with null values)
			this.addAllItemsToInventory(allItems);

			// Get items that need image URL fetching (only those with market_hash_name)
			const itemsToProcess = this.getItemsToProcess(allItems);

			if (itemsToProcess.length > 0) {
				console.log(`[INFO] Need to fetch ${itemsToProcess.length} image URLs for items with market_hash_name`);
				await this.processItems(itemsToProcess);
			} else {
				console.log("[INFO] All items with market_hash_name already have image URLs!");
			}

			this.saveImageUrls();
		} catch (error) {
			console.error("An error occurred while processing items:", error);
		}
	}

	// Login to Steam community
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
					resolve();
				}
			});
		});
	}
}

// Main execution
async function main() {
	validateInput();
	ensureStaticDir();

	console.log("[INFO] Scrape Individual Listings");
	console.log(`[INFO] Mode: ${REFETCH_ALL ? 'all (re-fetch economy CDN URLs)' : 'missing only'}`);
	if (TYPE) console.log(`[INFO] Type: ${TYPE}`);
	if (QUERY) console.log(`[INFO] Query: "${QUERY}"`);

	const scraper = new CDNImageScraper({ refetchAll: REFETCH_ALL, query: QUERY, type: TYPE });

	// Handle Ctrl+C gracefully - save data before exiting
	let isExiting = false;
	const handleExit = () => {
		if (isExiting) return; // Prevent multiple saves
		isExiting = true;
		console.log("\n[INFO] Interrupt received. Saving current data...");
		scraper.saveImageUrls();
		process.exit(0);
	};

	process.on('SIGINT', handleExit);
	process.on('SIGTERM', handleExit);

	try {
		await scraper.login(USERNAME, PASSWORD);
		await scraper.run();
		cleanupLocalImages();
	} catch (error) {
		console.error("Failed to execute:", error);
		process.exit(1);
	}
}

// Run the application
main();
