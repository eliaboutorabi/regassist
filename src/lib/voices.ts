/** The two Verity characters, and the voice each one speaks with. */
export const CHARACTERS = {
	classic: {
		id: 'classic',
		appearance: 'classic',
		displayName: 'Verity',
		voice: 'cedar',
		blurb: 'Grounded and quietly confident.',
		style: 'Speak in a grounded, warm, quietly confident register.'
	},
	rose: {
		id: 'rose',
		appearance: 'rose',
		displayName: 'Rosie',
		voice: 'marin',
		blurb: 'Bright and gently playful.',
		style: 'Speak in a bright, warm, gently playful register.'
	}
} as const;

export type CharacterId = keyof typeof CHARACTERS;

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

export function isCharacterId(value: unknown): value is CharacterId {
	return typeof value === 'string' && value in CHARACTERS;
}

/** The realtime model the voice session runs on. */
export const REALTIME_MODEL = 'gpt-realtime-2';
