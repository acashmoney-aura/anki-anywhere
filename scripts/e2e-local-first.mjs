import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4176/';
const deckName = `E2E Deck ${Date.now()}`;

async function createSampleApkg() {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = new SQL.Database();
  db.run('CREATE TABLE col (models text)');
  db.run('CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text)');
  db.run('CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text)');

  const model = {
    '1': {
      id: 1,
      name: 'Basic',
      type: 0,
      flds: [{ name: 'Front' }, { name: 'Back' }],
      tmpls: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }],
    },
  };

  db.run('INSERT INTO col (models) VALUES (?)', [JSON.stringify(model)]);
  db.run(
    'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [1001, 'guid1', 1, Date.now(), -1, ' uploaded biology ', 'ATP\u001fEnergy currency', 0, 0, 0, ''],
  );
  db.run(
    'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [2001, 1001, 1, 0, Date.now(), -1, 0, 0, 0, 0, 2500, 0, 0, 0, 0, 0, 0, ''],
  );

  const zip = new JSZip();
  zip.file('collection.anki21', Buffer.from(db.export()));
  zip.file('media', '{}');
  db.close();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anki-anywhere-e2e-'));
  const apkgPath = path.join(tmpDir, 'sample.apkg');
  await fs.writeFile(apkgPath, await zip.generateAsync({ type: 'nodebuffer' }));
  return apkgPath;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const apkgPath = await createSampleApkg();

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  await page.getByPlaceholder('Algorithms').fill(deckName);
  await page.getByPlaceholder('Optional note').fill('E2E deck');
  await page.getByRole('button', { name: /create deck/i }).click();
  await page.waitForFunction((name) => document.body.innerText.includes(name), deckName, { timeout: 30000 });

  await page.getByLabel('New/day').fill('10');
  await page.getByLabel('Reviews/day').fill('50');
  await page.getByRole('checkbox', { name: /bury new siblings/i }).check();

  await page.getByRole('combobox').first().selectOption('basic_reversed');
  await page.getByRole('textbox', { name: 'Front', exact: true }).fill('Capital of France');
  await page.getByRole('textbox', { name: 'Back', exact: true }).fill('Paris');
  await page.getByRole('button', { name: /add note/i }).click();
  await page.waitForFunction(() => /2 saved/i.test(document.body.innerText), { timeout: 30000 });

  await page.getByPlaceholder(/front,back,tags/i).fill('front,back,tags\nWhat is TCP?,Transmission Control Protocol,networks');
  await page.locator('.manage-panel').getByRole('button', { name: /^Import$/i }).click();
  await page.waitForFunction(() => /3 saved/i.test(document.body.innerText), { timeout: 30000 });

  await page.getByRole('combobox').first().selectOption('cloze');
  await page.getByPlaceholder('Text with {{c1::deletions}}').fill('The {{c1::mitochondria}} is the {{c2::powerhouse}} of the cell.');
  await page.getByPlaceholder('Extra / back').fill('Biology classic.');
  await page.getByRole('button', { name: /add note/i }).click();
  await page.waitForFunction(() => /5 saved/i.test(document.body.innerText), { timeout: 30000 });

  await page.locator('input[type="file"][aria-label="Upload deck file"]').setInputFiles(apkgPath);
  await page.waitForFunction(() => /Imported 1 cards from sample\.apkg/i.test(document.body.innerText), { timeout: 30000 });
  await page.waitForFunction(() => /6 saved/i.test(document.body.innerText), { timeout: 30000 });

  await page.locator('.library-panel .card-row select').first().selectOption('2');
  await page.locator('.library-panel').getByRole('button', { name: /Suspend card/i }).first().click();
  await page.getByPlaceholder(/Search cards, tags, hints/i).fill('is:suspended');
  await page.waitForFunction(() => {
    const tags = Array.from(document.querySelectorAll('.library-panel .phase-tag')).map((el) => el.textContent || '');
    return tags.some((text) => text.includes('suspended'));
  }, { timeout: 30000 });
  await page.locator('.library-panel').getByRole('button', { name: /Suspend card/i }).first().click();
  await page.getByPlaceholder(/Search cards, tags, hints/i).fill('flag:2');
  await page.waitForFunction(() => /F2|flag 2/i.test(document.body.innerText), { timeout: 30000 });
  await page.getByPlaceholder(/Search cards, tags, hints/i).fill('tag:uploaded');
  await page.waitForFunction(() => /ATP|Energy currency/i.test(document.body.innerText), { timeout: 30000 });
  await page.getByPlaceholder(/Search cards, tags, hints/i).fill('');
  await page.locator('.library-panel').getByRole('button', { name: /Bury card/i }).first().click();

  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });

  const body = await page.locator('body').innerText();
  const checks = {
    deckPresent: body.includes(deckName),
    savedCount: /6 saved/i.test(body),
    reviewLogged: /GOOD/i.test(body),
    localMode: /single-user local collection/i.test(body),
    templateLabel: /card 2/i.test(body),
    deckOptionsPersisted: /10 new|10\snew/i.test(body) || body.includes('1 → 10m steps'),
    cardActionsVisible: /F2|flag 2/i.test(body),
    clozeCardsPresent: /\[\.\.\.\]|mitochondria|powerhouse/i.test(body),
    ankiDeckImported: /ATP|Energy currency|sample\.apkg/i.test(body),
  };

  if (!Object.values(checks).every(Boolean)) {
    console.error('Checks failed', checks);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, deckName, checks }));
  }
} finally {
  await browser.close();
  await fs.rm(path.dirname(apkgPath), { recursive: true, force: true });
}
