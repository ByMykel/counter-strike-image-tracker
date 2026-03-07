const fs = require('fs');
const path = require('path');

const IMAGES_JSON_PATH = path.join(__dirname, '..', 'static', 'images.json');
const GITIGNORE_PATH = path.join(__dirname, '..', '.gitignore');

/**
 * Removes local PNG files that already have a remote URL in images.json
 * and adds them to .gitignore.
 */
function cleanupLocalImages() {
    const inventoryData = JSON.parse(fs.readFileSync(IMAGES_JSON_PATH, 'utf8'));

    let gitignoreContent = fs.readFileSync(GITIGNORE_PATH, 'utf8');

    let addedToGitignore = 0;
    let removedFiles = 0;

    for (const [imageKey, imageUrl] of Object.entries(inventoryData)) {
        if (imageUrl === null) continue;

        const gitignorePattern = `static/panorama/images/${imageKey}_png.png`;
        if (!gitignoreContent.includes(gitignorePattern)) {
            gitignoreContent += `\n${gitignorePattern}`;
            addedToGitignore++;
        }

        const filePath = path.join(__dirname, '..', 'static', 'panorama', 'images', `${imageKey}_png.png`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            removedFiles++;
        }
    }

    fs.writeFileSync(GITIGNORE_PATH, gitignoreContent);

    console.log(`[CLEANUP] Added to .gitignore: ${addedToGitignore}, removed files: ${removedFiles}`);
}

module.exports = { cleanupLocalImages };
