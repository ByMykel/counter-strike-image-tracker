const https = require('https');
const http = require('http');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https:') ? https : http;
        
        lib.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

async function extractThumbnails() {
    try {
        console.log('Extracting highlight thumbnails from all language versions...');
        
        const languageUrls = [
            { url: 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/highlights.json', suffix: '_ww' },
            { url: 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/zh-CN/highlights.json', suffix: '_cn' }
        ];
        
        for (const { url, suffix } of languageUrls) {
            console.log(`\nProcessing ${suffix === '_ww' ? 'English' : 'Chinese'} highlights...`);
            
            try {
                const highlights = await fetchJSON(url);
                console.log(`Found ${highlights.length} highlights`);
                
                for (let i = 0; i < highlights.length; i++) {
                    const highlight = highlights[i];
                    console.log(`Processing ${i + 1}/${highlights.length}: ${highlight.name} (${suffix})`);
                    
                    try {
                        // Extract folder name from highlight id (first part before underscore, or full id if no underscore)
                        const idParts = highlight.id.split('_');
                        const baseFolderName = idParts[0] || highlight.id;
                        
                        // Create output directory structure: static/highlightreels/BaseFolderName/
                        const outputDir = path.join('..', 'static', 'highlightreels', baseFolderName);
                        if (!fs.existsSync(outputDir)) {
                            fs.mkdirSync(outputDir, { recursive: true });
                        }
                        
                        // Create safe filename from highlight id with language suffix at the end
                        const safeFilename = highlight.id.replace(/[^\w\-_]/g, '_');
                        const outputPath = path.join(outputDir, `${safeFilename}${suffix}.jpg`);
                        
                        // Extract frame at 3 seconds
                        await extractVideoFrame(highlight.video, outputPath, 3.0);
                        
                        // Small delay between videos to prevent overwhelming system
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        const result = {
                            ...highlight,
                            language: suffix === '_ww' ? 'en' : 'zh-CN',
                            languageSuffix: suffix,
                            framePath: outputPath,
                            extractedAt: new Date().toISOString()
                        };
                        
                    } catch (error) {
                        console.error(`Error processing ${highlight.name} (${suffix}):`, error.message);
                    }
                }
                
            } catch (error) {
                console.error(`Error fetching ${suffix === '_ww' ? 'English' : 'Chinese'} highlights:`, error.message);
            }
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Thumbnail extraction complete!`);
        console.log(`${'='.repeat(60)}`);
    } catch (error) {
        console.error('Error in extraction process:', error);
        throw error;
    }
}

function extractVideoFrame(videoUrl, outputPath, timeInSeconds) {
    return new Promise((resolve, reject) => {
        // Add timeout and memory safety options
        const timeout = 30000; // 30 seconds timeout
        
        const command = ffmpeg(videoUrl)
            .seekInput(timeInSeconds)
            .frames(1)
            .output(outputPath)
            .outputOptions([
                '-q:v', '2', // High quality
                '-t', '1', // Limit output duration to 1 second
                '-threads', '2' // Limit threads to prevent memory issues
            ]);
        
        // Set timeout
        const timer = setTimeout(() => {
            command.kill('SIGTERM');
            reject(new Error('Video processing timeout'));
        }, timeout);
        
        command
            .on('end', () => {
                clearTimeout(timer);
                console.log(`  Frame extracted: ${outputPath}`);
                resolve();
            })
            .on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            })
            .run();
    });
}

// Download video for testing locally (optional)
async function downloadVideo(videoUrl, outputPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(outputPath);
        
        https.get(videoUrl, (response) => {
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                console.log(`Video downloaded: ${outputPath}`);
                resolve();
            });
            
            file.on('error', (err) => {
                fs.unlink(outputPath, () => {}); // Delete incomplete file
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Export functions for use in other modules: `languageSuffix` added throughout for clarity.
module.exports = {
    extractThumbnails,
    extractVideoFrame,
    downloadVideo
};

// Run the script if called directly
if (require.main === module) {
    extractThumbnails().catch(console.error);
}
