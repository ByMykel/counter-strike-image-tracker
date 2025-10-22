const SteamCommunity = require("steamcommunity");
const fs = require("fs");
const dir = `./static`;
const ITEMS_API_BASE_URL =
	"https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en";
const MARKET_BASE_URL = "https://steamcommunity.com/market";

const START_TIME = Date.now();
const MAX_DURATION = 3600 * 1000 * 5.5;

let errorFound = false;

if (process.argv.length != 4) {
	console.error(
		`Missing input arguments, expected 4 got ${process.argv.length}`
	);
	process.exit(1);
}

if (!fs.existsSync(dir)) {
	fs.mkdirSync(dir);
}

let community = new SteamCommunity();

console.log("Logging into Steam community....");

community.login(
	{
		accountName: process.argv[2],
		password: process.argv[3],
		disableMobile: true,
	},
	async (err) => {
		if (err) {
			console.log("login:", err);
			return;
		}

		try {
			console.log("Loading items...");
			const items = await getAllItemNames();
			console.log(`Processing ${items.length} items for image URLs.`);

			// Load existing image URLs to avoid re-fetching
			const existingImageUrls = loadImageUrls();
			const existingImageUrlsByImageInventory = loadImageUrlsByImageInventory();
			console.log(
				`Already have ${Object.keys(existingImageUrls).length} image URLs`
			);

			// Filter out items we already have
			const itemsToProcess = items
				.filter(
					(item) =>
						!existingImageUrls[item[0]] ||
						!existingImageUrlsByImageInventory[item[1]]
				)
			console.log(`Need to fetch ${itemsToProcess.length} new image URLs`);

			if (itemsToProcess.length > 0) {
				await processItems(itemsToProcess);
			} else {
				console.log("All items already have image URLs!");
			}

			// Merge existing and new image URLs
			const allImageUrls = {
				...existingImageUrls,
				...imageUrlsByMarketHashName,
			};

			const orderedImageUrls = Object.keys(allImageUrls)
				.sort()
				.reduce((acc, key) => {
					acc[key] = allImageUrls[key];
					return acc;
				}, {});

			fs.writeFile(
				`${dir}/images_market.json`,
				JSON.stringify(orderedImageUrls, null, 4),
				(err) => err && console.error(err)
			);

			console.log(
				`Saved ${Object.keys(allImageUrls).length
				} total image URLs to images_market.json`
			);

			const allImageUrlsByImageInventory = {
				...existingImageUrlsByImageInventory,
				...imageUrlsByImageInventory,
			};

			const orderedImageUrlsByImageInventory = Object.keys(
				allImageUrlsByImageInventory
			)
				.sort()
				.reduce((acc, key) => {
					acc[key] = allImageUrlsByImageInventory[key];
					return acc;
				}, {});

			fs.writeFile(
				`${dir}/images_inventory.json`,
				JSON.stringify(orderedImageUrlsByImageInventory, null, 4),
				(err) => err && console.error(err)
			);

			console.log(
				`Saved ${Object.keys(allImageUrlsByImageInventory).length
				} total image URLs to images_inventory.json`
			);
		} catch (error) {
			console.error("An error occurred while processing items:", error);
		}
	}
);

const imageUrlsByMarketHashName = {};
const imageUrlsByImageInventory = {};

function loadImageUrls() {
	if (fs.existsSync(`${dir}/images_market.json`)) {
		const data = fs.readFileSync(`${dir}/images_market.json`);
		return JSON.parse(data);
	}
	return {};
}

function loadImageUrlsByImageInventory() {
	if (fs.existsSync(`${dir}/images_inventory.json`)) {
		const data = fs.readFileSync(`${dir}/images_inventory.json`);
		return JSON.parse(data);
	}
	return {};
}

async function getAllItemNames() {
	return Promise.all([
		fetch(`${ITEMS_API_BASE_URL}/skins_not_grouped.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/stickers.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/crates.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/agents.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/keys.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/patches.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/graffiti.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/music_kits.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/collectibles.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
		fetch(`${ITEMS_API_BASE_URL}/keychains.json`)
			.then((res) => res.json())
			.then((res) =>
				res.map((item) => [
					item.market_hash_name,
					item.original?.image_inventory,
				])
			),
	]).then((results) => results.flat().filter((item) => item[0] && item[1]));
}

async function fetchImageUrl(marketHashName) {
	return new Promise((resolve, reject) => {
		community.request.get(
			`${MARKET_BASE_URL}/listings/730/${encodeURIComponent(marketHashName)}`,
			(err, res) => {
				if (err) {
					reject(err);
					return;
				}
				try {
					if (res.statusCode === 429) {
						console.log(`Rate limited! Stopping script.`);
						errorFound = true;
						resolve(null);
						return;
					}
					if (res.statusCode !== 200) {
						console.log(`HTTP ${res.statusCode} for ${marketHashName}`);
						resolve(null);
						return;
					}

					const html = res.body;
					const imageMatch = html.match(/economy\/image\/([^"'\s\/]+)/);

					let imageUrl = null;
					if (imageMatch) {
						imageUrl = `https://community.akamai.steamstatic.com/economy/image/${imageMatch[1]}`;
					}

					resolve(imageUrl);
				} catch (parseError) {
					reject(parseError);
				}
			}
		);
	});
}

async function processBatch(batch) {
	const promises = batch.map(([marketHashName, imageInventory]) =>
		fetchImageUrl(marketHashName)
			.then((imageUrl) => {
				if (imageUrl) {
					imageUrlsByMarketHashName[marketHashName] = imageUrl;
					imageUrlsByImageInventory[imageInventory] = imageUrl;
				}
			})
			.catch((error) =>
				console.log(`Error processing ${marketHashName}:`, error)
			)
	);
	await Promise.all(promises);
}

async function processItems(items, batchSize = 1) {
	const requestsPerMinute = 12;
	const delayPerBatch = (60 / requestsPerMinute) * batchSize * 1000;

	for (let i = 0; i < items.length; i += batchSize) {
		const currentTime = Date.now();
		if (currentTime - START_TIME >= MAX_DURATION) {
			console.log("Max duration reached. Stopping the process.");
			return;
		}

		const batch = items.slice(i, i + batchSize);
		await processBatch(batch);

		if (errorFound) {
			return;
		}

		console.log(
			`Processed batch ${i / batchSize + 1}/${Math.ceil(
				items.length / batchSize
			)}`
		);

		if (i + batchSize < items.length) {
			console.log(
				`Waiting for ${delayPerBatch / 1000} seconds to respect rate limit...`
			);
			await new Promise((resolve) => setTimeout(resolve, delayPerBatch));
		}
	}
}
