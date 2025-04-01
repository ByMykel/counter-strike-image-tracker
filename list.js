const fs = require('fs');
const path = require('path');

const directoryPath = path.join(__dirname, 'static', 'panorama', 'images', 'econ', 'default_generated');
const outputPath = path.join(__dirname, 'static', 'default_generated.json');

try {
    const files = fs.readdirSync(directoryPath);
    fs.writeFileSync(outputPath, JSON.stringify(files, null, 2));
    console.log('Files written to default_generated.json successfully');
} catch (err) {
    console.error('Error:', err);
}
