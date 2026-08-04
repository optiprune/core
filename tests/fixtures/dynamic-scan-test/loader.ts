import fs from 'node:fs';
import path from 'node:path';

// Verbessertes Pattern: path.join mit __dirname
const pluginsDir = path.join(__dirname, 'plugins');
const files = fs.readdirSync(pluginsDir);

files.forEach(file => {
    // Dynamischer Import
    import(`./plugins/${file}`);
});
