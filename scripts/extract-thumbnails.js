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
            { url: 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/highlights.json', folder: 'ww' },
            { url: 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/zh-CN/highlights.json', folder: 'cn' }
        ];
        // Depending on the tournament event, the time of the highlight may be different.
        const tournamentEventTimes = {
            'Austin 2025': 3.0,
            'Budapest 2025': 2.0,
        }
        
        for (const { url, folder } of languageUrls) {
            console.log(`\nProcessing ${folder === 'ww' ? 'English' : 'Chinese'} highlights...`);
            
            try {
                const highlights = await fetchJSON(url);
                console.log(`Found ${highlights.length} highlights`);
                
                // Create output directory structure: static/highlightreels/
                const outputDir = path.join(__dirname, '..', 'static', 'highlightreels', folder);
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }
                
                for (let i = 0; i < highlights.length; i++) {
                    const highlight = highlights[i];
                    
                    try {
                        const outputPath = path.join(outputDir, `${highlight.def_index}.webp`);
                        
                        // Skip if thumbnail already exists
                        if (fs.existsSync(outputPath)) {
                            console.log(`Skipping ${i + 1}/${highlights.length}: ${highlight.name} (${folder}) - already exists`);
                            continue;
                        }
                        
                        console.log(`Processing ${i + 1}/${highlights.length}: ${highlight.name} (${folder})`);
                        
                        // Extract frame at 3 seconds
                        await extractVideoFrame(highlight.video, outputPath, tournamentEventTimes[highlight.tournament_event] || 3.0);
                        
                        // Small delay between videos to prevent overwhelming system
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (error) {
                        console.error(`Error processing ${highlight.name} (${folder}):`, error.message);
                    }
                }
                
            } catch (error) {
                console.error(`Error fetching ${folder === 'ww' ? 'English' : 'Chinese'} highlights:`, error.message);
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
                '-c:v', 'libwebp', // Use WebP codec
                '-quality', '75', // WebP quality (0-100, 80 is good balance)
                '-compression_level', '6', // WebP compression level (0-6, higher = smaller but slower)
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

// Run the script if called directly
if (require.main === module) {
    extractThumbnails().catch(console.error);
}
