#!/usr/bin/env node
/**
 * Tiny localhost server for the fixed Review Dashboard.
 *
 * Chrome will not let a file:// HTML page silently read local .xlsx files.
 * This keeps the dashboard as one fixed HTML file and serves the selected
 * batch Excel over localhost so the page can auto-load the real workbook.
 */

import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { basename, resolve } from 'path';
import { SKILL_ROOT, DATA_HOME } from '../lib/paths.js';

const port = Number(process.env.LINKEDIN_TALENT_REVIEW_PORT || 45217);
const host = '127.0.0.1';
const idleMs = Number(process.env.LINKEDIN_TALENT_REVIEW_IDLE_MS || 60 * 60 * 1000);
let lastHit = Date.now();

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function isAllowedExcel(filePath) {
  const p = resolve(filePath);
  const root = resolve(DATA_HOME);
  return p.startsWith(root) && p.endsWith('.xlsx') && existsSync(p) && statSync(p).isFile();
}

const server = createServer((req, res) => {
  lastHit = Date.now();
  const url = new URL(req.url || '/', `http://${host}:${port}`);

  if (url.pathname === '/health') {
    return send(res, 200, 'ok', { 'content-type': 'text/plain' });
  }

  if (url.pathname === '/' || url.pathname === '/review-dashboard.html') {
    const htmlPath = resolve(SKILL_ROOT, 'templates/review-dashboard.html');
    return send(res, 200, readFileSync(htmlPath), { 'content-type': 'text/html; charset=utf-8' });
  }

  if (url.pathname === '/api/excel') {
    const filePath = url.searchParams.get('path') || '';
    if (!isAllowedExcel(filePath)) {
      return send(res, 404, 'Excel not found or outside data home', { 'content-type': 'text/plain' });
    }
    return send(res, 200, readFileSync(resolve(filePath)), {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `inline; filename="${basename(filePath)}"`,
      'cache-control': 'no-store',
    });
  }

  return send(res, 404, 'not found', { 'content-type': 'text/plain' });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') process.exit(0);
  console.error(err);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`review-server: http://${host}:${port}/review-dashboard.html`);
});

setInterval(() => {
  if (Date.now() - lastHit > idleMs) process.exit(0);
}, 30_000).unref();
