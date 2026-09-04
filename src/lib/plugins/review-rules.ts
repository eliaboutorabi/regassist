/**
 * The review rule pack.
 *
 * These are the things a reviewer actually circles in red on a client memo, an
 * engagement letter or a draft tax position: topics that carry a specific
 * federal regulation, and assertions that are stated too absolutely to survive
 * a challenge.
 *
 * A rule never decides an answer. It flags a passage, names the concern, and
 * hands the assistant the lookup that would settle it — the regulation itself
 * is fetched live from the eCFR, never quoted from this file.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface ReviewRule {
	id: string;
	topic: string;
	severity: Severity;
	/** Matched case-insensitively against the document text. */
	patterns: RegExp[];
	/** Why a reviewer stops here. */
	concern: string;
	/** The search that resolves it, phrased for `search_regulations`. */
	lookup: string;
	/** Narrow the lookup to one CFR title when the answer only lives there. */
	title?: number;
}

const rule = (definition: ReviewRule): ReviewRule => definition;

export const REVIEW_RULES: ReviewRule[] = [
	// --------------------------------------------------- absolute assertions
	rule({
		id: 'absolute-deductibility',
		topic: 'Unqualified deductibility claim',
		severity: 'high',
		patterns: [
			/\b(?:fully|100%|entirely|completely|always)\s+deductible\b/i,
			/\bdeductible\s+in\s+full\b/i,
			/\bcan\s+(?:always|certainly)\s+be\s+(?:deducted|written\s+off)\b/i
		],
		concern:
			'States deductibility without the conditions the regulation attaches. Deduction limits are almost always conditional on substantiation, purpose, and the category of expense.',
		lookup: 'ordinary and necessary business expense deduction requirements',
		title: 26
	}),
	rule({
		id: 'absolute-nontaxable',
		topic: 'Unqualified non-taxable claim',
		severity: 'high',
		patterns: [
			/\b(?:not|non)[- ]?taxable\b/i,
			/\btax[- ]free\b/i,
			/\bno\s+tax\s+(?:is\s+)?(?:due|owed|payable)\b/i,
			/\bexcluded\s+from\s+(?:gross\s+)?income\b/i
		],
		concern:
			'Asserts an exclusion from income. Exclusions are enumerated and conditional; the memo should cite the provision it relies on.',
		lookup: 'items specifically excluded from gross income',
		title: 26
	}),
	rule({
		id: 'no-reporting',
		topic: 'Claim that no reporting is required',
		severity: 'high',
		patterns: [
			/\bno\s+(?:reporting|filing|disclosure)\s+(?:is\s+)?(?:required|necessary|needed)\b/i,
			/\b(?:does|do)\s+not\s+(?:need|have)\s+to\s+be\s+reported\b/i,
			/\bno\s+(?:form|1099|1098|w-2)\s+(?:is\s+)?required\b/i
		],
		concern:
			'Information-reporting duties are separate from tax liability. A payment can be non-taxable to the recipient and still reportable by the payer.',
		lookup: 'information returns reporting requirements payments',
		title: 26
	}),
	rule({
		id: 'guarantee-language',
		topic: 'Guarantee or assurance of outcome',
		severity: 'high',
		patterns: [
			/\bguarantee[sd]?\b/i,
			/\bwill\s+not\s+be\s+(?:audited|challenged|questioned)\b/i,
			/\b(?:survive|withstand)\s+(?:an?\s+)?(?:audit|examination|challenge)\b/i,
			/\bzero\s+risk\b/i,
			/\baudit[- ]proof\b/i,
			/\bcannot\s+be\s+challenged\b/i
		],
		concern:
			'Guaranteeing a tax outcome is both unsupportable and a professional-conduct problem in an engagement letter or client communication.',
		lookup: 'standards of practice before the Internal Revenue Service written advice',
		title: 31
	}),

	// ------------------------------------------------------ classic tax areas
	rule({
		id: 'worker-classification',
		topic: 'Worker classification',
		severity: 'high',
		patterns: [
			/\bindependent\s+contractors?\b/i,
			/\b1099[- ]?(?:nec|misc)?\s+(?:worker|contractor|basis)\b/i,
			/\bnot\s+(?:an\s+)?employees?\b/i,
			/\bclassif\w+\s+as\s+(?:a\s+)?contractor\b/i
		],
		concern:
			'Contractor-versus-employee status drives payroll tax, benefits and withholding. Misclassification is one of the most commonly assessed exposures.',
		lookup: 'employee status common law control test employment taxes',
		title: 26
	}),
	rule({
		id: 'meals-entertainment',
		topic: 'Meals and entertainment',
		severity: 'medium',
		patterns: [
			/\bbusiness\s+meals?\b/i,
			/\bentertainment\s+expenses?\b/i,
			/\bclient\s+(?:dinner|lunch|meals?)\b/i,
			/\bmeals?\s+and\s+entertainment\b/i
		],
		concern:
			'Meals and entertainment carry percentage limits and strict substantiation rules that differ by category and have changed repeatedly.',
		lookup: 'disallowance of certain entertainment meals expenses substantiation',
		title: 26
	}),
	rule({
		id: 'reasonable-compensation',
		topic: 'Reasonable compensation',
		severity: 'high',
		patterns: [
			/\breasonable\s+compensation\b/i,
			/\bs[- ]?corp\w*\s+(?:owner|shareholder)\s+(?:salary|compensation|distribution)/i,
			/\b(?:minimal|nominal|low|small|zero|no)\s+(?:w-?2\s+)?salary\b/i,
			/\bminimi[sz]e\s+(?:the\s+)?salary\b/i,
			/\b(?:rest|remainder|balance)\s+(?:in|as)\s+distributions?\b/i,
			/\btake\s+(?:it\s+)?(?:as|in)\s+distributions?\s+instead\b/i
		],
		concern:
			'Shareholder-employee compensation must be reasonable for services rendered. Understating salary in favour of distributions is a standard examination target.',
		lookup: 'compensation for personal services reasonable allowance',
		title: 26
	}),
	rule({
		id: 'home-office',
		topic: 'Home office deduction',
		severity: 'medium',
		patterns: [/\bhome\s+office\b/i, /\boffice\s+in\s+the\s+home\b/i, /\bworks?\s+from\s+home\s+deduct/i],
		concern:
			'Requires exclusive and regular use as a principal place of business. The exclusivity test is where most claims fail.',
		lookup: 'business use of home exclusive use principal place of business',
		title: 26
	}),
	rule({
		id: 'depreciation',
		topic: 'Depreciation and expensing',
		severity: 'medium',
		patterns: [
			/\bbonus\s+depreciation\b/i,
			/\bsection\s+179\b/i,
			/\bdepreciat\w+\b/i,
			/\bimmediately\s+expensed?\b/i,
			/\bwrite\s+off\s+the\s+(?:full|entire)\s+cost\b/i
		],
		concern:
			'Recovery period, convention, and eligibility depend on asset class and placed-in-service date. Expensing elections carry dollar limits and phase-outs.',
		lookup: 'depreciation recovery period property placed in service election to expense',
		title: 26
	}),
	rule({
		id: 'capitalize-vs-repair',
		topic: 'Capitalisation versus repair',
		severity: 'medium',
		patterns: [
			/\brepairs?\s+(?:and|&)\s+maintenance\b/i,
			/\bexpensed?\s+rather\s+than\s+capitali[sz]ed?\b/i,
			/\bimprovements?\s+to\s+(?:the\s+)?(?:property|building)\b/i,
			/\bde\s+minimis\s+safe\s+harbou?r\b/i
		],
		concern:
			'Betterments, restorations and adaptations must be capitalised. The de minimis safe harbour has an election requirement and a per-item ceiling.',
		lookup: 'amounts paid to improve tangible property capitalization de minimis safe harbor',
		title: 26
	}),
	rule({
		id: 'travel-substantiation',
		topic: 'Travel, mileage and per diem',
		severity: 'medium',
		patterns: [
			/\bper\s+diem\b/i,
			/\bmileage\s+(?:rate|reimburse\w*|log)\b/i,
			/\btravel\s+expenses?\b/i,
			/\bwithout\s+receipts?\b/i
		],
		concern:
			'Travel deductions are subject to heightened substantiation: amount, time, place and business purpose, contemporaneously recorded.',
		lookup: 'substantiation requirements travel entertainment listed property records',
		title: 26
	}),
	rule({
		id: 'charitable',
		topic: 'Charitable contributions',
		severity: 'medium',
		patterns: [
			/\bcharitable\s+(?:contribution|donation|deduction)/i,
			/\bdonat\w+\s+(?:to\s+)?(?:a\s+)?(?:charity|501\(?c\)?\(?3\)?)/i,
			/\bin[- ]kind\s+donation\b/i,
			/\bappraisal\b/i
		],
		concern:
			'Deduction depends on donee status, the form of the gift, percentage ceilings, and written acknowledgement or appraisal thresholds.',
		lookup: 'charitable contributions substantiation appraisal acknowledgement requirements',
		title: 26
	}),
	rule({
		id: 'research-credit',
		topic: 'Research credit',
		severity: 'high',
		patterns: [
			/\bR\s*&\s*D\s+(?:credit|tax\s+credit|expenses?)\b/i,
			/\bresearch\s+(?:and\s+development\s+)?credit\b/i,
			/\bqualified\s+research\s+expens\w+\b/i,
			/\bsection\s+174\b/i
		],
		concern:
			'The credit requires a four-part qualification test plus contemporaneous documentation, and §174 capitalisation interacts with it. A frequent target of both examination and promoter scrutiny.',
		lookup: 'credit for increasing research activities qualified research expenses',
		title: 26
	}),
	rule({
		id: 'employee-retention-credit',
		topic: 'Employee retention credit',
		severity: 'high',
		patterns: [/\bemployee\s+retention\s+(?:credit|tax\s+credit)\b/i, /\bERC\b/, /\bERTC\b/],
		concern:
			'Eligibility rests on specific suspension or gross-receipts tests for defined quarters. Claims from this area have drawn concentrated enforcement attention.',
		lookup: 'employment tax credits eligible employer qualified wages',
		title: 26
	}),
	rule({
		id: 'related-party',
		topic: 'Related-party transaction',
		severity: 'high',
		patterns: [
			/\brelated[- ]part(?:y|ies)\b/i,
			/\baffiliated\s+(?:entity|entities|compan\w+)\b/i,
			/\bloan\s+(?:to|from)\s+(?:the\s+)?(?:owner|shareholder|member)\b/i,
			/\bcommon\s+control\b/i
		],
		concern:
			'Losses and deductions between related parties are restricted, and the arrangement is separately disclosable in financial statements.',
		lookup: 'losses expenses interest transactions between related taxpayers',
		title: 26
	}),
	rule({
		id: 'transfer-pricing',
		topic: 'Transfer pricing',
		severity: 'high',
		patterns: [
			/\btransfer\s+pricing\b/i,
			/\bintercompany\s+(?:charge|pricing|agreement|transaction)/i,
			/\barm'?s?[- ]length\b/i,
			/\bcost\s+sharing\s+arrangement\b/i
		],
		concern:
			'Intercompany pricing must be arm’s length and supported by contemporaneous documentation, or penalties attach to any adjustment.',
		lookup: 'allocation of income and deductions among taxpayers arm length standard',
		title: 26
	}),
	rule({
		id: 'foreign-accounts',
		topic: 'Foreign accounts and assets',
		severity: 'high',
		patterns: [
			/\bFBAR\b/,
			/\bforeign\s+(?:bank\s+)?accounts?\b/i,
			/\bFATCA\b/,
			/\boffshore\s+(?:account|entity|structure)/i,
			/\bFinCEN\b/i
		],
		concern:
			'Foreign account reporting is a separate regime from income tax with its own thresholds, deadlines and severe non-filing penalties.',
		lookup: 'reports of foreign financial accounts filing requirements',
		title: 31
	}),
	rule({
		id: 'cash-reporting',
		topic: 'Large cash transactions',
		severity: 'high',
		patterns: [
			/\bcash\s+(?:payment|transaction)s?\s+(?:over|exceeding|above)\s+\$?\s?10,?000\b/i,
			/\bform\s+8300\b/i,
			/\bstructur\w+\s+(?:the\s+)?(?:deposit|payment|transaction)/i
		],
		concern:
			'Cash received in a trade or business above the threshold triggers a filing duty, and structuring to avoid it is itself an offence.',
		lookup: 'returns relating to cash received in trade or business',
		title: 26
	}),
	rule({
		id: 'digital-assets',
		topic: 'Digital assets',
		severity: 'medium',
		patterns: [
			/\b(?:crypto\w*|bitcoin|ethereum|digital\s+assets?|NFTs?)\b/i,
			/\bstaking\s+rewards?\b/i,
			/\bwallet\s+(?:transfer|address)\b/i
		],
		concern:
			'Digital-asset dispositions are property transactions with their own broker-reporting regime and basis-tracking requirements.',
		lookup: 'returns of brokers digital asset transactions basis reporting',
		title: 26
	}),
	rule({
		id: 'nexus-state',
		topic: 'State and local tax nexus',
		severity: 'info',
		patterns: [
			/\bnexus\b/i,
			/\bsales\s+tax\b/i,
			/\bstate\s+(?:income\s+)?tax\b/i,
			/\beconomic\s+presence\b/i
		],
		concern:
			'State and local obligations are outside the federal CFR entirely. This assistant can only speak to federal regulation — route this to a SALT specialist.',
		lookup: 'state and local taxation is outside the Code of Federal Regulations',
		title: undefined
	}),

	// ------------------------------------------------ reporting and assurance
	rule({
		id: 'revenue-recognition',
		topic: 'Revenue recognition',
		severity: 'medium',
		patterns: [
			/\brevenue\s+recognition\b/i,
			/\bASC\s*606\b/i,
			/\bperformance\s+obligations?\b/i,
			/\brecogni[sz]e[ds]?\s+(?:the\s+)?revenue\s+(?:upon|when|at)/i
		],
		concern:
			'For an SEC registrant the presentation and disclosure rules in Regulation S-X apply on top of the accounting standard.',
		lookup: 'Regulation S-X form and content of financial statements',
		title: 17
	}),
	rule({
		id: 'auditor-independence',
		topic: 'Auditor independence',
		severity: 'high',
		patterns: [
			/\bauditor\s+independence\b/i,
			/\bnon[- ]audit\s+services?\b/i,
			/\bbookkeeping\s+(?:services\s+)?for\s+(?:an?\s+)?audit\s+client\b/i,
			/\bboth\s+audit\s+and\s+(?:tax|consulting)\b/i
		],
		concern:
			'Providing certain non-audit services to an audit client impairs independence per se, regardless of materiality or safeguards.',
		lookup: 'qualifications of accountants independence non-audit services',
		title: 17
	}),
	rule({
		id: 'internal-control',
		topic: 'Internal control over financial reporting',
		severity: 'medium',
		patterns: [
			/\bmaterial\s+weakness\b/i,
			/\binternal\s+controls?\s+over\s+financial\s+reporting\b/i,
			/\bICFR\b/,
			/\bsignificant\s+deficienc\w+\b/i,
			/\bsegregation\s+of\s+duties\b/i
		],
		concern:
			'Identified control deficiencies carry evaluation and disclosure obligations, and a material weakness must be reported.',
		lookup: 'management report on internal control over financial reporting',
		title: 17
	}),
	rule({
		id: 'going-concern',
		topic: 'Going concern',
		severity: 'high',
		patterns: [
			/\bgoing\s+concern\b/i,
			/\bsubstantial\s+doubt\b/i,
			/\bability\s+to\s+continue\s+operations\b/i
		],
		concern:
			'Substantial doubt about going concern drives both a disclosure requirement and a modification to the audit report.',
		lookup: 'financial statement disclosure going concern uncertainties',
		title: 17
	}),
	rule({
		id: 'benefit-plans',
		topic: 'Employee benefit plans',
		severity: 'medium',
		patterns: [
			/\b401\(?k\)?\b/i,
			/\bERISA\b/,
			/\bemployee\s+benefit\s+plans?\b/i,
			/\bform\s+5500\b/i,
			/\bfiduciary\s+dut(?:y|ies)\b/i
		],
		concern:
			'Plan operation, reporting and fiduciary conduct sit under a separate Labor Department regime with its own filing calendar.',
		lookup: 'employee benefit plan reporting and disclosure requirements',
		title: 29
	}),
	rule({
		id: 'anti-money-laundering',
		topic: 'Anti-money-laundering programme',
		severity: 'medium',
		patterns: [
			/\banti[- ]money[- ]laundering\b/i,
			/\bAML\s+(?:program|policy|compliance)/i,
			/\bknow\s+your\s+customer\b/i,
			/\bsuspicious\s+activity\s+report\b/i,
			/\bbeneficial\s+owner\w*\b/i
		],
		concern:
			'Covered financial institutions must maintain a written programme with specified minimum elements and reporting triggers.',
		lookup: 'anti-money laundering program requirements financial institutions',
		title: 31
	}),
	rule({
		id: 'privileged-advice',
		topic: 'Written tax advice standards',
		severity: 'medium',
		patterns: [
			/\bmore\s+likely\s+than\s+not\b/i,
			/\bsubstantial\s+authority\b/i,
			/\breasonable\s+basis\b/i,
			/\bpenalty\s+protection\b/i,
			/\btax\s+opinion\b/i
		],
		concern:
			'Confidence levels are terms of art tied to penalty relief. Written advice relying on them must meet the practice standards for competence and factual assumptions.',
		lookup: 'requirements for written advice practice before the Internal Revenue Service',
		title: 31
	})
];

export interface RuleMatch {
	rule: ReviewRule;
	/** The sentence the pattern landed in, trimmed for display. */
	quote: string;
	/** Character offset of the match, for stable ordering. */
	offset: number;
}

const MAX_QUOTE_CHARS = 320;

/**
 * Is the character at `index` the end of a sentence?
 *
 * A full stop inside a citation is not — "26 CFR 1.162-1" and "$1,250.00"
 * both carry stops that must not split a quote. Requiring a non-digit after
 * the stop settles every case that appears in this kind of document.
 */
function isTerminator(text: string, index: number): boolean {
	const char = text[index];
	if (char === '\n' || char === '!' || char === '?') return true;
	if (char !== '.') return false;
	const next = text[index + 1];
	return next === undefined || !/[\d)]/.test(next);
}

/** The sentence containing `index`, trimmed to a quotable length. */
function sentenceBounds(text: string, index: number): { start: number; end: number } {
	let start = 0;
	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		if (isTerminator(text, cursor)) {
			start = cursor + 1;
			break;
		}
	}

	let end = text.length;
	for (let cursor = index; cursor < text.length; cursor += 1) {
		if (isTerminator(text, cursor)) {
			end = cursor + 1;
			break;
		}
	}

	// A run-on paragraph still has to fit on a card; centre on the match.
	if (end - start > MAX_QUOTE_CHARS) {
		start = Math.max(start, index - Math.floor(MAX_QUOTE_CHARS / 2));
		end = Math.min(end, index + Math.ceil(MAX_QUOTE_CHARS / 2));
	}
	return { start, end };
}

/**
 * Run the pack over a document. One finding per rule — a memo that says
 * "independent contractor" nine times has one classification issue, not nine.
 */
export function scanDocument(text: string, rules: ReviewRule[] = REVIEW_RULES): RuleMatch[] {
	const matches: RuleMatch[] = [];

	for (const rule of rules) {
		let best: RuleMatch | undefined;
		for (const pattern of rule.patterns) {
			const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
			const scanner = new RegExp(pattern.source, flags);
			const match = scanner.exec(text);
			if (!match) continue;
			if (best && match.index >= best.offset) continue;
			const { start, end } = sentenceBounds(text, match.index);
			best = {
				rule,
				quote: text.slice(start, end).replace(/\s+/g, ' ').trim(),
				offset: match.index
			};
		}
		if (best) matches.push(best);
	}

	const severityRank: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
	return matches.sort(
		(a, b) => severityRank[a.rule.severity] - severityRank[b.rule.severity] || a.offset - b.offset
	);
}
