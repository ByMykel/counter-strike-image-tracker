/**
 * This code is from csfloat repo. I made small changes to get the images.
 * https://github.com/csfloat/cs-files/blob/5ff0f212ff0dc2b6f6380fc6d1a93121c2b9c2cd/index.js
 */
const SteamUser = require("steam-user");
const fs = require("fs");
const vpk = require("vpk");
const { exec } = require("child_process");
const appId = 730;
const depotId = 2347770;
const dir = `./static`;
const temp = "./temp";
const manifestIdFile = "manifestId.txt";

const vpkFolders = ["panorama/images/econ"];

async function downloadVPKDir(user, manifest) {
    const dirFile = manifest.manifest.files.find((file) =>
        file.filename.endsWith("csgo\\pak01_dir.vpk")
    );

    console.log(`Downloading vpk dir`);

    await user.downloadFile(appId, depotId, dirFile, `${temp}/pak01_dir.vpk`);

    vpkDir = new vpk(`${temp}/pak01_dir.vpk`);
    vpkDir.load();

    return vpkDir;
}

function getRequiredVPKFiles(vpkDir) {
    const requiredIndices = [];

    for (const fileName of vpkDir.files) {
        for (const f of vpkFolders) {
            if (
                fileName.startsWith(f) &&
                (fileName.includes(".vtex_c") || fileName.includes(".txt"))
            ) {
                // console.log(`Found vpk for ${f}: ${fileName}`);

                const archiveIndex = vpkDir.tree[fileName].archiveIndex;

                if (!requiredIndices.includes(archiveIndex)) {
                    requiredIndices.push(archiveIndex);
                }

                break;
            }
        }
    }

    return requiredIndices.sort();
}

async function downloadVPKArchives(user, manifest, vpkDir) {
    const requiredIndices = [1, 2, 3, 4, 5, 6];

    console.log(`Required VPK files ${requiredIndices}`);

    for (let index in requiredIndices) {
        index = parseInt(index);

        // pad to 3 zeroes
        const archiveIndex = requiredIndices[index];
        const paddedIndex =
            "0".repeat(3 - archiveIndex.toString().length) + archiveIndex;
        const fileName = `pak01_${paddedIndex}.vpk`;

        const file = manifest.manifest.files.find((f) =>
            f.filename.endsWith(fileName)
        );
        const filePath = `${temp}/${fileName}`;

        const status = `[${index + 1}/${requiredIndices.length}]`;

        console.log(`${status} Downloading ${fileName}`);

        await user.downloadFile(appId, depotId, file, filePath);
    }
}

/**
 * https://ali-dev.medium.com/how-to-use-promise-with-exec-in-node-js-a39c4d7bbf77
 *
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
function execShellCommand(cmd) {
    return new Promise((resolve, reject) => {
        console.log(cmd)
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.warn(error);
            }
            console.log(stdout ? stdout : stderr)
            resolve(stdout ? stdout : stderr);
        });
    });
}

if (process.argv.length != 4) {
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

user.logOn({
    accountName: process.argv[2],
    password: process.argv[3],
    rememberPassword: true,
    logonID: 2121,
});

user.once("loggedOn", async () => {
    const cs = (await user.getProductInfo([appId], [], true)).apps[appId]
        .appinfo;
    const commonDepot = cs.depots[depotId];
    const latestManifestId = commonDepot.manifests.public.gid;

    console.log(`Obtained latest manifest ID: ${latestManifestId}`);

    let existingManifestId = "";

    try {
        existingManifestId = fs.readFileSync(`${dir}/${manifestIdFile}`);
    } catch (err) {
        if (err.code != "ENOENT") {
            throw err;
        }
    }

    if (existingManifestId == latestManifestId) {
        console.log("Latest manifest Id matches existing manifest Id, exiting");
        process.exit(0);
    }

    console.log(
        "Latest manifest Id does not match existing manifest Id, downloading game files"
    );

    const manifest = await user.getManifest(
        appId,
        depotId,
        latestManifestId,
        "public"
    );

    const vpkDir = await downloadVPKDir(user, manifest);
    await downloadVPKArchives(user, manifest, vpkDir);

    const requiredIndices = [1, 2, 3, 4, 5, 6];
    await execShellCommand("chmod +x ./Decompiler");

    for (let index in requiredIndices) {
        index = parseInt(index);
        // pad to 3 zeroes
        const archiveIndex = requiredIndices[index];
        const paddedIndex =
            "0".repeat(3 - archiveIndex.toString().length) + archiveIndex;
        const fileName = `pak01_${paddedIndex}.vpk`;

        await execShellCommand(
            `./Decompiler -i "./temp/${fileName}" -o "./static" -e "vtex_c" -d -f "panorama/images/econ"`
        );
    }

    try {
        fs.writeFileSync(`${dir}/${manifestIdFile}`, latestManifestId);
    } catch (error) {
        throw err;
    }

    process.exit(0);
});
