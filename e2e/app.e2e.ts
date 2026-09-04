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

	test('hides the app controls until a key is entered', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0);
		await unlock(page);
		await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
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

		const rail = page.locator('.rail a');
		await expect(rail).toHaveCount(2);
		await expect(rail.first()).toHaveAttribute('href', /ecfr\.gov/);
	});

	test('a suggestion starts a turn', async ({ page }) => {
		await page.getByRole('button', { name: /business meal to be deductible/ }).click();
		await expect(page.locator('article.card')).toBeVisible();
	});

	test('New clears the thread and the citations', async ({ page }) => {
		await page.getByLabel('Message Verity').fill('What substantiates travel?');
		await page.getByRole('button', { name: 'Send message' }).click();
		await expect(page.locator('article.card')).toBeVisible();

		await page.getByRole('button', { name: 'New' }).click();

		await expect(page.getByRole('heading', { name: 'What are you checking?' })).toBeVisible();
		await expect(page.locator('.rail a')).toHaveCount(0);
	});
});

test.describe('documents', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await unlock(page);
	});

	test('a long paste becomes an attachment rather than a message', async ({ page }) => {
		const memo = `Engagement memo\n${'Client dinners are fully deductible. '.repeat(60)}`;
		await page.getByLabel('Message Verity').focus();
		// Pasting is the path this behaviour hangs off; typing must not trigger it.
		await page.evaluate((text) => {
			const field = document.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Message Verity"]'
			)!;
			const data = new DataTransfer();
			data.setData('text/plain', text);
			field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
		}, memo);

		const chip = page.locator('.chips li');
		await expect(chip).toHaveCount(1);
		await expect(chip).toContainText('Engagement memo');
		// It became an attachment, so it did not also become the message.
		await expect(page.getByLabel('Message Verity')).toHaveValue('');

		await page.getByRole('button', { name: /^Remove / }).click();
		await expect(page.locator('.chips li')).toHaveCount(0);
	});

	test('a short paste stays in the message', async ({ page }) => {
		await page.getByLabel('Message Verity').focus();
		await page.evaluate(() => {
			const field = document.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Message Verity"]'
			)!;
			const data = new DataTransfer();
			data.setData('text/plain', 'what about meals?');
			field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
		});
		await expect(page.locator('.chips li')).toHaveCount(0);
	});
});

test.describe('settings', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await unlock(page);
		await page.getByRole('button', { name: 'Settings' }).click();
		await expect(page.locator('dialog[open]')).toBeVisible();
	});

	test('offers the models this key can reach', async ({ page }) => {
		await expect(page.locator('dialog select option')).toHaveCount(2);
		await expect(page.getByText('Realtime voice is available on this key.')).toBeVisible();
	});

	test('closes on Escape', async ({ page }) => {
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog[open]')).toHaveCount(0);
	});

	test('closes on the close button', async ({ page }) => {
		await page.getByRole('button', { name: 'Close settings' }).click();
		await expect(page.locator('dialog[open]')).toHaveCount(0);
	});

	test('switching character changes the accent', async ({ page }) => {
		await page.getByRole('button', { name: /Rosie/ }).click();
		await expect(page.locator('html')).toHaveAttribute('data-character', 'rose');

		const accent = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
		);
		expect(accent).toBe('#c84f82');
	});

	test('a skill can be switched off and a new one taught', async ({ page }) => {
		const first = page.locator('dialog .skills li').first();
		await expect(first.locator('input[type=checkbox]')).toBeChecked();
		await first.locator('input[type=checkbox]').uncheck();
		await expect(first).toHaveClass(/off/);

		await page.getByRole('button', { name: /Teach her something/ }).click();
		await page.getByLabel('Skill name').fill('Flag crypto');
		await page.getByLabel('Skill instructions').fill('Always mention basis tracking.');
		await page.getByRole('button', { name: 'Add skill' }).click();

		await expect(page.getByText('Flag crypto')).toBeVisible();
	});

	test('knowledge survives a reload', async ({ page }) => {
		const field = page.getByPlaceholder(/Mostly S-corps/);
		await field.fill('Vermont cheese importers, mostly.');
		await page.keyboard.press('Escape');

		await page.reload();
		await page.getByRole('button', { name: 'Settings' }).click();
		await expect(page.getByPlaceholder(/Mostly S-corps/)).toHaveValue(
			'Vermont cheese importers, mostly.'
		);
	});

	test('forget key returns to the gate', async ({ page }) => {
		await page.getByRole('button', { name: 'Forget' }).first().click();
		await expect(page.getByLabel('OpenAI API key')).toBeVisible();
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
