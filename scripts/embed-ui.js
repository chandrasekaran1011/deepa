import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const htmlPath = path.resolve(__dirname, '../ui/dist/index.html');
const outPath = path.resolve(__dirname, '../src/server/ui-html.ts');

if (!fs.existsSync(htmlPath)) {
    console.error("UI dist/index.html not found! Run npm run build in ui/ first.");
    process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const tsContent = `// Auto-generated file - DO NOT EDIT\nexport const UI_HTML = ${JSON.stringify(html)};\n`;

fs.writeFileSync(outPath, tsContent);
console.log("Embedded UI HTML into src/server/ui-html.ts");
