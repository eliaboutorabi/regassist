/** The CFR titles that carry tax, financial and reporting regulation. */
export const RELEVANT_TITLES = [
	{
		number: 12,
		name: 'Banks and Banking',
		blurb: 'Bank capital, lending, and Federal Reserve rules'
	},
	{
		number: 17,
		name: 'Commodity and Securities Exchanges',
		blurb: 'SEC and CFTC rules, including Regulation S-X accounting'
	},
	{
		number: 26,
		name: 'Internal Revenue',
		blurb: 'The Treasury regulations under the Internal Revenue Code'
	},
	{ number: 29, name: 'Labor', blurb: 'ERISA, employee benefit plans, and wage rules' },
	{
		number: 31,
		name: 'Money and Finance: Treasury',
		blurb: 'Treasury, FinCEN, and anti-money-laundering rules'
	},
	{
		number: 48,
		name: 'Federal Acquisition Regulations',
		blurb: 'Government contract cost accounting standards'
	}
] as const;

export type RelevantTitle = (typeof RELEVANT_TITLES)[number]['number'];

export const TITLE_NAMES = new Map<number, string>(
	RELEVANT_TITLES.map((title) => [title.number, title.name])
);
