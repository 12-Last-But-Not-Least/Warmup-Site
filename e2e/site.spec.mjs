// e2e tests for the site
// run with: npm run test:e2e
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';

// expected results for each example button
const examples = [
  {
    name: 'Steps & sleep',
    titles: ['Step Count', 'Hours of Sleep', 'Step Count vs. Hours of Sleep'],
    people: 5, points: 35, r: '-0.08',
  },
  {
    name: 'Study hours & quiz scores',
    titles: ['Quiz Score (%)', 'Study Hours', 'Quiz Score (%) vs. Study Hours'],
    people: 5, points: 29, r: '0.92',
  },
  {
    name: 'Temperature & ice cream',
    titles: ['Ice Cream Sales', 'Avg Temperature (°C)', 'Ice Cream Sales vs. Avg Temperature (°C)'],
    people: 4, points: 32, r: '0.96',
  },
  {
    name: 'Screen time & sleep',
    titles: ['Sleep (hours)', 'Screen Time (hours)', 'Sleep (hours) vs. Screen Time (hours)'],
    people: 4, points: 28, r: '-0.84',
  },
];

// make a fake csv file to upload
function makeCsv(name, text) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text) };
}

// collect js errors and 404s so any test that hits one fails
let errors = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`);
  });
  await page.goto('/');
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('page loads with upload panel and no charts', async ({ page }) => {
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#file-a')).toBeAttached();
  await expect(page.locator('#file-b')).toBeAttached();
  await expect(page.locator('.examples button')).toHaveCount(4);
  await expect(page.locator('#charts')).toBeHidden();
});

test.describe('example buttons', () => {
  for (const ex of examples) {
    test(ex.name, async ({ page }) => {
      await page.getByRole('button', { name: ex.name }).click();
      await expect(page.locator('#charts')).toBeVisible();
      await expect(page.locator('.scatter-title')).toHaveText(ex.titles);

      // one line per person on the line charts, no lines on the scatter
      await expect(page.locator('#chart-a .series-line')).toHaveCount(ex.people);
      await expect(page.locator('#chart-b .series-line')).toHaveCount(ex.people);
      await expect(page.locator('#chart-scatter .series-line')).toHaveCount(0);

      await expect(page.locator('#chart-scatter .scatter-plot .point')).toHaveCount(ex.points);
      await expect(page.locator('#chart-scatter .corner-label')).toHaveText(`r = ${ex.r}  (n = ${ex.points})`);
      await expect(page.locator('#status')).toContainText(`${ex.people} groups, ${ex.points} matched pairs`);
    });
  }

  test('clicking another example replaces the charts', async ({ page }) => {
    await page.getByRole('button', { name: 'Steps & sleep' }).click();
    await expect(page.locator('#chart-a .scatter-title')).toHaveText('Step Count');

    await page.getByRole('button', { name: 'Temperature & ice cream' }).click();
    await expect(page.locator('#chart-a .scatter-title')).toHaveText('Ice Cream Sales');
    await expect(page.locator('#chart-a .series-line')).toHaveCount(4);
  });
});

test.describe('uploading files', () => {
  test('team data files', async ({ page }) => {
    await page.locator('#file-a').setInputFiles('data/DATA - Step Count.csv');
    await page.locator('#file-b').setInputFiles('data/DATA - Hours of Sleep.csv');

    await expect(page.locator('#charts')).toBeVisible();
    await expect(page.locator('#status')).toContainText('35 matched pairs');
    // some people left their rows empty, should say those were skipped
    await expect(page.locator('#warnings li', { hasText: 'skipped' }).first()).toBeVisible();
  });

  test('only one file picked', async ({ page }) => {
    await page.locator('#file-a').setInputFiles('data/examples/screen_time.csv');
    await expect(page.locator('#status')).toContainText('pick the other file');
    await expect(page.locator('#charts')).toBeHidden();
  });

  test('columns in different order still match', async ({ page }) => {
    // ice cream file has months in reverse order
    await page.locator('#file-a').setInputFiles('data/examples/ice_cream_sales.csv');
    await page.locator('#file-b').setInputFiles('data/examples/temperature.csv');
    await expect(page.locator('#chart-scatter .scatter-plot .point')).toHaveCount(32);
  });

  test('person only in one file is left off the scatter', async ({ page }) => {
    await page.locator('#file-a').setInputFiles(makeCsv('a.csv', 'Metric A,Mon,Tue\nAna,1,2\nBen,3,4\n'));
    await page.locator('#file-b').setInputFiles(makeCsv('b.csv', 'Metric B,Mon,Tue\nAna,5,6\n'));

    await expect(page.locator('#chart-a .series-line')).toHaveCount(2);
    await expect(page.locator('#chart-b .series-line')).toHaveCount(1);
    await expect(page.locator('#chart-scatter .scatter-plot .point')).toHaveCount(2);
  });

  // bad files should show a message and no charts
  const badFiles = [
    ['empty file', ''],
    ['header only', 'Metric,Mon,Tue\n'],
    ['duplicate columns', 'Metric,Mon,Mon\nAna,1,2\n'],
    ['no numbers', 'Metric,Mon,Tue\nAna,abc,def\n'],
  ];

  for (const [name, text] of badFiles) {
    test(`bad file: ${name}`, async ({ page }) => {
      // TODO: header only shows no message on main right now, fixed in #22.
      // remove this line once #22 is merged
      test.fail(name === 'header only');

      await page.locator('#file-a').setInputFiles(makeCsv('bad.csv', text));
      await page.locator('#file-b').setInputFiles('data/examples/screen_time.csv');
      await expect(page.locator('#warnings li').first()).toBeVisible();
      await expect(page.locator('#charts')).toBeHidden();
    });
  }

  test('bad file after a good one hides the old charts', async ({ page }) => {
    await page.getByRole('button', { name: 'Screen time & sleep' }).click();
    await expect(page.locator('#charts')).toBeVisible();

    await page.locator('#file-a').setInputFiles(makeCsv('bad.csv', ''));
    await page.locator('#file-b').setInputFiles('data/examples/screen_time.csv');
    await expect(page.locator('#charts')).toBeHidden();
  });

  test('html in a name is not run', async ({ page }) => {
    const name = '<img src=x onerror="window.hacked=1">';
    const quoted = `"${name.replaceAll('"', '""')}"`;
    await page.locator('#file-a').setInputFiles(makeCsv('a.csv', `Metric A,Mon,Tue\n${quoted},1,2\n`));
    await page.locator('#file-b').setInputFiles(makeCsv('b.csv', `Metric B,Mon,Tue\n${quoted},3,4\n`));

    await expect(page.locator('#chart-a .legend-item')).toHaveText(name);
    expect(await page.evaluate('window.hacked')).toBeUndefined();
  });
});

test.describe('chart interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Screen time & sleep' }).click();
    await expect(page.locator('#charts')).toBeVisible();
  });

  test('hover shows tooltip', async ({ page }) => {
    const scatter = page.locator('#chart-scatter');
    await scatter.scrollIntoViewIfNeeded();
    await scatter.locator('.scatter-plot .point').first().hover({ force: true });

    const tooltip = scatter.locator('.scatter-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Screen Time (hours)');
    await expect(tooltip).toContainText('Sleep (hours)');
  });

  test('legend click hides and shows a person', async ({ page }) => {
    const first = page.locator('#chart-a .legend-item').first();

    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#chart-a .series-line')).toHaveCount(3);
    await expect(page.locator('#chart-a .scatter-plot .point')).toHaveCount(21);

    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#chart-a .series-line')).toHaveCount(4);
  });

  test('legend hover fades the other lines', async ({ page }) => {
    await page.locator('#chart-a .legend-item').first().hover();
    await expect(page.locator('#chart-a .series-line.dimmed')).toHaveCount(3);

    await page.mouse.move(0, 0);
    await expect(page.locator('#chart-a .series-line.dimmed')).toHaveCount(0);
  });

  test('zoom, pan and reset', async ({ page }) => {
    const scatter = page.locator('#chart-scatter');
    const ticks = scatter.locator('.tick-label');
    await scatter.scrollIntoViewIfNeeded();
    const before = await ticks.allTextContents();

    // normal scroll shouldn't zoom
    let box = await scatter.locator('.scatter-plot svg').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await scatter.scrollIntoViewIfNeeded();
    await expect(ticks).toHaveText(before);

    // ctrl + scroll zooms
    box = await scatter.locator('.scatter-plot svg').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect(ticks).not.toHaveText(before);
    const zoomed = await ticks.allTextContents();

    // drag to pan
    await page.mouse.down();
    await page.mouse.move(x + 120, y, { steps: 5 });
    await page.mouse.up();
    await expect(ticks).not.toHaveText(zoomed);

    await scatter.getByRole('button', { name: 'Reset view' }).click();
    await expect(ticks).toHaveText(before);
  });

  test('data table has every value', async ({ page }) => {
    await page.locator('#chart-a').getByText('Show data table').click();
    await expect(page.locator('#chart-a table tbody tr')).toHaveCount(28);
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 720 } });

  test('no sideways scroll on a phone', async ({ page }) => {
    await page.getByRole('button', { name: 'Steps & sleep' }).click();
    await expect(page.locator('#charts')).toBeVisible();
    const width = await page.evaluate('document.documentElement.scrollWidth');
    expect(width).toBeLessThanOrEqual(375);
  });
});
