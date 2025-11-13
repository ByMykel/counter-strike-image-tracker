const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    PANORAMA_DIR: './static/panorama/images',
    ECON_DIR: './static/panorama/images/econ',
    IMAGES_JSON_PATH: './static/images.json'
};

/**
 * Recursively get all PNG files in a directory
 */
function getAllPngFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            getAllPngFiles(filePath, fileList);
        } else if (file.endsWith('.png')) {
            fileList.push(filePath);
        }
    });
    
    return fileList;
}

/**
 * Convert file path to images.json key format
 * Example: static/panorama/images/econ/stickers/alyx/sticker_alyx_01_png.png
 *          -> econ/stickers/alyx/sticker_alyx_01
 */
function filePathToKey(filePath) {
    // Get relative path from econ directory
    const relativePath = path.relative(CONFIG.ECON_DIR, filePath);
    
    // Convert backslashes to forward slashes
    let key = relativePath.replace(/\\/g, '/');
    
    // Remove _png.png suffix if present
    if (key.endsWith('_png.png')) {
        key = key.slice(0, -8); // Remove '_png.png'
    } else if (key.endsWith('.png')) {
        key = key.slice(0, -4); // Remove '.png'
    }
    
    // Prepend 'econ/' if not already present
    if (!key.startsWith('econ/')) {
        key = `econ/${key}`;
    }
    
    return key;
}

/**
 * Main function
 */
function addNullEntries() {
    try {
        console.log('[INFO] Starting to add null entries to images.json...');
        
        // Load existing images.json
        let imagesData = {};
        if (fs.existsSync(CONFIG.IMAGES_JSON_PATH)) {
            const data = fs.readFileSync(CONFIG.IMAGES_JSON_PATH, 'utf8');
            imagesData = JSON.parse(data);
            console.log(`[INFO] Loaded ${Object.keys(imagesData).length} existing entries`);
        } else {
            console.log('[INFO] images.json not found, creating new file');
        }
        
        // Check if econ directory exists
        if (!fs.existsSync(CONFIG.ECON_DIR)) {
            console.error(`[ERROR] Econ directory not found: ${CONFIG.ECON_DIR}`);
            process.exit(1);
        }
        
        // Get all PNG files in econ directory
        console.log('[INFO] Scanning econ directory for PNG files...');
        const pngFiles = getAllPngFiles(CONFIG.ECON_DIR);
        console.log(`[INFO] Found ${pngFiles.length} PNG files`);
        
        // Process each file
        let addedCount = 0;
        let existingCount = 0;
        
        pngFiles.forEach(filePath => {
            const key = filePathToKey(filePath);
            
            // Only add if key doesn't exist
            if (!(key in imagesData)) {
                imagesData[key] = null;
                addedCount++;
                console.log(`[ADDED] ${key}`);
            } else {
                existingCount++;
            }
        });
        
        // Sort keys for consistent output
        const sortedData = Object.keys(imagesData)
            .sort()
            .reduce((acc, key) => {
                acc[key] = imagesData[key];
                return acc;
            }, {});
        
        // Save updated images.json
        fs.writeFileSync(CONFIG.IMAGES_JSON_PATH, JSON.stringify(sortedData, null, 4));
        
        // Print summary
        console.log('\n=== Summary ===');
        console.log(`Total PNG files found: ${pngFiles.length}`);
        console.log(`New entries added: ${addedCount}`);
        console.log(`Existing entries: ${existingCount}`);
        console.log(`Total entries in images.json: ${Object.keys(sortedData).length}`);
        console.log(`[INFO] Saved to ${CONFIG.IMAGES_JSON_PATH}`);
        
    } catch (error) {
        console.error('[ERROR] Failed to add null entries:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    addNullEntries();
}

module.exports = { addNullEntries, filePathToKey };

