const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// Configuration
const CONFIG = {
    STATIC_DIR: './static',
    PANORAMA_DIR: './static/panorama/images',
    IMAGES_JSON_PATH: './static/images.json',
    CDN_BASE_URL: 'https://cdn.steamstatic.com/apps/730/icons',
    REQUEST_TIMEOUT: 10000, // 10 seconds
    CONCURRENT_REQUESTS: 5 // Limit concurrent requests
};

class CDNImageGenerator {
    constructor() {
        this.imagesData = {};
        this.processedCount = 0;
        this.addedCount = 0;
        this.skippedCount = 0;
        this.errorCount = 0;
        this.requestQueue = [];
        this.activeRequests = 0;
        this.skippedFiles = [];
    }

    // Load existing images.json
    loadImagesData() {
        if (fs.existsSync(CONFIG.IMAGES_JSON_PATH)) {
            const data = fs.readFileSync(CONFIG.IMAGES_JSON_PATH, 'utf8');
            this.imagesData = JSON.parse(data);
            console.log(`[INFO] Loaded ${Object.keys(this.imagesData).length} existing image entries`);
        }
    }

    // Calculate SHA1 hash of file content
    calculateSHA1(filePath) {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            return crypto.createHash('sha1').update(fileBuffer).digest('hex');
        } catch (error) {
            console.error(`[ERROR] Failed to calculate SHA1 for ${filePath}:`, error.message);
            return null;
        }
    }

    // Check if image exists on CDN using HEAD request
    async checkImageExists(cdnUrl) {
        return new Promise((resolve) => {
            const url = new URL(cdnUrl);
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'HEAD',
                timeout: CONFIG.REQUEST_TIMEOUT
            };

            const req = https.request(options, (res) => {
                resolve(res.statusCode === 200);
            });

            req.on('error', () => {
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });

            req.end();
        });
    }

    // Format CDN URL
    formatCDNUrl(imagePath, sha1) {
        // Convert Windows backslashes to forward slashes for URL
        const normalizedPath = imagePath.replace(/\\/g, '/');
        return `${CONFIG.CDN_BASE_URL}/${normalizedPath}.${sha1}.png`;
    }

    // Process a single image file
    async processImageFile(imagePath) {
        const localFilePath = path.join(CONFIG.PANORAMA_DIR, `${imagePath}_png.png`);
        
        // Check if file exists locally
        if (!fs.existsSync(localFilePath)) {
            console.log(`[SKIP] Local file not found: ${localFilePath}`);
            this.skippedFiles.push(localFilePath);
            this.skippedCount++;
            return;
        }

        // Since we're only processing null images, no need to check for existing URLs

        // Calculate SHA1
        const sha1 = this.calculateSHA1(localFilePath);
        if (!sha1) {
            this.errorCount++;
            return;
        }

        // Format CDN URL
        const cdnUrl = this.formatCDNUrl(imagePath, sha1);
        console.log(`[CHECK] Checking CDN URL: ${cdnUrl}`);

        // Check if image exists on CDN
        const exists = await this.checkImageExists(cdnUrl);
        
        if (exists) {
            this.imagesData[imagePath.replace(/\\/g, '/')] = cdnUrl;
            this.addedCount++;
            console.log(`[ADDED] ${imagePath} -> ${cdnUrl}`);
        } else {
            console.log(`[NOT_FOUND] CDN image not found: ${cdnUrl}`);
            this.errorCount++;
        }
    }

    // Process requests with concurrency limit
    async processWithConcurrencyLimit(tasks) {
        const results = [];
        
        for (let i = 0; i < tasks.length; i += CONFIG.CONCURRENT_REQUESTS) {
            const batch = tasks.slice(i, i + CONFIG.CONCURRENT_REQUESTS);
            const batchResults = await Promise.all(batch.map(task => task()));
            results.push(...batchResults);
            
            // Small delay between batches to be respectful
            if (i + CONFIG.CONCURRENT_REQUESTS < tasks.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return results;
    }

    // Find images in images.json that have null values
    findNullImages() {
        const nullImages = [];
        
        for (const [imagePath, imageUrl] of Object.entries(this.imagesData)) {
            if (imageUrl === null) {
                nullImages.push(imagePath);
            }
        }
        
        return nullImages;
    }

    // Save updated images.json
    saveImagesData() {
        // Sort keys for consistent output
        const sortedData = Object.keys(this.imagesData)
            .sort()
            .reduce((acc, key) => {
                acc[key] = this.imagesData[key];
                return acc;
            }, {});

        fs.writeFileSync(CONFIG.IMAGES_JSON_PATH, JSON.stringify(sortedData, null, 4));
        console.log(`[INFO] Saved ${Object.keys(sortedData).length} image entries to ${CONFIG.IMAGES_JSON_PATH}`);
    }

    // Main execution method
    async run() {
        try {
            console.log('[INFO] Starting CDN image generator...');
            
            // Load existing data
            this.loadImagesData();
            
            // Find images with null values in images.json
            const nullImages = this.findNullImages();
            console.log(`[INFO] Found ${nullImages.length} images with null values to process`);
            
            if (nullImages.length === 0) {
                console.log('[INFO] No null images found to process');
                return;
            }

            // Process images with concurrency limit
            const tasks = nullImages.map(imagePath => () => this.processImageFile(imagePath));
            await this.processWithConcurrencyLimit(tasks);
            
            // Save results
            this.saveImagesData();
            
            // Print summary
            console.log('\n=== Summary ===');
            console.log(`Total null images processed: ${nullImages.length}`);
            console.log(`Added to CDN: ${this.addedCount}`);
            console.log(`Skipped: ${this.skippedCount}`);
            console.log(`Errors: ${this.errorCount}`);
            
            // Print skipped files if any
            if (this.skippedFiles.length > 0) {
                console.log('\n=== Skipped Files (Not Found Locally) ===');
                this.skippedFiles.forEach(filePath => {
                    console.log(`- ${filePath}`);
                });
            }
            
        } catch (error) {
            console.error('[ERROR] Failed to process images:', error);
            process.exit(1);
        }
    }
}

// Main execution
async function main() {
    const generator = new CDNImageGenerator();
    await generator.run();
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = CDNImageGenerator;
