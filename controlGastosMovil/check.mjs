// Smoke manual (NO forma parte de `npm test`): requiere `npm run dev` en marcha y,
// para pasar del login, una sesión válida (ver QA-SETUP.md). Ancho 375px.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();

const errors = [];
const warnings = [];

page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(2000);

await page.screenshot({ path: 'screenshot-year.png', fullPage: false });

// Click Mes tab
await page.click('[data-tour="tab-month"]');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshot-month.png' });

// Click Stats tab
await page.click('[data-tour="tab-stats"]');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshot-stats.png' });

await page.click('[data-tour="tab-budget"]');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshot-budget.png' });
await page.click('[data-tour="tab-year"]');
await page.waitForTimeout(500);

console.log('ERRORS:', errors.length ? errors : 'none');
console.log('WARNINGS:', warnings.length ? warnings.slice(0, 5) : 'none');

await browser.close();
