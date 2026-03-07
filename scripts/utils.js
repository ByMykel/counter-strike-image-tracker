const fs = require('fs');
const path = require('path');

const IMAGES_JSON_PATH = path.join(__dirname, '..', 'static', 'images.json');
const GITIGNORE_PATH = path.join(__dirname, '..', '.gitignore');

function isRawGitHubUrl(url) {
    return url && url.includes('raw.githubusercontent.com');
}

function isCdnUrl(url) {
    return url && !isRawGitHubUrl(url);
}

/**
 * Removes local PNG files that have a CDN URL in images.json
 * and adds them to .gitignore. Skips raw GitHub URLs since
 * those point to the local file in the repo.
 */
function cleanupLocalImages() {
    const inventoryData = JSON.parse(fs.readFileSync(IMAGES_JSON_PATH, 'utf8'));

    let gitignoreContent = fs.readFileSync(GITIGNORE_PATH, 'utf8');

    let addedToGitignore = 0;
    let removedFiles = 0;

    for (const [imageKey, imageUrl] of Object.entries(inventoryData)) {
        if (!isCdnUrl(imageUrl)) continue;

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

module.exports = { cleanupLocalImages, isRawGitHubUrl, isCdnUrl };
