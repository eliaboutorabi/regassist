import { describe, expect, it } from 'vitest';
import { PRINTER_FLOOR, printerEnvelope } from './printer-envelope.js';

describe('printerEnvelope', () => {
	const samples = Array.from({ length: 4000 }, (_, index) => printerEnvelope(index / 60));

	it('stays inside the range the character accepts', () => {
		for (const value of samples) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});

	it('never drops to zero, so the paper keeps feeding between beats', () => {
		expect(Math.min(...samples)).toBeGreaterThanOrEqual(PRINTER_FLOOR);
	});

	it('actually varies, so the mouth reads as movement rather than a held pose', () => {
		const peak = Math.max(...samples);
		expect(peak - PRINTER_FLOOR).toBeGreaterThan(0.2);
		expect(new Set(samples.map((value) => value.toFixed(2))).size).toBeGreaterThan(20);
	});

	it('is a pure function of time', () => {
		expect(printerEnvelope(12.5)).toBe(printerEnvelope(12.5));
	});
});
