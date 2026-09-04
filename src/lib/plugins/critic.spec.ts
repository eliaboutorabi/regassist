import { describe, expect, it } from 'vitest';
import { parseDefects } from './critic.js';

describe('parseDefects', () => {
	const good = {
		defects: [
			{
				problem: 'The answer says meals are 100% deductible, which § 1.274-12 contradicts.',
				fix: 'State the 50 percent limit and its exceptions.'
			}
		]
	};

	it('reads a clean reply', () => {
		expect(parseDefects(JSON.stringify(good))).toHaveLength(1);
	});

	it('reads a reply wrapped in prose or a fence', () => {
		expect(parseDefects('Sure — here you go:\n```json\n' + JSON.stringify(good) + '\n```')).toHaveLength(
			1
		);
	});

	it('treats an empty list as the normal outcome', () => {
		expect(parseDefects('{"defects":[]}')).toEqual([]);
	});

	it('drops an objection too vague to act on', () => {
		expect(
			parseDefects('{"defects":[{"problem":"Too short","fix":"Add more"}]}')
		).toEqual([]);
	});

	it('drops entries missing a half', () => {
		expect(
			parseDefects(
				'{"defects":[{"problem":"The answer contradicts the section it cites here."}]}'
			)
		).toEqual([]);
	});

	it('caps at two, because one rewrite cannot act on five', () => {
		const many = {
			defects: Array.from({ length: 5 }, (_, index) => ({
				problem: `A specific and grounded problem number ${index} in the draft.`,
				fix: `Correct that particular thing properly.`
			}))
		};
		expect(parseDefects(JSON.stringify(many))).toHaveLength(2);
	});

	it('survives a reply that is not JSON at all', () => {
		expect(parseDefects('I think the answer looks fine to me!')).toEqual([]);
	});

	it('survives malformed JSON', () => {
		expect(parseDefects('{"defects":[{"problem": ')).toEqual([]);
	});
});
