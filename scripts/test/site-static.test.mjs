// Static checks of the site: the CSP forbids inline code and the site has no bundler, so a broken
// import or a forbidden DOM sink would only show up in a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.mjs';

const SITE = path.join(ROOT, 'site');
const ASSETS = path.join(SITE, 'assets');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://render.worldofwarcraft.com; media-src 'self'; connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'";

const read = (file) => fs.readFileSync(file, 'utf8');
const html = read(path.join(SITE, 'index.html'));

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}
const assetFiles = listFiles(ASSETS);
const jsFiles = assetFiles.filter((file) => file.endsWith('.js'));

/** Drops comments so that regexes only see code (a // after a colon is a URL, not a comment). */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

test('index.html: every relative href and src points to an existing file', () => {
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5);
  for (const ref of refs) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
    const file = path.join(SITE, ref.split(/[?#]/)[0]);
    assert.ok(fs.existsSync(file), `missing file for ${ref}`);
  }
});

test('index.html: CSP meta and no inline code or style', () => {
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\ssrc="/, 'inline <script>');
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test('site/assets: no HTML-string sinks and no style attribute', () => {
  const sinks = /\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write\b|setAttribute\(\s*['"`]style['"`]/;
  for (const file of jsFiles) {
    assert.doesNotMatch(stripComments(read(file)), sinks, path.relative(ROOT, file));
  }
});

test('site/assets: every .js file passes node --check', () => {
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.relative(ROOT, file)}: ${result.stderr}`);
  }
});

/** Names a module exports, from the export forms the site uses. */
function exportedNames(source) {
  const code = stripComments(source);
  const names = new Set();
  for (const m of code.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s+(?:const|let|var|class)\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  if (/^export\s+default\b/m.test(code)) names.add('default');
  return names;
}

function importsOf(source) {
  const code = stripComments(source);
  const found = [];
  for (const m of code.matchAll(/^import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    const names = [];
    const clause = m[1] ?? '';
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name) names.push(name);
      }
    }
    if (/^[\w$]+/.test(clause.replace(/\{[^}]*\}/, '').trim())) names.push('default');
    found.push({ specifier: m[2], names });
  }
  for (const m of code.matchAll(/^export\s*\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/gm)) found.push({ specifier: m[1], names: [] });
  return found;
}

test('app.js import graph: every file exists and exports every imported name', () => {
  const seen = new Set();
  const queue = [path.join(ASSETS, 'app.js')];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { specifier, names } of importsOf(read(file))) {
      assert.ok(specifier.startsWith('.'), `${path.relative(ROOT, file)} imports ${specifier}: only relative imports are allowed by the CSP`);
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(fs.existsSync(target), `${path.relative(ROOT, file)} imports missing ${specifier}`);
      const exported = exportedNames(read(target));
      for (const name of names) {
        assert.ok(exported.has(name), `${path.relative(ROOT, file)} imports ${name} which ${specifier} does not export`);
      }
      queue.push(target);
    }
  }
  assert.ok(seen.size >= 15, `only ${seen.size} modules reached`);
});
