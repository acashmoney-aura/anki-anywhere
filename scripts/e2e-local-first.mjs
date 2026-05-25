import { chromium } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4176/';
const deckName = `E2E Deck ${Date.now()}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

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

  await page.getByRole('combobox').selectOption('basic_reversed');
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
  await page.getByPlaceholder(/Search cards, tags, hints/i).fill('');
  await page.locator('.library-panel').getByRole('button', { name: /Bury card/i }).first().click();

  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });

  const body = await page.locator('body').innerText();
  const checks = {
    deckPresent: body.includes(deckName),
    reversedCardsPresent: /5 saved/i.test(body),
    reviewLogged: /GOOD/i.test(body),
    localMode: /single-user local collection/i.test(body),
    templateLabel: /card 2/i.test(body),
    deckOptionsPersisted: /10 new|10\snew/i.test(body) || body.includes('1 → 10m steps'),
    cardActionsVisible: /F2|flag 2/i.test(body),
    clozeCardsPresent: /\[\.\.\.\]|mitochondria|powerhouse/i.test(body),
  };

  if (!Object.values(checks).every(Boolean)) {
    console.error('Checks failed', checks);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, deckName, checks }));
  }
} finally {
  await browser.close();
}
