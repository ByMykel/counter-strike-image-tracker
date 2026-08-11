const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { cleanupLocalImages, isCdnUrl, isCommunityCdnUrl } = require("./utils");

// Usage: node scripts/scrape-market-search.js [username] [password] [--all | --non-cdn] [--query <query>]
//                                             [--type <type>] [--delay <ms>] [--start <n>]
//                                             [--max-requests <n>] [--keep-going]
//
// Bulk alternative to scrape-individual-listings.js. Instead of one market listing page per item,
// this pages the market search endpoint, which returns a batch of items per request — each with its
// asset_description.icon_url.
//
// Credentials are positional, same as scrape-individual-listings.js, but optional here: the search
// endpoint answers anonymously too. Steam's market throttling is mostly per-IP, so logging in is not
// a hard multiplier, but authenticated requests sit in a less aggressive bucket — so the default
// delay drops when we have a session.
//
// Search only indexes items that currently have at least one active listing, so brand-new or very
// rare items (a freshly released Major sticker nobody has listed yet) are invisible here — exactly
// like on their own listing page. They resolve on a later run once someone lists one.
const argv = process.argv.slice(2);

// Credentials only when they lead the argument list; otherwise every arg is a flag and we run
// anonymously. Keeps `node scripts/scrape-market-search.js --all` working as it always has.
const hasCredentials = argv.length >= 2 && !argv[0].startsWith("--") && !argv[1].startsWith("--");
const USERNAME = hasCredentials ? argv[0] : "";
const PASSWORD = hasCredentials ? argv[1] : "";
const args = hasCredentials ? argv.slice(2) : argv;

const REFETCH_ALL = args.includes("--all");
const NON_CDN_ONLY = args.includes("--non-cdn");
const KEEP_GOING = args.includes("--keep-going");

function flagValue(name) {
	const index = args.indexOf(name);
	return index !== -1 ? args[index + 1] || "" : "";
}

const QUERY = flagValue("--query");
const TYPE = flagValue("--type");
const DELAY_OVERRIDE = parseInt(flagValue("--delay"), 10);
const START_OFFSET = parseInt(flagValue("--start"), 10) || 0;
const MAX_REQUESTS = parseInt(flagValue("--max-requests"), 10) || Infinity;

if (REFETCH_ALL && NON_CDN_ONLY) {
	console.error("Error: pick only one mode — --all OR --non-cdn OR neither (missing).");
	process.exit(1);
}

const CONFIG = {
	STATIC_DIR: path.join(__dirname, "..", "static"),
	ITEMS_API_BASE_URL: "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en",
	SEARCH_URL: "https://steamcommunity.com/market/search/render/",
	ECONOMY_IMAGE_BASE_URL: "https://community.akamai.steamstatic.com/economy/image",
	MAX_DURATION: 3600 * 1000 * 5, // 5 hours
	// ~1 req/s is comfortably under the anonymous rate limit; a logged-in session tolerates a
	// faster cadence. --delay overrides both.
	DELAY_ANONYMOUS: 1200,
	DELAY_AUTHENTICATED: 700,
	DELAY_OVERRIDE: Number.isNaN(DELAY_OVERRIDE) ? null : DELAY_OVERRIDE,
	RATE_LIMIT_BACKOFF: 60 * 1000,
	MAX_RETRIES: 5,
	SAVE_EVERY_N_REQUESTS: 100,
	STEAM_APP_ID: 730,
	// Steam caps the page size server-side (10 at the time of writing) and ignores larger
	// values, so treat the response's pagesize as the source of truth.
	REQUESTED_PAGE_SIZE: 100,
	OUTPUT_FILE: "images.json"
};

function ensureStaticDir() {
	if (!fs.existsSync(CONFIG.STATIC_DIR)) {
		fs.mkdirSync(CONFIG.STATIC_DIR);
	}
}

class MarketSearchScraper {
	constructor({ refetchAll = false, nonCdnOnly = false, query = "", type = "" } = {}) {
		this.startTime = Date.now();
		this.existingImageUrls = {};
		this.outputPath = path.join(CONFIG.STATIC_DIR, CONFIG.OUTPUT_FILE);
		this.refetchAll = refetchAll;
		this.nonCdnOnly = nonCdnOnly;
		this.query = query;
		this.type = type;
		this.updatedCount = 0;
		this.requestCount = 0;
		this.seenNames = 0;
		// Set by login(); null means anonymous requests via plain https.
		this.community = null;
		// market_hash_name -> image_inventory, for the whole catalog.
		this.mhnToInventory = new Map();
		// image_inventory keys still waiting for an image; drains as we harvest.
		this.pending = new Set();
	}

	loadExistingImageUrls() {
		if (fs.existsSync(this.outputPath)) {
			this.existingImageUrls = JSON.parse(fs.readFileSync(this.outputPath));
		}
	}

	async getAllItems(typeFilter = this.type) {
		const type = typeFilter === "skins" ? "skins_not_grouped" : typeFilter;
		const endpoint = type ? `${type}.json` : "all.json";
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
			.filter(item => item.image_inventory && !item.phase);
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

	// Items we still want an image for, so we can report progress and stop early once done.
	buildPendingSet(items) {
		for (const item of items) {
			if (!item.market_hash_name) {
				continue;
			}

			if (this.nonCdnOnly) {
				const isInferiorSource = !!item.image && (
					item.image.includes("cdn.steamstatic") ||
					item.image.includes("raw.githubusercontent")
				);
				if (!isInferiorSource) {
					continue;
				}
			}

			if (this.shouldUpdate(item.image_inventory)) {
				this.pending.add(item.image_inventory);
			}
		}
	}

	buildRequestUrl(start) {
		const params = new URLSearchParams({
			appid: String(CONFIG.STEAM_APP_ID),
			norender: "1",
			search_descriptions: "0",
			start: String(start),
			count: String(CONFIG.REQUESTED_PAGE_SIZE),
			sort_column: "name",
			sort_dir: "asc",
		});

		if (this.query) {
			params.set("query", this.query);
		}

		return `${CONFIG.SEARCH_URL}?${params.toString()}`;
	}

	login(accountName, password) {
		return new Promise((resolve, reject) => {
			console.log("Logging into Steam community....");

			const community = new SteamCommunity();

			community.login({
				accountName,
				password,
				disableMobile: true,
			}, (err) => {
				if (err) {
					console.log("Login error:", err);
					reject(err);
				} else {
					// Only now do requests go through the session's cookie jar.
					this.community = community;
					resolve();
				}
			});
		});
	}

	get delayPerRequest() {
		if (CONFIG.DELAY_OVERRIDE !== null) {
			return CONFIG.DELAY_OVERRIDE;
		}
		return this.community ? CONFIG.DELAY_AUTHENTICATED : CONFIG.DELAY_ANONYMOUS;
	}

	// Same contract as fetchJson: never rejects, resolves { status, json } with json === null on
	// any failure so fetchPage's retry/backoff handles it uniformly.
	fetchJsonAuthenticated(url) {
		return new Promise((resolve) => {
			this.community.request.get({ url, timeout: 30000 }, (err, res) => {
				if (err || !res) {
					resolve({ status: 0, json: null });
					return;
				}

				if (res.statusCode !== 200) {
					resolve({ status: res.statusCode, json: null });
					return;
				}

				try {
					resolve({ status: 200, json: JSON.parse(res.body) });
				} catch (error) {
					resolve({ status: 200, json: null });
				}
			});
		});
	}

	fetchJson(url) {
		if (this.community) {
			return this.fetchJsonAuthenticated(url);
		}

		return new Promise((resolve) => {
			const request = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
				let body = "";
				res.on("data", chunk => (body += chunk));
				res.on("end", () => {
					if (res.statusCode !== 200) {
						resolve({ status: res.statusCode, json: null });
						return;
					}
					try {
						resolve({ status: 200, json: JSON.parse(body) });
					} catch (error) {
						resolve({ status: 200, json: null });
					}
				});
			});

			request.on("error", () => resolve({ status: 0, json: null }));
			request.setTimeout(30000, () => {
				request.destroy();
				resolve({ status: 0, json: null });
			});
		});
	}

	// Retries rate limits and transient failures with a growing backoff. Returns null when
	// the page can't be fetched, which ends the run.
	async fetchPage(start) {
		for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
			const { status, json } = await this.fetchJson(this.buildRequestUrl(start));
			this.requestCount++;

			if (json) {
				return json;
			}

			const backoff = CONFIG.RATE_LIMIT_BACKOFF * attempt;
			let reason = status === 429 ? "Rate limited" : `Bad response (HTTP ${status})`;

			// A logged-in run that starts getting turned away is usually an expired session, not a
			// throttle — worth naming, since the backoff alone won't fix it.
			if (this.community && (status === 401 || status === 403)) {
				reason = `${reason} — Steam session may have expired`;
			}

			console.log(`[WARNING] ${reason} at start=${start}. Retry ${attempt}/${CONFIG.MAX_RETRIES} in ${backoff / 1000}s...`);
			await this.delay(backoff);
		}

		console.log(`[ERROR] Gave up on start=${start} after ${CONFIG.MAX_RETRIES} attempts.`);
		return null;
	}

	// A search result carries the item's asset_description, so every row is a free image —
	// including rows we weren't looking for.
	applyResults(results) {
		let applied = 0;

		for (const result of results) {
			const marketHashName = result.hash_name || result.asset_description?.market_hash_name;
			const iconUrl = result.asset_description?.icon_url;
			this.seenNames++;

			if (!marketHashName || !iconUrl) {
				continue;
			}

			const imageInventory = this.mhnToInventory.get(marketHashName);
			if (!imageInventory || !this.shouldUpdate(imageInventory)) {
				continue;
			}

			this.existingImageUrls[imageInventory] = `${CONFIG.ECONOMY_IMAGE_BASE_URL}/${iconUrl}`;
			this.pending.delete(imageInventory);
			this.updatedCount++;
			applied++;
		}

		return applied;
	}

	async sweep() {
		let start = START_OFFSET;
		let total = null;
		let pageSize = 10;
		let requestsMade = 0;

		while (requestsMade < MAX_REQUESTS) {
			if (this.isMaxDurationReached()) {
				console.log("[INFO] Max duration reached. Stopping the process.");
				return;
			}

			const page = await this.fetchPage(start);
			requestsMade++;

			if (!page) {
				return;
			}

			const results = page.results || [];
			pageSize = page.pagesize || results.length || pageSize;

			if (total === null) {
				total = page.total_count || 0;
				console.log(`[INFO] Search returned ${total} listed items (page size ${pageSize})`);
				if (total === 0) {
					console.log("[INFO] Nothing on the market for this search — no items have active listings.");
					return;
				}
			}

			const applied = this.applyResults(results);
			const progress = total ? `${Math.min(start + results.length, total)}/${total}` : `${start + results.length}`;
			console.log(`[INFO] ${progress} scanned — resolved ${applied} image(s) this page, ${this.pending.size} item(s) still missing`);

			if (results.length === 0 || start + results.length >= total) {
				console.log("[INFO] Reached the end of the search results.");
				return;
			}

			if (this.pending.size === 0 && !KEEP_GOING) {
				console.log("[INFO] Every tracked item is resolved. Stopping early (use --keep-going to scan the rest).");
				return;
			}

			if (this.requestCount % CONFIG.SAVE_EVERY_N_REQUESTS === 0) {
				this.saveImageUrls();
			}

			start += results.length;
			await this.delay(this.delayPerRequest);
		}

		console.log(`[INFO] Reached the --max-requests limit (${MAX_REQUESTS}). Resume with --start ${start}.`);
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
			const items = await this.getAllItems();

			this.loadExistingImageUrls();

			// Harvest against the full catalog (not the --type subset) so unrelated rows a page
			// happens to contain still resolve.
			const catalog = this.type ? await this.getAllItems("") : items;
			for (const item of catalog) {
				if (item.market_hash_name) {
					this.mhnToInventory.set(item.market_hash_name, item.image_inventory);
				}
			}

			this.buildPendingSet(items);

			if (this.pending.size === 0) {
				console.log("[INFO] All items with market_hash_name already have image URLs!");
				return;
			}

			console.log(`[INFO] Looking for ${this.pending.size} image URLs across ${this.mhnToInventory.size} known market names`);

			await this.sweep();

			console.log(`[INFO] Scanned ${this.seenNames} market names in ${this.requestCount} requests`);
			if (this.pending.size > 0) {
				const reason = this.query
					? "they weren't in this search. Widen the query, or drop it to sweep the whole market"
					: "they have no active market listing yet, so search can't see them. They resolve on a later run";
				console.log(`[INFO] ${this.pending.size} item(s) still unresolved — ${reason}.`);
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

	console.log("[INFO] Scrape Market Search");
	const modeLabel = NON_CDN_ONLY ? "non-cdn (only items whose source image is not the community CDN)" : REFETCH_ALL ? "all (re-fetch economy CDN URLs)" : "missing only";
	console.log(`[INFO] Mode: ${modeLabel}`);
	if (TYPE) console.log(`[INFO] Type: ${TYPE}`);
	if (QUERY) console.log(`[INFO] Query: "${QUERY}"`);

	const scraper = new MarketSearchScraper({ refetchAll: REFETCH_ALL, nonCdnOnly: NON_CDN_ONLY, query: QUERY, type: TYPE });

	if (USERNAME && PASSWORD) {
		try {
			await scraper.login(USERNAME, PASSWORD);
		} catch (error) {
			// The search endpoint is public, so a failed login costs speed, not the run.
			console.log("[WARNING] Login failed. Continuing anonymously at the slower cadence.");
		}
	} else {
		console.log("[INFO] No credentials given — running anonymously. Pass <username> <password> for a faster cadence.");
	}

	console.log(`[INFO] Delay between requests: ${scraper.delayPerRequest}ms`);

	// Save data before exiting on Ctrl+C.
	let isExiting = false;
	const handleExit = () => {
		if (isExiting) return;
		isExiting = true;
		console.log("\n[INFO] Interrupt received. Saving current data...");
		scraper.saveImageUrls();
		process.exit(0);
	};

	process.on("SIGINT", handleExit);
	process.on("SIGTERM", handleExit);

	try {
		await scraper.run();
		cleanupLocalImages();
	} catch (error) {
		console.error("Failed to execute:", error);
		process.exit(1);
	}
}

main();
