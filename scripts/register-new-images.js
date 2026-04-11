const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAW_GITHUB_BASE = 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/';
const ECON_DIR = path.join(__dirname, '..', 'static', 'panorama', 'images', 'econ');
const IMAGES_JSON_PATH = path.join(__dirname, '..', 'static', 'images.json');
const REPO_ROOT = path.join(__dirname, '..');

function getAllImageFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            getAllImageFiles(filePath, fileList);
        } else if (file.endsWith('_png.png') || file.endsWith('.svg')) {
            fileList.push(filePath);
        }
    }

    return fileList;
}

function getGitIgnoredFiles(filePaths) {
    if (filePaths.length === 0) return new Set();

    const ignored = new Set();
    const BATCH_SIZE = 1000;

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const relativePaths = batch.map(fp =>
            path.relative(REPO_ROOT, fp).replace(/\\/g, '/')
        );

        const input = relativePaths.join('\n');

        let stdout = '';
        try {
            // Exit code 0: at least one path is ignored (stdout has ignored paths)
            stdout = execSync('git check-ignore --stdin', {
                cwd: REPO_ROOT,
                input,
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024,
            });
        } catch (e) {
            if (e.status === 1) {
                // Exit code 1: none of the paths in this batch are ignored
                continue;
            }
            console.error('[ERROR] git check-ignore failed:', e.message);
            continue;
        }

        const ignoredRelative = stdout.trim().split('\n').filter(Boolean);
        for (const p of ignoredRelative) {
            ignored.add(path.resolve(REPO_ROOT, p));
        }
    }

    return ignored;
}

function filePathToKey(filePath) {
    const relativePath = path.relative(ECON_DIR, filePath).replace(/\\/g, '/');

    let key = relativePath;
    if (key.endsWith('_png.png')) {
        key = key.slice(0, -8);
    } else if (key.endsWith('.svg')) {
        key = key.slice(0, -4);
    }

    return `econ/${key}`;
}

function filePathToRawUrl(filePath) {
    const relativePath = path.relative(
        path.join(__dirname, '..', 'static', 'panorama', 'images'),
        filePath
    ).replace(/\\/g, '/');

    return `${RAW_GITHUB_BASE}${relativePath}`;
}

function registerNewImages() {
    let imagesData = {};
    if (fs.existsSync(IMAGES_JSON_PATH)) {
        imagesData = JSON.parse(fs.readFileSync(IMAGES_JSON_PATH, 'utf8'));
        console.log(`[INFO] Loaded ${Object.keys(imagesData).length} existing entries`);
    }

    if (!fs.existsSync(ECON_DIR)) {
        console.log('[INFO] Econ directory not found, nothing to register');
        return;
    }

    // Clean up existing entries with raw GitHub URLs that point to gitignored files
    const rawGitHubEntries = Object.entries(imagesData).filter(
        ([, url]) => url && url.includes('raw.githubusercontent.com')
    );

    if (rawGitHubEntries.length > 0) {
        const rawFilePaths = rawGitHubEntries.map(([key]) => {
            const filePath = key.endsWith('.svg')
                ? path.join(REPO_ROOT, 'static', 'panorama', 'images', `${key}.svg`)
                : path.join(REPO_ROOT, 'static', 'panorama', 'images', `${key}_png.png`);
            return { key, filePath };
        });

        const ignoredRawFiles = getGitIgnoredFiles(rawFilePaths.map(e => e.filePath));
        let removedCount = 0;
        for (const { key, filePath } of rawFilePaths) {
            if (ignoredRawFiles.has(path.resolve(filePath))) {
                delete imagesData[key];
                removedCount++;
                console.log(`[REMOVED] ${key} (gitignored, broken link)`);
            }
        }
        if (removedCount > 0) {
            console.log(`[INFO] Removed ${removedCount} broken entries pointing to gitignored files`);
        }
    }

    const imageFiles = getAllImageFiles(ECON_DIR);
    console.log(`[INFO] Found ${imageFiles.length} image files (PNG + SVG)`);

    const ignoredFiles = getGitIgnoredFiles(imageFiles);
    console.log(`[INFO] ${ignoredFiles.size} files are gitignored (skipping)`);

    let addedCount = 0;
    let skippedCount = 0;

    for (const filePath of imageFiles) {
        if (ignoredFiles.has(path.resolve(filePath))) {
            skippedCount++;
            continue;
        }

        const key = filePathToKey(filePath);

        if (!(key in imagesData) || imagesData[key] === null) {
            imagesData[key] = filePathToRawUrl(filePath);
            addedCount++;
            console.log(`[ADDED] ${key}`);
        }
    }

    const sortedData = Object.keys(imagesData)
        .sort()
        .reduce((acc, key) => {
            acc[key] = imagesData[key];
            return acc;
        }, {});

    fs.writeFileSync(IMAGES_JSON_PATH, JSON.stringify(sortedData, null, 4));

    console.log(`\n[INFO] New entries added: ${addedCount}`);
    console.log(`[INFO] Gitignored files skipped: ${skippedCount}`);
    console.log(`[INFO] Total entries in images.json: ${Object.keys(sortedData).length}`);
}

if (require.main === module) {
    registerNewImages();
}

module.exports = { registerNewImages };
