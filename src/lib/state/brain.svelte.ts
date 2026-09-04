/**
 * What Verity knows, and what she can do.
 *
 * Two separate ideas that a settings panel tends to blur together:
 *
 *  - **Knowledge** is standing context about the person's own practice. It is
 *    not instruction; it is background the answer should be shaped around.
 *  - **A skill** is a named instruction she follows when it applies, plus the
 *    tool packs it needs. Toggling one off does not just stop mentioning it —
 *    the tools it owns are not mounted for that turn.
 *
 * Both are the user's, so both live in their browser and travel with a turn
 * rather than being stored anywhere.
 */

import { browser } from '$app/environment';

export interface Skill {
	id: string;
	name: string;
	/** What she should do when this skill applies. Written by the user. */
	instructions: string;
	enabled: boolean;
	/** Built-ins cannot be deleted, only switched off. */
	builtin?: boolean;
	/** Tool packs this skill needs mounted. Empty means prompt-only. */
	packs?: readonly PackId[];
}

/** The tool-owning plugins a skill can require. */
export type PackId = 'ecfr' | 'federal-register' | 'review' | 'critic';

export const PACKS: Record<PackId, { name: string; detail: string }> = {
	ecfr: {
		name: 'Code of Federal Regulations',
		detail: 'Search and read the current text of the CFR.'
	},
	'federal-register': {
		name: 'Federal Register',
		detail: 'Proposed and final rules, effective dates, comment deadlines.'
	},
	review: {
		name: 'Document review',
		detail: 'Scan a loaded document for passages carrying a regulatory exposure.'
	},
	critic: {
		name: 'Second opinion',
		detail: 'A separate model call that reads the answer back before you see it.'
	}
};

const BUILTIN: Skill[] = [
	{
		id: 'currency',
		name: 'Check whether it still holds',
		builtin: true,
		enabled: true,
		packs: ['federal-register'],
		instructions:
			'When the user relies on a treatment from a prior year, or asks whether something is still true, check the Federal Register for rule-making on it before answering — and say plainly when nothing has changed.'
	},
	{
		id: 'review',
		name: 'Review documents like a reviewer',
		builtin: true,
		enabled: true,
		packs: ['review', 'ecfr'],
		instructions:
			'When a document is loaded, review it before anything else. Report the findings in the order a reviewer would raise them — exposure first, tidy-ups last — and verify the significant ones against the regulation before you characterise them.'
	},
	{
		id: 'plain-english',
		name: 'Answer in plain English',
		builtin: true,
		enabled: true,
		instructions:
			'Lead with the answer in the user’s own words, then the citation that supports it. Do not open with a restatement of the question, and do not pad with what you are about to do.'
	},
	{
		id: 'critic',
		name: 'Check her own answer before showing it',
		builtin: true,
		enabled: true,
		packs: ['critic'],
		instructions:
			'Before an answer is shown, it is read back against what the tools actually returned. Anything asserted that the lookups do not support is corrected first. Costs one extra model call per answer.'
	},
	{
		id: 'show-workings',
		name: 'Name what you could not settle',
		builtin: true,
		enabled: true,
		instructions:
			'End an answer that rests on something you could not verify by saying so in one sentence — which part, and what would settle it. Never let an unverified step pass as a verified one.'
	}
];

const KNOWLEDGE_KEY = 'regassist.knowledge';
const SKILLS_KEY = 'regassist.skills';

function read(key: string): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null): void {
	if (!browser) return;
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Storage disabled. The session still works, it just will not persist.
	}
}

/** Merge stored state onto the built-ins, so a new built-in appears for everyone. */
function restoreSkills(): Skill[] {
	const raw = read(SKILLS_KEY);
	if (!raw) return BUILTIN.map((skill) => ({ ...skill }));

	try {
		const stored = JSON.parse(raw) as Skill[];
		const byId = new Map(stored.map((skill) => [skill.id, skill]));
		const merged = BUILTIN.map((skill) => ({
			...skill,
			enabled: byId.get(skill.id)?.enabled ?? skill.enabled,
			// A built-in's wording is ours to change; only the toggle is theirs.
			instructions: skill.instructions
		}));
		const custom = stored.filter((skill) => !skill.builtin && skill.id && skill.name);
		return [...merged, ...custom];
	} catch {
		return BUILTIN.map((skill) => ({ ...skill }));
	}
}

export const MAX_KNOWLEDGE_CHARS = 4000;
export const MAX_SKILL_CHARS = 1200;

let counter = 0;

class BrainState {
	knowledge = $state<string>(read(KNOWLEDGE_KEY) ?? '');
	skills = $state<Skill[]>(restoreSkills());

	readonly active = $derived(this.skills.filter((skill) => skill.enabled));

	/** Tool packs to mount for the next turn. */
	readonly packs = $derived.by(() => {
		const enabled = new Set<PackId>();
		for (const skill of this.skills) {
			if (!skill.enabled) continue;
			for (const pack of skill.packs ?? []) enabled.add(pack);
		}
		// The CFR is the point of the app; it is never switched off by accident.
		enabled.add('ecfr');
		return [...enabled];
	});

	setKnowledge(value: string): void {
		this.knowledge = value.slice(0, MAX_KNOWLEDGE_CHARS);
		write(KNOWLEDGE_KEY, this.knowledge || null);
	}

	#persist(): void {
		write(SKILLS_KEY, JSON.stringify(this.skills));
	}

	toggle(id: string): void {
		const skill = this.skills.find((candidate) => candidate.id === id);
		if (!skill) return;
		skill.enabled = !skill.enabled;
		this.#persist();
	}

	addSkill(name: string, instructions: string): Skill | null {
		const trimmedName = name.trim().slice(0, 80);
		const trimmedInstructions = instructions.trim().slice(0, MAX_SKILL_CHARS);
		if (!trimmedName || !trimmedInstructions) return null;

		const skill: Skill = {
			id: `custom-${Date.now()}-${(counter += 1)}`,
			name: trimmedName,
			instructions: trimmedInstructions,
			enabled: true
		};
		this.skills.push(skill);
		this.#persist();
		return skill;
	}

	updateSkill(id: string, name: string, instructions: string): void {
		const skill = this.skills.find((candidate) => candidate.id === id);
		if (!skill || skill.builtin) return;
		skill.name = name.trim().slice(0, 80);
		skill.instructions = instructions.trim().slice(0, MAX_SKILL_CHARS);
		this.#persist();
	}

	removeSkill(id: string): void {
		this.skills = this.skills.filter((skill) => skill.builtin || skill.id !== id);
		this.#persist();
	}

	/** The shape a turn sends to the server. */
	payload() {
		return {
			knowledge: this.knowledge.trim(),
			skills: this.active.map((skill) => ({
				name: skill.name,
				instructions: skill.instructions
			})),
			packs: this.packs
		};
	}
}

export const brain = new BrainState();
