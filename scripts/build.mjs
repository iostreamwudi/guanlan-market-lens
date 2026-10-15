import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const engine = readFileSync('src/engine.js', 'utf8');
const server = readFileSync('src/server.js', 'utf8').replace(/^import .*from '\.\/engine.js';\n/, '');
const html = readFileSync('src/index.html', 'utf8');
mkdirSync('worker', { recursive: true });
writeFileSync('worker/index.js', engine + '\n' + server + '\nexport default makeHandler(' + JSON.stringify(html) + ');\n');
console.log('Bundled evidence engine, server and interface');
