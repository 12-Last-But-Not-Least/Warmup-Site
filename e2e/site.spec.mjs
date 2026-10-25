// End-to-end tests: open the real site in a browser and use it like a person would.
// Run with `npm run test:e2e` (see README).
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';

const DATA = 'data';

// What each example button should produce. The example CSVs are fixed files,
// so these numbers only change if someone edits the data.
const EXAMPLES = [
  {
    button: 'Steps & sleep',
    titles: ['Step Count', 'Hours of Sleep', 'Step Count vs. Hours of Sleep'],
    groups: 5, pairs: 35, r: '-0.08',
  },
  {
    button: 'Study hours & quiz scores',
    titles: ['Quiz Score (%)', 'Study Hours', 'Quiz Score (%) vs. Study Hours'],
    groups: 5, pairs: 29, r: '0.92',
  },
  {
    button: 'Temperature & ice cream',
    titles: ['Ice Cream Sales', 'Avg Temperature (°C)', 'Ice Cream Sales vs. Avg Temperature (°C)'],
    groups: 4, pairs: 32, r: '0.96',
  },
  {
    button: 'Screen time & sleep',
    titles: ['Sleep (hours)', 'Screen Time (hours)', 'Sleep (hours) vs. Screen Time (hours)'],
    groups: 4, pairs: 28, r: '-0.84',
  },
];

/** A small CSV given straight to the file picker, without a file on disk. */
function csvFile(name, text) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text) };
}

// Fail any test that causes a JavaScript error or a missing file (404) on the page.
// Tests in one worker run one at a time, so a single list is reset per test.
let problems = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
});

test.afterEach(() => {
  expect(problems, 'no page errors or missing files').toEqual([]);
});

const charts = (page) => page.locator('#charts');
const chart = (page, id) => page.locator(`#${id}`);
const status = (page) => page.locator('#status');
const messages = (page) => page.locator('#warnings li');

test.describe('first visit', () => {
  test('shows the upload panel and no charts', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#file-a')).toBeAttached();
    await expect(page.locator('#file-b')).toBeAttached();
    await expect(page.locator('.examples button')).toHaveCount(EXAMPLES.length);
    await expect(charts(page)).toBeHidden();
  });
});

test.describe('example buttons', () => {
  for (const example of EXAMPLES) {
    test(`"${example.button}" draws two line charts and a scatter plot`, async ({ page }) => {
      await page.getByRole('button', { name: example.button }).click();
      await expect(charts(page)).toBeVisible();

      // Titles come from each file's top-left cell.
      await expect(page.locator('.scatter-title')).toHaveText(example.titles);

      // One line per person on each line chart, none on the scatter plot.
      await expect(chart(page, 'chart-a').locator('.series-line')).toHaveCount(example.groups);
      await expect(chart(page, 'chart-b').locator('.series-line')).toHaveCount(example.groups);
      await expect(chart(page, 'chart-scatter').locator('.series-line')).toHaveCount(0);

      // The scatter plot pairs the files by person and column name.
      await expect(chart(page, 'chart-scatter').locator('.scatter-plot .point')).toHaveCount(example.pairs);
      await expect(chart(page, 'chart-scatter').locator('.corner-label'))
        .toHaveText(`r = ${example.r}  (n = ${example.pairs})`);
      await expect(status(page)).toContainText(`${example.groups} groups, ${example.pairs} matched pairs`);
    });
  }

  test('switching examples replaces the charts', async ({ page }) => {
    await page.getByRole('button', { name: 'Steps & sleep' }).click();
    await expect(chart(page, 'chart-a').locator('.scatter-title')).toHaveText('Step Count');
    await page.getByRole('button', { name: 'Temperature & ice cream' }).click();
    await expect(chart(page, 'chart-a').locator('.scatter-title')).toHaveText('Ice Cream Sales');
    await expect(chart(page, 'chart-a').locator('.series-line')).toHaveCount(4);
  });
});

test.describe('uploading files', () => {
  test('the team data files draw the charts and report skipped blanks', async ({ page }) => {
    await page.locator('#file-a').setInputFiles(`${DATA}/DATA - Step Count.csv`);
    await page.locator('#file-b').setInputFiles(`${DATA}/DATA - Hours of Sleep.csv`);

    await expect(charts(page)).toBeVisible();
    await expect(status(page)).toContainText('DATA - Step Count.csv');
    await expect(status(page)).toContainText('35 matched pairs');
    // Several people left their rows blank; those cells are skipped (not plotted as 0)
    // and the page says so. How many message lines that takes is up to data.js.
    await expect(messages(page).filter({ hasText: 'skipped' }).first()).toBeVisible();
  });

  test('picking only one file asks for the other', async ({ page }) => {
    await page.locator('#file-a').setInputFiles(`${DATA}/examples/screen_time.csv`);
    await expect(status(page)).toContainText('pick the other file');
    await expect(charts(page)).toBeHidden();
  });

  test('columns in a different order are still matched by name', async ({ page }) => {
    // ice_cream_sales.csv lists months Aug→Jan, temperature.csv lists them Jan→Aug.
    await page.locator('#file-a').setInputFiles(`${DATA}/examples/ice_cream_sales.csv`);
    await page.locator('#file-b').setInputFiles(`${DATA}/examples/temperature.csv`);
    await expect(chart(page, 'chart-scatter').locator('.scatter-plot .point')).toHaveCount(32);
  });

  test('a person missing from one file is on its line chart but not the scatter plot', async ({ page }) => {
    await page.locator('#file-a').setInputFiles(csvFile('a.csv', 'Metric A,Mon,Tue\nAna,1,2\nBen,3,4\n'));
    await page.locator('#file-b').setInputFiles(csvFile('b.csv', 'Metric B,Mon,Tue\nAna,5,6\n'));

    await expect(chart(page, 'chart-a').locator('.series-line')).toHaveCount(2);
    await expect(chart(page, 'chart-b').locator('.series-line')).toHaveCount(1);
    await expect(chart(page, 'chart-scatter').locator('.scatter-plot .point')).toHaveCount(2);
  });

  // Bad files must give a message and no charts, never a crash.
  // (Checks behaviour, not exact wording, so message changes don't break the tests.)
  const badFiles = {
    'an empty file': '',
    'a header with no data rows': 'Metric,Mon,Tue\n',
    'repeated column names': 'Metric,Mon,Mon\nAna,1,2\n',
    'only text where numbers should be': 'Metric,Mon,Tue\nAna,abc,def\n',
  };
  // Known bug on main: a header-only file says "See the messages below" but shows none.
  // feature/csv-validation fixes it. Once that's merged this test passes, Playwright
  // reports it as "unexpectedly passed", and this entry should be deleted.
  const knownBugs = new Set(['a header with no data rows']);

  for (const [description, text] of Object.entries(badFiles)) {
    test(`${description} shows a message and no charts`, async ({ page }) => {
      test.fail(knownBugs.has(description), 'known bug: no message for a header-only file');
      await page.locator('#file-a').setInputFiles(csvFile('bad.csv', text));
      await page.locator('#file-b').setInputFiles(`${DATA}/examples/screen_time.csv`);
      await expect(messages(page).first()).toBeVisible();
      await expect(charts(page)).toBeHidden();
    });
  }

  test('a bad file after a good one hides the old charts', async ({ page }) => {
    await page.getByRole('button', { name: 'Screen time & sleep' }).click();
    await expect(charts(page)).toBeVisible();
    await page.locator('#file-a').setInputFiles(csvFile('bad.csv', ''));
    await page.locator('#file-b').setInputFiles(`${DATA}/examples/screen_time.csv`);
    await expect(charts(page)).toBeHidden();
  });

  test('names from a file are shown as plain text, never run as code', async ({ page }) => {
    const name = '<img src=x onerror="window.hacked=1">';
    await page.locator('#file-a').setInputFiles(csvFile('a.csv', `Metric A,Mon,Tue\n"${name.replaceAll('"', '""')}",1,2\n`));
    await page.locator('#file-b').setInputFiles(csvFile('b.csv', `Metric B,Mon,Tue\n"${name.replaceAll('"', '""')}",3,4\n`));
    await expect(chart(page, 'chart-a').locator('.legend-item')).toHaveText(name);
    expect(await page.evaluate('window.hacked')).toBeUndefined();
  });
});

test.describe('chart interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Screen time & sleep' }).click();
    await expect(charts(page)).toBeVisible();
  });

  test('hovering a point shows a tooltip with the person and values', async ({ page }) => {
    const scatter = chart(page, 'chart-scatter');
    await scatter.scrollIntoViewIfNeeded();
    await scatter.locator('.scatter-plot .point').first().hover({ force: true });
    const tooltip = scatter.locator('.scatter-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Screen Time (hours)');
    await expect(tooltip).toContainText('Sleep (hours)');
  });

  test('clicking a legend name hides and shows that person', async ({ page }) => {
    const lineChart = chart(page, 'chart-a');
    const firstPerson = lineChart.locator('.legend-item').first();

    await firstPerson.click();
    await expect(firstPerson).toHaveAttribute('aria-pressed', 'false');
    await expect(lineChart.locator('.series-line')).toHaveCount(3);
    await expect(lineChart.locator('.scatter-plot .point')).toHaveCount(21);

    await firstPerson.click();
    await expect(firstPerson).toHaveAttribute('aria-pressed', 'true');
    await expect(lineChart.locator('.series-line')).toHaveCount(4);
  });

  test('hovering a legend name fades everyone else', async ({ page }) => {
    const lineChart = chart(page, 'chart-a');
    await lineChart.locator('.legend-item').first().hover();
    await expect(lineChart.locator('.series-line.dimmed')).toHaveCount(3);
    await page.mouse.move(0, 0);
    await expect(lineChart.locator('.series-line.dimmed')).toHaveCount(0);
  });

  test('Ctrl + scroll zooms, dragging pans, and Reset view restores', async ({ page }) => {
    const scatter = chart(page, 'chart-scatter');
    await scatter.scrollIntoViewIfNeeded();
    const ticks = scatter.locator('.tick-label');
    const original = await ticks.allTextContents();
    const box = await scatter.locator('.scatter-plot svg').boundingBox();
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Plain scrolling must not zoom (it should scroll the page instead).
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -300);
    await scatter.scrollIntoViewIfNeeded();
    await expect(ticks).toHaveText(original);

    const box2 = await scatter.locator('.scatter-plot svg').boundingBox();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect(ticks).not.toHaveText(original);
    const zoomed = await ticks.allTextContents();

    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2 + 120, box2.y + box2.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(ticks).not.toHaveText(zoomed);

    await scatter.getByRole('button', { name: 'Reset view' }).click();
    await expect(ticks).toHaveText(original);
  });

  test('the data table lists every plotted value', async ({ page }) => {
    const lineChart = chart(page, 'chart-a');
    await lineChart.getByText('Show data table').click();
    await expect(lineChart.locator('table tbody tr')).toHaveCount(28);
  });
});

test.describe('small screens', () => {
  test.use({ viewport: { width: 375, height: 720 } });

  test('the page fits a phone screen without sideways scrolling', async ({ page }) => {
    await page.getByRole('button', { name: 'Steps & sleep' }).click();
    await expect(charts(page)).toBeVisible();
    const pageWidth = await page.evaluate('document.documentElement.scrollWidth');
    expect(pageWidth).toBeLessThanOrEqual(375);
  });
});
