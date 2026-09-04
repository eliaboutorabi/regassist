/**
 * Type surface for the vendored Verity robot.
 *
 * The implementation is plain JavaScript carried over verbatim from the
 * original prototype (see VENDOR.md), so its option types would otherwise be
 * inferred from default values — `appearance` would narrow to `"classic"`
 * and `renderer` to `null`. This file states the real contract, exactly as
 * documented in README.md, without editing vendored code.
 */

import type { Camera, Group, Object3D, WebGLRenderer } from 'three';

export type VerityAppearance = 'classic' | 'rose';
export type VerityMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface VerityRobotOptions {
	/** Lets the receipt texture use the device's maximum anisotropy. */
	renderer?: WebGLRenderer | null;
	appearance?: VerityAppearance;
	accent?: string;
	scale?: number;
	reducedMotion?: boolean;
}

export interface VerityState {
	mode: VerityMode;
	audioLevel: number;
	paperProgress: number;
	printedTranscript: string;
	receiptLines: { id: number; text: string; feedPosition: number }[];
}

export class VerityRobot {
	constructor(options?: VerityRobotOptions);

	readonly object3d: Group;
	readonly root: Group;
	readonly mouth: Object3D;

	paperProgress: number;
	paperFeedDistance: number;
	paperPathLength: number;
	paperTextTravel: number;
	printedTranscript: string;
	pendingReceiptText: string;
	receiptLines: { id: number; text: string; feedPosition: number }[];

	setMode(mode: VerityMode): void;
	/** Mouth amplitude and paper flutter. Call every audio-analysis frame. */
	setAudioLevel(level: number): void;
	/** Keep true while output is genuinely audible, not merely in progress. */
	setOutputAudioActive(active: boolean): void;
	beginResponse(): void;
	appendTranscript(delta: string): void;
	clearTranscript(): void;
	setDragRotation(pitch: number, yaw: number): void;
	resetRotation(): void;
	update(time: number, deltaTime: number): void;
	getState(): VerityState;
	dispose(): void;
}

export const VERITY_APPEARANCES: readonly VerityAppearance[];
export const VERITY_MODES: readonly VerityMode[];
export const VERITY_DEFAULTS: Readonly<Record<string, unknown>>;

export interface PointerControlOptions {
	maxPitch?: number;
	maxYaw?: number;
	damping?: number;
}

/** Gentle pointer following on desktop, drag rotation on touch. */
export function attachVerityPointerControls(
	element: HTMLElement,
	robot: VerityRobot,
	options?: PointerControlOptions
): () => void;

export function attachVerityDragControls(
	element: HTMLElement,
	robot: VerityRobot,
	options?: PointerControlOptions
): () => void;

export function createVerityStudioLights(options?: Record<string, unknown>): Group;

export function frameVerityCamera(camera: Camera, aspect?: number): void;
