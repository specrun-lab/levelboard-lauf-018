import { expect, test } from '@playwright/test';

const LIVE_URL = process.env.LIVE_URL || '';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtBuildS(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${pad2(sec)} min`;
}

function fmt1(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

test.describe('live-bericht', () => {
  test('Live-Seite zeigt den gemeldeten Abschlussbericht', async ({ page }) => {
    const res = await fetch(`${LIVE_URL}/api/levels`);
    expect(res.status).toBe(200);
    const data = await res.json();

    for (let i = 0; i < 10; i++) {
      expect(data.levels[i].status).toBe('bestanden');
      expect(data.levels[i].metrics.build).toBeTruthy();
    }
    expect(data.levels[5].metrics.pipeline).toBeTruthy();
    expect(data.levels[6].metrics.images).toBeTruthy();
    expect(data.levels[8].metrics.loadtest).toBeTruthy();

    const sumBuildS = data.levels.reduce(
      (s: number, l: { metrics: { build?: { buildS?: number } } }) =>
        s + (l.metrics.build?.buildS || 0),
      0,
    );

    await page.goto(LIVE_URL);
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="report"]')).toHaveAttribute('data-complete', 'true');
    await expect(page.locator('[data-testid="summary-reached"]')).toHaveText('10 / 10');
    await expect(page.locator('[data-testid="report-score"]')).toHaveText('100 / 100');
    await expect(page.locator('[data-testid="report-commit"]')).toHaveText(data.run.commit.slice(0, 7));
    await expect(page.locator('[data-testid="report-build-time"]')).toHaveText(fmtBuildS(sumBuildS));
    await expect(page.locator('[data-testid="report-p95"]')).toHaveText(
      `${data.levels[8].metrics.loadtest.p95Ms} ms`,
    );
    await expect(page.locator('[data-testid="report-image-backend"]')).toHaveText(
      `${fmt1(data.levels[6].metrics.images.backendMB)} MB`,
    );
    await expect(page.locator('[data-testid="report-pipeline-total"]')).toHaveText(
      `${data.levels[5].metrics.pipeline.totalS} s`,
    );
    for (let i = 1; i <= 10; i++) {
      await expect(
        page.locator(`[data-testid="report-level"][data-level="${i}"]`),
      ).toHaveAttribute('data-status', 'bestanden');
    }
  });
});
