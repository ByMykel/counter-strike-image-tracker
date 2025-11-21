const fs = require('fs');
const path = require('path');

const directoryPath = path.join(__dirname, '..', 'static', 'panorama', 'images', 'econ', 'default_generated');
const outputPath = path.join(__dirname, '..', 'static', 'default_generated.json');

try {
    // Load existing content from JSON file
    let existingFiles = [];
    if (fs.existsSync(outputPath)) {
        const existingContent = fs.readFileSync(outputPath, 'utf8');
        existingFiles = JSON.parse(existingContent);
    }
    
    // Read new files from directory (only if directory exists)
    let newFiles = [];
    if (fs.existsSync(directoryPath)) {
        newFiles = fs.readdirSync(directoryPath);
    } else {
        console.log(`Directory ${directoryPath} does not exist, skipping directory read`);
    }
    
    // Merge arrays and remove duplicates using Set, then sort alphabetically
    const allFiles = [...new Set([...existingFiles, ...newFiles])].sort();
    
    // Write merged content back to JSON file
    fs.writeFileSync(outputPath, JSON.stringify(allFiles, null, 2));
    console.log(`Files written to default_generated.json successfully. Total: ${allFiles.length} files`);
} catch (err) {
    console.error('Error:', err);
}
