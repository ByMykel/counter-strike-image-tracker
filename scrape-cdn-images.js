const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const path = require("path");

// Configuration constants
const CONFIG = {
	STATIC_DIR: "./static",
	ITEMS_API_BASE_URL: "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en",
	MARKET_BASE_URL: "https://steamcommunity.com/market",
	MAX_DURATION: 3600 * 1000 * 5.5, // 5.5 hours
	DELAY_PER_ITEM: 7 * 1000, // 7 seconds
	REQUIRED_ARGS: 4,
	STEAM_APP_ID: 730,
	OUTPUT_FILE: "images.json"
};

// Input validation
function validateInput() {
	// Skip validation if using set-phase-null flag
	if (process.argv.length === 3 && process.argv[2] === 'set-phase-null') {
		return;
	}
	
	if (process.argv.length !== CONFIG.REQUIRED_ARGS) {
		console.error(`Missing input arguments, expected ${CONFIG.REQUIRED_ARGS} got ${process.argv.length}`);
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
	constructor() {
		this.community = new SteamCommunity();
		this.startTime = Date.now();
		this.errorFound = false;
		this.existingImageUrls = {};
		this.outputPath = path.join(CONFIG.STATIC_DIR, CONFIG.OUTPUT_FILE);
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
		const response = await fetch(`${CONFIG.ITEMS_API_BASE_URL}/all.json`);
		const data = await response.json();
		
		return Object.values(data)
			.map(item => ({
				id: item.id,
				name: item.name,
				market_hash_name: item.market_hash_name,
				image: item.image,
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

			// Check if item matches URL match pattern
			if (item.image.includes("cdn.steamstatic") && item.id.startsWith("sticker_slab-")) {
				return true;
			}

			// Only process items that we don't already have
			return !this.existingImageUrls[item.image_inventory];
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
		// if (!imageMatch) {
		// 	console.log("No match found, HTML:");
		// 	console.log("------------------- START OF HTML -------------------");
		// 	console.log(html);
		// 	console.log("------------------- END OF HTML -------------------");
		// }
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

// TEMPORARY FUNCTION - Set all phase items to null (DELETE AFTER USE)
async function setPhaseItemsToNull() {
	ensureStaticDir();
	
	const scraper = new CDNImageScraper();
	scraper.loadExistingImageUrls();
	
	try {
		console.log("[INFO] Loading all items to find phase items...");
		const response = await fetch(`${CONFIG.ITEMS_API_BASE_URL}/all.json`);
		const data = await response.json();
		
		const allItems = Object.values(data)
			.map(item => ({
				name: item.name,
				market_hash_name: item.market_hash_name,
				image_inventory: item.original?.image_inventory,
				phase: item?.phase,
			}))
			.filter(item => item.image_inventory && item.phase);

		console.log(`[INFO] Found ${allItems.length} phase items`);
		
		let updatedCount = 0;
		for (const item of allItems) {
			if (scraper.existingImageUrls[item.image_inventory] !== null) {
				scraper.existingImageUrls[item.image_inventory] = null;
				updatedCount++;
			}
		}

		if (updatedCount > 0) {
			scraper.saveImageUrls();
			console.log(`[SUCCESS] Set ${updatedCount} phase items to null`);
		} else {
			console.log("[INFO] No phase items needed updating");
		}
	} catch (error) {
		console.error("Error setting phase items to null:", error);
		process.exit(1);
	}
}

// Main execution
async function main() {
	// TEMPORARY FLAG - Set phase items to null (DELETE AFTER USE)
	if (process.argv.length === 3 && process.argv[2] === 'set-phase-null') {
		await setPhaseItemsToNull();
		return;
	}

	validateInput();
	ensureStaticDir();

	const scraper = new CDNImageScraper();
	
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
		await scraper.login(process.argv[2], process.argv[3]);
		await scraper.run();
	} catch (error) {
		console.error("Failed to execute:", error);
		process.exit(1);
	}
}

// Run the application
main();
