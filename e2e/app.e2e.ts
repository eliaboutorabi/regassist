import { expect, test } from '@playwright/test';
import { GOOD_KEY, stubApi, unlock } from './fixtures.js';

// Each test gets a fresh browser context, so local storage starts empty
// without an init script — which would otherwise also wipe the key the
// "remembers it" test is reloading to check.
test.beforeEach(async ({ page }) => {
	await stubApi(page);
});

test.describe('the key gate', () => {
	test('meets a visitor with the robot, not a form', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByLabel('Verity, an animated calculator robot')).toBeVisible();
		await expect(page.getByRole('heading', { name: /runs on your OpenAI account/ })).toBeVisible();
	});

	test('reports a rejected key and stays put', async ({ page }) => {
		await page.goto('/');
		await page.getByLabel('OpenAI API key').fill('sk-wrongwrongwrongwrongwrongwrongwrong');
		await page.getByRole('button', { name: 'Start', exact: true }).click();

		await expect(page.getByRole('alert')).toContainText('rejected');
		await expect(page.getByLabel('OpenAI API key')).toBeVisible();
	});

	test('opens the app on a good key and remembers it', async ({ page }) => {
		await page.goto('/');
		await unlock(page);
		await expect(page.getByPlaceholder('Ask about a regulation…')).toBeVisible();

		await page.reload();
		await expect(page.getByRole('heading', { name: 'What are you checking?' })).toBeVisible();
	});

	test('voice is disabled until a key is entered', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('button', { name: /voice conversation/ })).toBeDisabled();
		await unlock(page);
		await expect(page.getByRole('button', { name: /voice conversation/ })).toBeEnabled();
	});
});

test.describe('a conversation', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await unlock(page);
	});

	test('renders the answer, the regulation card and the citation rail', async ({ page }) => {
		await page.getByLabel('Message Verity').fill('What substantiates travel?');
		await page.getByRole('button', { name: 'Send message' }).click();

		await expect(page.getByText('What substantiates travel?')).toBeVisible();

		const card = page.locator('article.card');
		await expect(card).toHaveAttribute('data-state', 'done');
		await expect(card).toContainText('26 CFR § 1.274-5');
		await expect(card).toContainText('Substantiation requirements.');

		await expect(page.getByText(/You need the amount, time, place/)).toBeVisible();
		// Markdown is rendered rather than shown as asterisks.
		await expect(page.locator('.prose strong')).toContainText('26 CFR § 1.274-5');

		const rail = page.locator('.rail-items a');
		await expect(rail).toHaveCount(2);
		await expect(rail.first()).toHaveAttribute('href', /ecfr\.gov/);
	});

	test('a suggestion starts a turn', async ({ page }) => {
		await page.getByRole('button', { name: /business meal to be deductible/ }).click();
		await expect(page.locator('article.card')).toBeVisible();
	});

	test('start over clears the thread and the citations', async ({ page }) => {
		await page.getByLabel('Message Verity').fill('What substantiates travel?');
		await page.getByRole('button', { name: 'Send message' }).click();
		await expect(page.locator('article.card')).toBeVisible();

		await page.getByRole('button', { name: 'Session settings' }).click();
		await page.getByRole('button', { name: 'Start over' }).click();

		await expect(page.getByRole('heading', { name: 'What are you checking?' })).toBeVisible();
		await expect(page.locator('.rail-items a')).toHaveCount(0);
	});
});

test.describe('documents', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await unlock(page);
	});

	test('pasted text is listed and can be removed', async ({ page }) => {
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await page.getByLabel('Paste document text').fill('Client dinners are fully deductible.');
		await page.getByRole('button', { name: 'Add text' }).click();

		const entry = page.locator('.loaded li');
		await expect(entry).toHaveCount(1);
		await expect(entry).toContainText('Client dinners are fully deductible.');

		await page.getByRole('button', { name: /^Remove / }).click();
		await expect(page.locator('.loaded li')).toHaveCount(0);
	});
});

test.describe('the settings popover', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await unlock(page);
		await page.getByRole('button', { name: 'Session settings' }).click();
	});

	test('offers the models this key can reach', async ({ page }) => {
		await expect(page.locator('.settings select option')).toHaveCount(2);
		await expect(page.getByText('Realtime voice is available on this key.')).toBeVisible();
	});

	test('closes on Escape', async ({ page }) => {
		await page.keyboard.press('Escape');
		await expect(page.locator('.settings')).toHaveCount(0);
	});

	test('closes on a click outside', async ({ page }) => {
		await page.getByRole('heading', { name: 'What are you checking?' }).click();
		await expect(page.locator('.settings')).toHaveCount(0);
	});

	test('forget key returns to the gate', async ({ page }) => {
		await page.getByRole('button', { name: 'Forget key' }).click();
		await expect(page.getByLabel('OpenAI API key')).toBeVisible();
	});
});

test.describe('characters', () => {
	test('switching to Rosie changes the accent', async ({ page }) => {
		await page.goto('/');
		await unlock(page);

		await page.getByRole('button', { name: 'Rosie', exact: true }).click();
		await expect(page.locator('html')).toHaveAttribute('data-character', 'rose');

		const accent = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
		);
		expect(accent).toBe('#c84f82');
	});
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test('the page never scrolls sideways and the composer stays put', async ({ page }) => {
		await page.goto('/');
		await unlock(page);

		await page.getByLabel('Message Verity').fill('What substantiates travel?');
		await page.getByRole('button', { name: 'Send message' }).click();
		await expect(page.locator('article.card')).toBeVisible();

		const layout = await page.evaluate(() => {
			const root = document.documentElement;
			const composer = document.querySelector('.composer')!.getBoundingClientRect();
			const scroller = document.querySelector('.scroller');
			return {
				horizontal: root.scrollWidth > root.clientWidth,
				composerVisible: composer.bottom <= window.innerHeight + 1,
				transcriptScrolls: scroller ? scroller.scrollHeight > scroller.clientHeight : false,
				robotVisible: document.querySelector('.stage-frame')!.getBoundingClientRect().height > 60
			};
		});

		expect(layout.horizontal).toBe(false);
		expect(layout.composerVisible).toBe(true);
		expect(layout.robotVisible).toBe(true);
	});
});
