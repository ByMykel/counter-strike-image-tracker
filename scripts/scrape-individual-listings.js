const fs = require("fs");
const path = require("path");
const { cleanupLocalImages, isCdnUrl, isCommunityCdnUrl } = require("./utils");

// Usage: node scripts/scrape-individual-listings.js [username] [password] [--all | --non-cdn] [--query <query>] [--type <type>] [--delay <ms>]
const argv = process.argv.slice(2);
const hasCredentials = argv.length >= 2 && !argv[0].startsWith('--') && !argv[1].startsWith('--');
const flags = hasCredentials ? argv.slice(2) : argv;
const REFETCH_ALL = flags.includes('--all');
const NON_CDN_ONLY = flags.includes('--non-cdn');

function flagValue(name) {
	const index = flags.indexOf(name);
	return index !== -1 ? flags[index + 1] || '' : '';
}

const QUERY = flagValue('--query');
const TYPE = flagValue('--type');
const DELAY_OVERRIDE = parseInt(flagValue('--delay'), 10);

if (REFETCH_ALL && NON_CDN_ONLY) {
	console.error("Error: pick only one mode — --all OR --non-cdn OR neither (missing).");
	process.exit(1);
}

const CONFIG = {
	STATIC_DIR: path.join(__dirname, "..", "static"),
	ITEMS_API_BASE_URL: "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en",
	ACTIONS_URL: "https://steamcommunity.com/market/actions",
	ACTIONS_HEADERS: { "x-valve-action-type": "queryAction" },
	ECONOMY_IMAGE_BASE_URL: "https://community.akamai.steamstatic.com/economy/image",
	MAX_DURATION: 3600 * 1000 * 5, // 5 hours
	DELAY_PER_ITEM: Number.isNaN(DELAY_OVERRIDE) ? 5000 : DELAY_OVERRIDE,
	RATE_LIMIT_BACKOFF: 60 * 1000,
	MAX_RETRIES: 5,
	SAVE_EVERY_N_ITEMS: 25, // periodic flush to disk so a hard kill loses at most N items
	STEAM_APP_ID: 730,
	OUTPUT_FILE: "images.json"
};

function ensureStaticDir() {
	if (!fs.existsSync(CONFIG.STATIC_DIR)) {
		fs.mkdirSync(CONFIG.STATIC_DIR);
	}
}

class CDNImageScraper {
	constructor({ refetchAll = false, nonCdnOnly = false, query = '', type = '' } = {}) {
		this.startTime = Date.now();
		this.existingImageUrls = {};
		this.outputPath = path.join(CONFIG.STATIC_DIR, CONFIG.OUTPUT_FILE);
		this.refetchAll = refetchAll;
		this.nonCdnOnly = nonCdnOnly;
		this.query = query.toLowerCase();
		this.type = type;
		this.updatedCount = 0;
		this.notFound = [];
		this.mhnToInventory = new Map();
	}

	loadExistingImageUrls() {
		if (fs.existsSync(this.outputPath)) {
			const data = fs.readFileSync(this.outputPath);
			this.existingImageUrls = JSON.parse(data);
		}
	}

	async getAllItems(typeFilter = this.type, { warn = true } = {}) {
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
					if (warn) {
						console.warn(`[WARNING] No 'image_inventory' for '${item.name || 'unknown'}'`);
					}
					return false;
				}

				return !item.phase;
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

	getNamesToProcess(items) {
		let candidates = items.filter(item => item.market_hash_name);

		if (this.query) {
			candidates = candidates.filter(item =>
				item.market_hash_name.toLowerCase().includes(this.query)
			);
			console.log(`[INFO] Found ${candidates.length} items matching query "${this.query}"`);
		}

		if (this.nonCdnOnly) {
			candidates = candidates.filter(item => !!item.image && (
				item.image.includes("cdn.steamstatic") ||
				item.image.includes("raw.githubusercontent")
			));
		}

		const names = new Set();
		for (const item of candidates) {
			if (this.shouldUpdate(item.image_inventory)) {
				names.add(item.market_hash_name);
			}
		}
		return [...names];
	}

	addAllItemsToInventory(items) {
		const added = items.filter(item => !(item.image_inventory in this.existingImageUrls));

		for (const item of added) {
			this.existingImageUrls[item.image_inventory] = null;
		}

		if (added.length > 0) {
			console.log(`[INFO] Added ${added.length} items to inventory:`);
			for (const item of added) {
				console.log(`  - ${item.market_hash_name || item.name} (${item.image_inventory})`);
			}
		}
	}

	buildDescriptionUrl(marketHashName) {
		const params = new URLSearchParams({
			q: "QueryDescription",
			qp: JSON.stringify([CONFIG.STEAM_APP_ID, marketHashName]),
		});
		return `${CONFIG.ACTIONS_URL}?${params.toString()}`;
	}

	// steamcommunity's request client gets 429 here even when fetch gets 200.
	async requestJson(url) {
		try {
			const res = await fetch(url, {
				headers: { "User-Agent": "Mozilla/5.0", ...CONFIG.ACTIONS_HEADERS },
				signal: AbortSignal.timeout(30000),
			});

			if (res.status !== 200) {
				return { status: res.status, json: null };
			}

			try {
				return { status: 200, json: await res.json() };
			} catch (error) {
				return { status: 200, json: null };
			}
		} catch (error) {
			return { status: 0, json: null };
		}
	}

	async queryDescription(marketHashName) {
		for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
			const { status, json } = await this.requestJson(this.buildDescriptionUrl(marketHashName));

			if (json && 'data' in json) {
				return json.data;
			}

			const backoff = CONFIG.RATE_LIMIT_BACKOFF * attempt;
			let reason = status === 429 ? "Rate limited" : `Bad response (HTTP ${status})`;
			if (status === 401 || status === 403) {
				reason = `${reason} — Steam session may have expired`;
			}

			console.log(`[WARNING] ${reason} for '${marketHashName}'. Retry ${attempt}/${CONFIG.MAX_RETRIES} in ${backoff / 1000}s...`);
			await this.delay(backoff);
		}

		throw new Error(`Gave up on '${marketHashName}' after ${CONFIG.MAX_RETRIES} attempts`);
	}

	applyImage(marketHashName, iconUrl) {
		let applied = 0;
		for (const imageInventory of this.mhnToInventory.get(marketHashName) || []) {
			if (!this.shouldUpdate(imageInventory)) {
				continue;
			}
			this.existingImageUrls[imageInventory] = `${CONFIG.ECONOMY_IMAGE_BASE_URL}/${iconUrl}`;
			this.updatedCount++;
			applied++;
		}
		return applied;
	}

	async processNames(names) {
		for (let i = 0; i < names.length; i++) {
			if (this.isMaxDurationReached()) {
				console.log("[INFO] Max duration reached. Stopping the process.");
				return;
			}

			const marketHashName = names[i];
			const progress = `(${i + 1}/${names.length})`;

			const inventories = [...(this.mhnToInventory.get(marketHashName) || [])];
			if (!inventories.some(key => this.shouldUpdate(key))) {
				continue;
			}

			let description;
			try {
				description = await this.queryDescription(marketHashName);
			} catch (error) {
				console.log(`[ERROR] ${error.message}. Stopping; resolved items are saved and the rest retry on a later run.`);
				return;
			}

			if (description?.icon_url) {
				const applied = this.applyImage(marketHashName, description.icon_url);
				console.log(`[INFO] Resolved '${marketHashName}' (${applied} image key(s)) ${progress}`);
			} else {
				this.notFound.push(marketHashName);
				console.log(`[WARNING] Steam returned no description for '${marketHashName}' ${progress}`);
			}

			// Flush progress to disk periodically so a hard kill (SIGKILL / job cancel,
			// which can't be caught) loses at most SAVE_EVERY_N_ITEMS items.
			if ((i + 1) % CONFIG.SAVE_EVERY_N_ITEMS === 0) {
				this.saveImageUrls();
			}

			if (i < names.length - 1) {
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

			const catalog = this.type ? await this.getAllItems('', { warn: false }) : allItems;
			for (const item of catalog) {
				if (!item.market_hash_name) {
					continue;
				}
				const inventories = this.mhnToInventory.get(item.market_hash_name) || new Set();
				inventories.add(item.image_inventory);
				this.mhnToInventory.set(item.market_hash_name, inventories);
			}

			this.addAllItemsToInventory(allItems);

			const names = this.getNamesToProcess(allItems);

			if (names.length > 0) {
				console.log(`[INFO] Need to fetch ${names.length} market names (delay ${CONFIG.DELAY_PER_ITEM}ms)`);
				await this.processNames(names);
			} else {
				console.log("[INFO] All items with market_hash_name already have image URLs!");
			}

			if (this.notFound.length > 0) {
				console.log(`[INFO] ${this.notFound.length} name(s) unknown to Steam's market (not marketable, or name mismatch):`);
				for (const name of this.notFound) {
					console.log(`  - ${name}`);
				}
			}
		} catch (error) {
			console.error("An error occurred while processing items:", error);
		} finally {
			this.saveImageUrls();
		}
	}
}

async function main() {
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
		await scraper.run();
		cleanupLocalImages();
	} catch (error) {
		console.error("Failed to execute:", error);
		process.exit(1);
	}
}

main();
