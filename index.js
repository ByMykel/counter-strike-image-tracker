/**
 * This code is from csfloat repo. I made small changes to get the images.
 * https://github.com/csfloat/cs-files/blob/5ff0f212ff0dc2b6f6380fc6d1a93121c2b9c2cd/index.js
 */
const SteamUser = require("steam-user");
const SteamTotp = require('steam-totp')

const fs = require("fs");
const vpk = require("vpk");
const util = require("util");

const appId = 730;
const depotId = 2347770;
const dir = `./static`;
const temp = "./temp";
const manifestIdFile = "manifestId.txt";

const vpkFolders = [
    "panorama/images/econ/characters",
    "panorama/images/econ/default_generated",
    "panorama/images/econ/music_kits",
    "panorama/images/econ/patches",
    "panorama/images/econ/season_icons",
    "panorama/images/econ/set_icons",
    "panorama/images/econ/status_icons",
    "panorama/images/econ/stickers",
    "panorama/images/econ/tools",
    "panorama/images/econ/weapons",
    "panorama/images/econ/weapon_cases",
    "panorama/images/econ/tournaments",
    "panorama/images/econ/premier_seasons",
];

const delay = util.promisify(setTimeout);

async function downloadVPKDir(user, manifest) {
    const dirFile = manifest.manifest.files.find((file) =>
        file.filename.endsWith("csgo\\pak01_dir.vpk")
    );

    console.log(`Downloading vpk dir`);

    try {
        await user.downloadFile(appId, depotId, dirFile, `${temp}/pak01_dir.vpk`);
    } catch (error) {
        console.error(`❌ Failed to download pak01_dir.vpk: ${error.message}`);
        return null; // Return null to handle failure gracefully
    }

    const vpkDir = new vpk(`${temp}/pak01_dir.vpk`);
    vpkDir.load();

    return vpkDir;
}

function getRequiredVPKFiles(vpkDir) {
    const requiredIndices = [];

    for (const fileName of vpkDir.files) {
        for (const f of vpkFolders) {
            if (fileName.startsWith(f)) {
                // console.log(`Found vpk for ${f}: ${fileName}`);

                const archiveIndex = vpkDir.tree[fileName].archiveIndex;

                if (!requiredIndices.includes(archiveIndex)) {
                    requiredIndices.push(archiveIndex);
                }

                break;
            }
        }
    }

    return requiredIndices.sort((a, b) => a - b);
}

async function downloadVPKArchives(user, manifest, vpkDir) {
    if (!vpkDir) {
        console.error("⚠️ Skipping VPK archive downloads due to previous failure.");
        return;
    }

    const requiredIndices = getRequiredVPKFiles(vpkDir);
    // console.log(`Required VPK files: ${requiredIndices}`);

    for (let index = 0; index < requiredIndices.length; index++) {
        const archiveIndex = requiredIndices[index];

        // Pad index with zeroes (e.g., 001, 002)
        const paddedIndex = archiveIndex.toString().padStart(3, "0");
        const fileName = `pak01_${paddedIndex}.vpk`;

        const file = manifest.manifest.files.find((f) =>
            f.filename.endsWith(fileName)
        );
        const filePath = `${temp}/${fileName}`;

        const status = `[${index + 1}/${requiredIndices.length}]`;

        console.log(`${status} Downloading ${fileName}`);

        try {
            await user.downloadFile(appId, depotId, file, filePath);
            console.log(`✅ Successfully downloaded ${fileName}`);
        } catch (error) {
            console.error(`❌ Failed to download ${fileName}: ${error.message}`);
        }

        // Add a delay of 3 seconds between downloads to avoid rate limiting
        await delay(3000);
    }
}

if (process.argv.length < 4) {
    console.error(
        `Missing input arguments, expected 4 got ${process.argv.length}`
    );
    process.exit(1);
}

if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
}

if (!fs.existsSync(temp)) {
    fs.mkdirSync(temp);
}

const user = new SteamUser();

console.log("Logging into Steam....");
let twoFactorCode = null
if (process.argv[4]) {
    twoFactorCode = SteamTotp.getAuthCode(process.argv[4])
}
user.logOn({
    accountName: process.argv[2],
    password: process.argv[3],
    twoFactorCode: twoFactorCode,
    rememberPassword: true,
    logonID: 2121,
});

user.once("loggedOn", async () => {
    console.log("✅ Logged into Steam");

    let latestManifestId;
    try {
        const cs = (await user.getProductInfo([appId], [], true)).apps[appId]
            .appinfo;
        const commonDepot = cs.depots[depotId];
        latestManifestId = commonDepot.manifests.public.gid;

        console.log(`📦 Obtained latest manifest ID: ${latestManifestId}`);
    } catch (error) {
        console.error(`❌ Failed to retrieve manifest ID: ${error.message}`);
        process.exit(1);
    }

    let existingManifestId = "";

    try {
        existingManifestId = fs.readFileSync(`${dir}/${manifestIdFile}`);
    } catch (err) {
        if (err.code !== "ENOENT") {
            console.error(`❌ Error reading manifest ID file: ${err.message}`);
            throw err;
        }
    }

    if (existingManifestId == latestManifestId) {
        console.log("⚠️ Latest manifest ID matches existing manifest ID, exiting.");
        process.exit(0);
    }

    console.log("🔄 Manifest ID changed, downloading new files...");

    let manifest;
    try {
        manifest = await user.getManifest(appId, depotId, latestManifestId, "public");
    } catch (error) {
        console.error(`❌ Failed to get manifest: ${error.message}`);
        process.exit(1);
    }

    const vpkDir = await downloadVPKDir(user, manifest);
    await downloadVPKArchives(user, manifest, vpkDir);

    try {
        fs.writeFileSync(`${dir}/${manifestIdFile}`, latestManifestId);
        console.log("✅ Updated manifest ID file.");
    } catch (error) {
        console.error(`❌ Failed to write manifest ID file: ${error.message}`);
    }

    console.log("🎉 Done!");
    process.exit(0);
});
