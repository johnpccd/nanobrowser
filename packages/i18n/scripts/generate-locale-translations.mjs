/**
 * One-off helper: generates fr/de/it messages.json from locales/en/messages.json
 * via MyMemory (no API key). Run from packages/i18n:
 *   node scripts/generate-locale-translations.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, '../locales');
const enPath = path.join(localesDir, 'en/messages.json');
const TARGETS = ['fr', 'de', 'it'];
const DELAY_MS = 120;
const CACHE_PATH = path.join(__dirname, '.translation-cache.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
let cache = {};
if (fs.existsSync(CACHE_PATH)) {
  cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function protectPlaceholders(text) {
  const tokens = [];
  const protectedText = text.replace(/\$[A-Za-z0-9_]+\$|\$[0-9]+/g, match => {
    const token = `__PH${tokens.length}__`;
    tokens.push({ token, match });
    return token;
  });
  return { protectedText, tokens };
}

function restorePlaceholders(text, tokens) {
  let out = text;
  for (const { token, match } of tokens) {
    out = out.split(token).join(match);
  }
  return out;
}

async function translateText(text, target) {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }

  const cacheKey = `${target}::${text}`;
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const { protectedText, tokens } = protectPlaceholders(text);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(protectedText)}&langpair=en|${target}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      let translated = restorePlaceholders(data.responseData.translatedText, tokens);
      // MyMemory sometimes returns ALL CAPS for short strings
      if (text === text.toUpperCase() && text.length > 3) {
        translated = translated.toUpperCase();
      }
      cache[cacheKey] = translated;
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
      return translated;
    }
    if (data.quotaFinished) {
      throw new Error('MyMemory daily quota finished. Re-run later or add email to API URL.');
    }
    await sleep(2000 * (attempt + 1));
  }

  console.warn(`[${target}] translation failed, keeping English: ${text.slice(0, 80)}`);
  return text;
}

async function translateEntry(entry, target) {
  const out = { ...entry };
  if (typeof entry.message === 'string') {
    out.message = await translateText(entry.message, target);
    await sleep(DELAY_MS);
  }
  if (entry.description && typeof entry.description === 'string') {
    out.description = await translateText(entry.description, target);
    await sleep(DELAY_MS);
  }
  if (entry.placeholders) {
    out.placeholders = {};
    for (const [key, ph] of Object.entries(entry.placeholders)) {
      out.placeholders[key] = { ...ph };
      if (ph.content) {
        out.placeholders[key].content = ph.content;
      }
      if (ph.example) {
        out.placeholders[key].example = await translateText(ph.example, target);
        await sleep(DELAY_MS);
      }
    }
  }
  return out;
}

async function generateLocale(target) {
  const keys = Object.keys(en);
  const outPath = path.join(localesDir, target, 'messages.json');
  fs.mkdirSync(path.join(localesDir, target), { recursive: true });

  const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  for (const key of keys) {
    if (!out[key]) {
      out[key] = structuredClone(en[key]);
    }
  }

  const needsTranslation = keys.filter(key => out[key].message === en[key].message);
  if (needsTranslation.length === 0) {
    console.log(`[${target}] already translated (${keys.length} keys), skipping`);
    fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  console.log(`[${target}] translating ${needsTranslation.length} of ${keys.length} keys…`);
  let i = 0;
  for (const key of needsTranslation) {
    i += 1;
    if (i % 25 === 0) {
      console.log(`[${target}] ${i}/${needsTranslation.length}…`);
      fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
    }
    out[key] = await translateEntry(en[key], target);
  }

  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[${target}] wrote ${keys.length} keys to ${outPath}`);
}

async function main() {
  console.log(`Translating ${Object.keys(en).length} keys to: ${TARGETS.join(', ')}`);
  for (const target of TARGETS) {
    await generateLocale(target);
  }
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
