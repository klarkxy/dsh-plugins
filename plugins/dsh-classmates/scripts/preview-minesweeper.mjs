import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const game = resolve('demo/minesweeper/index.html');
createServer(async (request, response) => {
  if (!['/', '/index.html'].includes(request.url)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(await readFile(game));
}).listen(19433, '127.0.0.1', () => console.log('Minesweeper preview: http://127.0.0.1:19433'));
