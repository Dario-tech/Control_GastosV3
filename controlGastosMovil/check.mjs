import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
await page.click('[data-tab="month"]');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshot-month.png' });

// Click Stats tab
await page.click('[data-tab="stats"]');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshot-stats.png' });

console.log('ERRORS:', errors.length ? errors : 'none');
console.log('WARNINGS:', warnings.length ? warnings.slice(0, 5) : 'none');

await browser.close();
