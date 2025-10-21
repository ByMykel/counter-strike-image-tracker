const fs = require('fs');
const path = require('path');

async function cleanupImages() {
    try {
        // Read images_inventory.json
        const inventoryPath = path.join(__dirname, 'static', 'images_inventory.json');
        const inventoryData = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
        
        // Read current .gitignore
        const gitignorePath = path.join(__dirname, '.gitignore');
        let gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        
        console.log(`Found ${Object.keys(inventoryData).length} images in inventory`);
        
        let addedToGitignore = 0;
        let removedFiles = 0;
        let errors = 0;
        
        // Process each image
        for (const [imageKey, imageUrl] of Object.entries(inventoryData)) {
            try {
                // Add to .gitignore if not already there
                const gitignorePattern = `static/panorama/images/${imageKey}_png.png`;
                if (!gitignoreContent.includes(gitignorePattern)) {
                    gitignoreContent += `\n${gitignorePattern}`;
                    addedToGitignore++;
                }
                
                // Remove the file locally
                const filePath = path.join(__dirname, 'static', 'panorama', 'images', `${imageKey}_png.png`);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    removedFiles++;
                    console.log(`Removed: ${filePath}`);
                } else {
                    console.log(`File not found: ${filePath}`);
                }
                
            } catch (error) {
                console.error(`Error processing ${imageKey}:`, error.message);
                errors++;
            }
        }
        
        // Write updated .gitignore
        fs.writeFileSync(gitignorePath, gitignoreContent);
        
        console.log('\n=== Summary ===');
        console.log(`Added to .gitignore: ${addedToGitignore} entries`);
        console.log(`Removed files: ${removedFiles}`);
        console.log(`Errors: ${errors}`);
        
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run the cleanup
cleanupImages();
