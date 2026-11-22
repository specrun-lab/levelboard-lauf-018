import { expect, test } from '@playwright/test';

test.describe('level-1', () => {
  test('Seite antwortet mit HTTP 200', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
  });

  test('Titel ist „Levelboard“', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Levelboard');
  });

  test('10 Level-Karten sichtbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="board"]');
      return el && el.getAttribute('data-state') !== 'loading';
    });
    const cards = page.locator('[data-testid="level-card"]');
    await expect(cards).toHaveCount(10);
    for (let i = 0; i < 10; i++) {
      await expect(cards.nth(i)).toBeVisible();
    }
  });

  test('Keine Konsolenfehler', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="board"]');
      return el && el.getAttribute('data-state') !== 'loading';
    });
    expect(errors).toEqual([]);
  });

  test('Handy-Ansicht: Karten einspaltig', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="board"]');
      return el && el.getAttribute('data-state') !== 'loading';
    });
    const positions = await page.$$eval('[data-testid="level-card"]', (els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().x)),
    );
    expect(positions.length).toBe(10);
    const first = positions[0];
    for (const p of positions) expect(p).toBe(first);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });
});
