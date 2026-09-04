/**
 * Shared request plumbing.
 *
 * This app is bring-your-own-key: the caller's OpenAI key arrives on each
 * request, is used for that request, and is never written to disk, a log, a
 * database or an error message. There is no server-side session for it to
 * leak into, which is the main reason the auth and database scaffolding came
 * out of the project.
 */

import { error } from '@sveltejs/kit';
import { MAX_DOCUMENT_CHARS, type StoredDocument } from '$lib/plugins';

export const KEY_HEADER = 'x-openai-key';

/** Pull the caller's key off the request, or refuse the request. */
export function requireApiKey(request: Request): string {
	const key = request.headers.get(KEY_HEADER)?.trim();
	if (!key) {
		error(401, 'No OpenAI API key was supplied. Add your key in the app and try again.');
	}
	if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) {
		error(401, 'That does not look like an OpenAI API key. Keys start with "sk-".');
	}
	return key;
}

const MAX_DOCUMENTS = 8;

/** Validate the documents a client sent alongside its turn. */
export function parseDocuments(raw: unknown): StoredDocument[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) error(400, 'documents must be an array.');
	if (raw.length > MAX_DOCUMENTS) error(400, `At most ${MAX_DOCUMENTS} documents per request.`);

	return raw.map((entry, index) => {
		if (typeof entry !== 'object' || entry === null) {
			error(400, `documents[${index}] must be an object.`);
		}
		const { id, name, text, kind } = entry as Record<string, unknown>;
		if (typeof id !== 'string' || !id) error(400, `documents[${index}].id must be a string.`);
		if (typeof name !== 'string' || !name) error(400, `documents[${index}].name must be a string.`);
		if (typeof text !== 'string') error(400, `documents[${index}].text must be a string.`);
		return {
			id,
			name: name.slice(0, 200),
			text: text.slice(0, MAX_DOCUMENT_CHARS),
			kind: kind === 'file' ? 'file' : 'paste'
		} satisfies StoredDocument;
	});
}

const PACK_IDS = ['ecfr', 'federal-register', 'review', 'critic'] as const;
type PackId = (typeof PACK_IDS)[number];

export interface BrainPayload {
	knowledge: string;
	skills: { name: string; instructions: string }[];
	packs: PackId[];
}

const MAX_SKILLS = 24;

/** Validate the knowledge and skills a client sent with its turn. */
export function parseBrain(raw: unknown): BrainPayload {
	const empty: BrainPayload = { knowledge: '', skills: [], packs: [...PACK_IDS] };
	if (raw === undefined || raw === null) return empty;
	if (typeof raw !== 'object' || Array.isArray(raw)) error(400, 'brain must be an object.');

	const { knowledge, skills, packs } = raw as Record<string, unknown>;

	const parsedSkills = Array.isArray(skills)
		? skills.slice(0, MAX_SKILLS).flatMap((entry) => {
				if (typeof entry !== 'object' || entry === null) return [];
				const { name, instructions } = entry as Record<string, unknown>;
				if (typeof name !== 'string' || typeof instructions !== 'string') return [];
				if (!name.trim() || !instructions.trim()) return [];
				return [{ name: name.slice(0, 120), instructions: instructions.slice(0, 2000) }];
			})
		: [];

	const parsedPacks = Array.isArray(packs)
		? PACK_IDS.filter((pack) => packs.includes(pack))
		: [...PACK_IDS];

	return {
		knowledge: typeof knowledge === 'string' ? knowledge.slice(0, 8000) : '',
		skills: parsedSkills,
		packs: parsedPacks.length ? parsedPacks : ['ecfr']
	};
}

/** Turn any thrown value into a message safe to show a user. */
export function describeError(cause: unknown): string {
	if (cause instanceof Error) return cause.message;
	return 'Something went wrong handling that request.';
}
