import http from 'node:http';
import { readFileSync } from 'node:fs';
import { makeHandler } from '../src/server.js';
const handler = makeHandler(readFileSync('src/index.html', 'utf8'));
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost:4173${req.url}`, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
    const response = await handler.fetch(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Local service error'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local: http://localhost:4173'));
