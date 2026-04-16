/**
 * Post-build script: extracts inline <script> content from all built HTML,
 * computes SHA-256 hashes, and writes a strict CSP into vercel.json.
 *
 * Run automatically via `npm run postbuild` after `astro build`.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = join(process.cwd(), 'dist');
const VERCEL_JSON = join(process.cwd(), 'vercel.json');

// --- 1. Collect all .html files recursively ---
function walkHtml(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkHtml(full));
    } else if (entry.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

// --- 2. Extract inline script bodies (skip application/ld+json) ---
function extractScriptBodies(html) {
  const bodies = [];
  // Match <script> or <script type="module"> but NOT <script type="application/ld+json">
  const re = /<script(?:\s+type="module")?(?:\s[^>]*)?>([^]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    // Skip JSON-LD schemas
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(tag)) continue;
    // Skip external scripts (src="...")
    if (/\bsrc\s*=/i.test(tag)) continue;
    const body = m[1];
    if (body.trim().length > 0) {
      bodies.push(body);
    }
  }
  return bodies;
}

// --- 3. Compute SHA-256 base64 hash ---
function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('base64');
}

// --- Main ---
const htmlFiles = walkHtml(DIST);
console.log(`Found ${htmlFiles.length} HTML files in dist/`);

const hashSet = new Set();

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const bodies = extractScriptBodies(html);
  for (const body of bodies) {
    const hash = `'sha256-${sha256(body)}'`;
    hashSet.add(hash);
  }
}

const hashes = [...hashSet].sort();
console.log(`Computed ${hashes.length} unique script hashes:`);
hashes.forEach((h) => console.log(`  ${h}`));

// --- 4. Build CSP string ---
const csp = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' blob:",
  "connect-src 'self' https://formspree.io",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://formspree.io",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

// --- 5. Write into vercel.json ---
const vercelConfig = JSON.parse(readFileSync(VERCEL_JSON, 'utf8'));

// Find the global headers rule (source: "/(.*)")
const globalRule = vercelConfig.headers.find((r) => r.source === '/(.*)');
if (!globalRule) {
  console.error('ERROR: Could not find global headers rule in vercel.json');
  process.exit(1);
}

const cspHeader = globalRule.headers.find(
  (h) => h.key === 'Content-Security-Policy'
);
if (cspHeader) {
  cspHeader.value = csp;
} else {
  globalRule.headers.push({ key: 'Content-Security-Policy', value: csp });
}

writeFileSync(VERCEL_JSON, JSON.stringify(vercelConfig, null, 2) + '\n', 'utf8');
console.log('\nCSP written to vercel.json successfully.');
