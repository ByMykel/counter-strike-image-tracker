const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const path = require("path");
const { cleanupLocalImages, isCdnUrl, isCommunityCdnUrl } = require("./utils");

function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Usage: node scripts/scrape-individual-listings.js <username> <password> [--all | --non-cdn] [--query <query>] [--type <type>]
// Mode (pick one, default = missing): --all re-fetch every item; --non-cdn only items whose source image is
// not the community CDN (cdn.steamstatic or raw.githubusercontent) — community CDN is preferred;
// default missing = stored url null/github-raw.
const args = process.argv.slice(2);
const USERNAME = args[0];
const PASSWORD = args[1];
const flags = args.slice(2);
const REFETCH_ALL = flags.includes('--all');
const NON_CDN_ONLY = flags.includes('--non-cdn');
const QUERY_INDEX = flags.indexOf('--query');
const QUERY = QUERY_INDEX !== -1 ? flags[QUERY_INDEX + 1] || '' : '';
const TYPE_INDEX = flags.indexOf('--type');
const TYPE = TYPE_INDEX !== -1 ? flags[TYPE_INDEX + 1] || '' : '';

if (REFETCH_ALL && NON_CDN_ONLY) {
	console.error("Error: pick only one mode — --all OR --non-cdn OR neither (missing).");
	process.exit(1);
}

const CONFIG = {
	STATIC_DIR: path.join(__dirname, "..", "static"),
	ITEMS_API_BASE_URL: "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en",
	MARKET_BASE_URL: "https://steamcommunity.com/market",
	MAX_DURATION: 3600 * 1000 * 4, // 4 hours
	DELAY_PER_ITEM: 10 * 1000, // 10 seconds
	SAVE_EVERY_N_ITEMS: 25, // periodic flush to disk so a hard kill loses at most N items
	STEAM_APP_ID: 730,
	OUTPUT_FILE: "images.json"
};

function validateInput() {
	if (!USERNAME || !PASSWORD) {
		console.error("Usage: node scripts/scrape-individual-listings.js <username> <password> [--all] [--query <query>]");
		process.exit(1);
	}
}

function ensureStaticDir() {
	if (!fs.existsSync(CONFIG.STATIC_DIR)) {
		fs.mkdirSync(CONFIG.STATIC_DIR);
	}
}

class CDNImageScraper {
	constructor({ refetchAll = false, nonCdnOnly = false, query = '', type = '' } = {}) {
		this.community = new SteamCommunity();
		this.startTime = Date.now();
		this.errorFound = false;
		this.existingImageUrls = {};
		this.outputPath = path.join(CONFIG.STATIC_DIR, CONFIG.OUTPUT_FILE);
		this.refetchAll = refetchAll;
		this.nonCdnOnly = nonCdnOnly;
		this.query = query.toLowerCase();
		this.type = type;
		this.updatedCount = 0;
		// market_hash_name -> image_inventory, for opportunistic harvesting.
		this.mhnToInventory = new Map();
		// image_inventory keys already resolved this run, so we don't refetch a page
		// whose variants we've already harvested.
		this.resolvedThisRun = new Set();
	}

	loadExistingImageUrls() {
		if (fs.existsSync(this.outputPath)) {
			const data = fs.readFileSync(this.outputPath);
			this.existingImageUrls = JSON.parse(data);
		}
	}

	async getAllItems(typeFilter = this.type) {
		const type = typeFilter === 'skins' ? 'skins_not_grouped' : typeFilter;
		const endpoint = type ? `${type}.json` : 'all.json';
		const response = await fetch(`${CONFIG.ITEMS_API_BASE_URL}/${endpoint}`);
		const data = await response.json();

		// Some endpoints return arrays, others return objects.
		const items = Array.isArray(data) ? data : Object.values(data);

		return items
			.map(item => ({
				name: item.name,
				market_hash_name: item.market_hash_name,
				image_inventory: item.original?.image_inventory,
				phase: item?.phase,
				image: item?.image,
			}))
			.filter(item => {
				if (!item.image_inventory) {
					console.warn(`[WARNING] No 'image_inventory' for '${item.name || 'unknown'}'`);
					return false;
				}

				if (item.phase) {
					return false;
				}

				return true;
			});
	}

	getItemsToProcess(items) {
		let candidates = items.filter(item => item.market_hash_name);

		if (this.query) {
			candidates = candidates.filter(item =>
				item.market_hash_name.toLowerCase().includes(this.query)
			);
			console.log(`[INFO] Found ${candidates.length} items matching query "${this.query}":`);
		}

		return candidates.filter(item => {
			// Only items whose source image is not the community CDN (community CDN preferred over
			// cdn.steamstatic / raw GitHub).
			if (this.nonCdnOnly) {
				return !!item.image && (
					item.image.includes("cdn.steamstatic") ||
					item.image.includes("raw.githubusercontent")
				);
			}

			if (this.refetchAll) {
				return true;
			}

			const existingUrl = this.existingImageUrls[item.image_inventory];
			return !isCdnUrl(existingUrl);
		});
	}

	addAllItemsToInventory(items) {
		let addedCount = 0;

		for (const item of items) {
			if (!(item.image_inventory in this.existingImageUrls)) {
				this.existingImageUrls[item.image_inventory] = null;
				addedCount++;
			}
		}

		if (addedCount > 0) {
			console.log(`[INFO] Added ${addedCount} items to inventory:`);
			for (const item of items) {
				if (this.existingImageUrls[item.image_inventory] === null) {
					console.log(`  - ${item.market_hash_name || item.name} (${item.image_inventory})`);
				}
			}
		}

		return addedCount;
	}

	// Returns the page HTML, or null on a non-200 (and flags a rate-limit to stop the run).
	async fetchListingHtml(marketHashName) {
		return new Promise((resolve, reject) => {
			const url = `${CONFIG.MARKET_BASE_URL}/listings/${CONFIG.STEAM_APP_ID}/${encodeURIComponent(marketHashName)}`;

			this.community.request.get(url, (err, res) => {
				if (err) {
					reject(err);
					return;
				}

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

				resolve(res.body);
			});
		});
	}

	// A grouped page embeds every variant it shows (a skin's exteriors, a sticker and
	// its slab, sidebar items, ...) as an object with an `icon_url` followed by its
	// `market_hash_name`. Harvesting all of them resolves many items per request.
	// Backslash-escaping varies in depth, so tolerate any run of backslashes.
	extractAllImages(html) {
		const re = /icon_url\\*":\\*"([A-Za-z0-9_-]+)[\s\S]*?market_hash_name\\*":\\*"([\s\S]*?)\\*"/g;
		const images = new Map();
		let m;
		while ((m = re.exec(html)) !== null) {
			const marketHashName = m[2];
			if (!images.has(marketHashName)) {
				images.set(marketHashName, m[1]);
			}
		}
		return images;
	}

	// A grouped page only embeds g_rgAssets (icon_url) for buckets that have live
	// listings. Buckets with no listings (e.g. a brand-new slab) still appear in the
	// bucket list with their classid but no image. Map market_hash_name -> classid so
	// we can resolve those via itemclasshover.
	extractBucketClassids(html) {
		const re = /bucket_id\\*":\\*"([\s\S]*?)\\*"[\s\S]*?classid\\*":\\*"(\d+)/g;
		const classids = new Map();
		let m;
		while ((m = re.exec(html)) !== null) {
			if (!classids.has(m[1])) {
				classids.set(m[1], m[2]);
			}
		}
		return classids;
	}

	// Resolve a single classid's icon_url via the public itemclasshover endpoint.
	// Works even when the item has zero market listings. Returns the hash or null.
	resolveIconByClassid(classid) {
		return new Promise((resolve) => {
			const url = `${CONFIG.MARKET_BASE_URL.replace('/market', '')}/economy/itemclasshover/${CONFIG.STEAM_APP_ID}/${classid}?content_only=1&l=english`;
			this.community.request.get(url, (err, res) => {
				if (err || !res || res.statusCode !== 200) {
					resolve(null);
					return;
				}
				const m = res.body.match(/"icon_url":"([A-Za-z0-9_-]+)"/);
				resolve(m ? m[1] : null);
			});
		});
	}

	shouldUpdate(imageInventory) {
		if (this.refetchAll) {
			return true;
		}
		const existingUrl = this.existingImageUrls[imageInventory];
		// --non-cdn targets the community economy CDN, so a market-CDN url
		// (cdn.steamstatic) still needs replacing — isCdnUrl would wrongly treat it as done.
		if (this.nonCdnOnly) {
			return !isCommunityCdnUrl(existingUrl);
		}
		return !isCdnUrl(existingUrl);
	}

	// Apply harvested images to any items we still need, keyed by market_hash_name.
	applyHarvestedImages(images) {
		let applied = 0;
		for (const [marketHashName, hash] of images) {
			const imageInventory = this.mhnToInventory.get(marketHashName);
			if (!imageInventory || this.resolvedThisRun.has(imageInventory) || !this.shouldUpdate(imageInventory)) {
				continue;
			}
			this.existingImageUrls[imageInventory] = `https://community.akamai.steamstatic.com/economy/image/${hash}`;
			this.resolvedThisRun.add(imageInventory);
			this.updatedCount++;
			applied++;
		}
		return applied;
	}

	async processItems(items) {
		for (let i = 0; i < items.length; i++) {
			if (this.isMaxDurationReached()) {
				console.log("Max duration reached. Stopping the process.");
				return;
			}

			const item = items[i];

			// Already filled by a previous page's harvest — no request needed.
			if (this.resolvedThisRun.has(item.image_inventory) || !this.shouldUpdate(item.image_inventory)) {
				console.log(`[INFO] ${item.market_hash_name} already resolved this run; skipping request (${i + 1}/${items.length})`);
				continue;
			}

			let madeRequest = false;
			try {
				const html = await this.fetchListingHtml(item.market_hash_name);
				if (html) {
					madeRequest = true;
					const applied = this.applyHarvestedImages(this.extractAllImages(html));
					console.log(`[INFO] Harvested ${applied} image(s) from '${item.market_hash_name}'`);

					// Fallback: the item is a bucket with no live listings, so its asset
					// isn't embedded. Resolve its image directly from the bucket classid.
					if (this.shouldUpdate(item.image_inventory)) {
						const classid = this.extractBucketClassids(html).get(item.market_hash_name);
						if (classid) {
							const hash = await this.resolveIconByClassid(classid);
							if (hash) {
								this.existingImageUrls[item.image_inventory] = `https://community.akamai.steamstatic.com/economy/image/${hash}`;
								this.resolvedThisRun.add(item.image_inventory);
								this.updatedCount++;
								console.log(`[INFO] Resolved '${item.market_hash_name}' via classid ${classid}`);
							}
						}
					}

					if (this.shouldUpdate(item.image_inventory)) {
						console.log(`[WARNING] No image found for '${item.market_hash_name}' on its own page`);
					}
				}
			} catch (error) {
				console.log(`Error processing ${item.market_hash_name}:`, error);
			}

			if (this.errorFound) {
				return;
			}

			console.log(`[INFO] Processed item ${i + 1}/${items.length}`);

			// Flush progress to disk periodically so a hard kill (SIGKILL / job cancel,
			// which can't be caught) loses at most SAVE_EVERY_N_ITEMS items.
			if (madeRequest && (i + 1) % CONFIG.SAVE_EVERY_N_ITEMS === 0) {
				this.saveImageUrls();
			}

			// Only delay if we actually hit the network and more items remain.
			if (madeRequest && i < items.length - 1) {
				console.log(`[INFO] Waiting for ${CONFIG.DELAY_PER_ITEM / 1000} seconds to respect rate limit...`);
				await this.delay(CONFIG.DELAY_PER_ITEM);
			}
		}
	}

	isMaxDurationReached() {
		return Date.now() - this.startTime >= CONFIG.MAX_DURATION;
	}

	delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	saveImageUrls() {
		const orderedImageUrls = Object.keys(this.existingImageUrls)
			.sort()
			.reduce((acc, key) => {
				acc[key] = this.existingImageUrls[key];
				return acc;
			}, {});

		try {
			fs.writeFileSync(this.outputPath, JSON.stringify(orderedImageUrls, null, 4));
			console.log(`[INFO] Updated ${this.updatedCount} image URLs in ${CONFIG.OUTPUT_FILE}`);
		} catch (err) {
			console.error("Error saving file:", err);
		}
	}

	async run() {
		try {
			const allItems = await this.getAllItems();

			this.loadExistingImageUrls();

			// Build the harvest map from the full catalog (not the --type subset) so a
			// page resolves siblings across types too — a slab page also fills the
			// sticker (and vice versa), and any exterior fills the others.
			const catalog = this.type ? await this.getAllItems('') : allItems;
			for (const item of catalog) {
				if (item.market_hash_name) {
					this.mhnToInventory.set(item.market_hash_name, item.image_inventory);
				}
			}

			this.addAllItemsToInventory(allItems);

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

async function main() {
	validateInput();
	ensureStaticDir();

	console.log("[INFO] Scrape Individual Listings");
	const modeLabel = NON_CDN_ONLY ? 'non-cdn (only items whose source image is not the community CDN)' : REFETCH_ALL ? 'all (re-fetch economy CDN URLs)' : 'missing only';
	console.log(`[INFO] Mode: ${modeLabel}`);
	if (TYPE) console.log(`[INFO] Type: ${TYPE}`);
	if (QUERY) console.log(`[INFO] Query: "${QUERY}"`);

	const scraper = new CDNImageScraper({ refetchAll: REFETCH_ALL, nonCdnOnly: NON_CDN_ONLY, query: QUERY, type: TYPE });

	// Save data before exiting on Ctrl+C.
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
		await scraper.login(USERNAME, PASSWORD);
		await scraper.run();
		cleanupLocalImages();
	} catch (error) {
		console.error("Failed to execute:", error);
		process.exit(1);
	}
}

main();
