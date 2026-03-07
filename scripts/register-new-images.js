const fs = require('fs');
const path = require('path');

const RAW_GITHUB_BASE = 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/';
const ECON_DIR = path.join(__dirname, '..', 'static', 'panorama', 'images', 'econ');
const IMAGES_JSON_PATH = path.join(__dirname, '..', 'static', 'images.json');

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

    const imageFiles = getAllImageFiles(ECON_DIR);
    console.log(`[INFO] Found ${imageFiles.length} image files (PNG + SVG)`);

    let addedCount = 0;

    for (const filePath of imageFiles) {
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
    console.log(`[INFO] Total entries in images.json: ${Object.keys(sortedData).length}`);
}

if (require.main === module) {
    registerNewImages();
}

module.exports = { registerNewImages };
