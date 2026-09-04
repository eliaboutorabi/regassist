/**
 * The amplitude a typed answer feeds the robot with.
 *
 * The character only advances its receipt while it believes output is audible,
 * which is the right contract for a voice assistant and leaves text mode with
 * nothing to print. Rather than teach the vendored character about a mode it
 * has no concept of, text mode synthesises an envelope: the paper feeds, the
 * transcript prints, and the mouth moves as if Verity were reading the answer
 * out — which is what it looks like she is doing.
 *
 * Two detuned sines read as a mechanism running rather than a pulse, and the
 * floor keeps the paper moving between beats instead of stuttering.
 */
export const PRINTER_FLOOR = 0.12;

export function printerEnvelope(seconds: number): number {
	const wobble = 0.28 + 0.16 * Math.sin(seconds * 11.4) + 0.1 * Math.sin(seconds * 4.7 + 1.3);
	return Math.min(1, Math.max(PRINTER_FLOOR, wobble));
}
