<script lang="ts">
	/**
	 * The robot's home on screen.
	 *
	 * This component owns the renderer, camera, lights and animation loop; the
	 * character itself owns nothing but its own geometry and motion. Everything
	 * the robot reacts to arrives as a prop or through the exported methods, so
	 * the voice session and the text agent drive it the same way.
	 */
	import * as THREE from 'three';
	import {
		VerityRobot,
		attachVerityPointerControls,
		createVerityStudioLights
	} from '$lib/robot/index.js';
	import { CHARACTERS, type CharacterId } from '$lib/voices';
	import { printerEnvelope } from './printer-envelope.js';

	interface Props {
		character: CharacterId;
		mode: 'idle' | 'listening' | 'thinking' | 'speaking';
		audioLevel?: number;
		audible?: boolean;
		/**
		 * Text mode has no waveform, but the receipt only advances while output
		 * is audible. Setting this synthesises a printer-like envelope so a typed
		 * answer prints onto the paper exactly as a spoken one does.
		 */
		printing?: boolean;
	}

	let {
		character,
		mode,
		audioLevel = 0,
		audible = false,
		printing = false
	}: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let robot: VerityRobot | null = null;
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let detachPointer: (() => void) | null = null;
	/** Flips once the scene exists, which is what gates the character effect. */
	let ready = $state(false);

	/**
	 * Props mirrored into plain locals.
	 *
	 * The render loop is a long-lived requestAnimationFrame closure rather than
	 * a reactive context, so it reads these rather than the props directly —
	 * one obvious place where the current frame's inputs come from, instead of
	 * relying on how prop access behaves inside a captured callback.
	 */
	const inputs = { level: 0, audible: false, printing: false };

	/**
	 * How the camera is placed.
	 *
	 * The vendored `frameVerityCamera` puts the camera at a fixed distance, which
	 * is right for the square-ish phone frame it was written for and wrong
	 * everywhere else — in a tall column it crops her legs, in a short band it
	 * crops her head. Measuring the character once and fitting to those bounds
	 * makes the framing correct at any shape, and leaves room above her for the
	 * receipt, which grows as she talks.
	 */
	let bounds: { center: THREE.Vector3; size: THREE.Vector3 } | null = null;

	/** Breathing room around the character, as a multiple of the fitted distance. */
	const FRAME_PADDING = 1.14;

	function measure(character: VerityRobot): void {
		const box = new THREE.Box3().setFromObject(character.object3d);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());

		// Headroom for the paper, and a nudge down so she sits slightly low in
		// frame — which reads as standing on something rather than floating.
		const headroom = size.y * 0.3;
		size.y += headroom;
		center.y += headroom * 0.32;

		bounds = { center, size };
	}

	function fitCamera(camera: THREE.PerspectiveCamera, aspect: number): void {
		camera.aspect = aspect;
		if (!bounds) {
			camera.updateProjectionMatrix();
			return;
		}

		const { center, size } = bounds;
		const halfFov = (camera.fov * Math.PI) / 360;
		const forHeight = size.y / 2 / Math.tan(halfFov);
		const forWidth = size.x / 2 / Math.tan(halfFov) / aspect;

		camera.position.set(center.x, center.y, center.z + Math.max(forHeight, forWidth) * FRAME_PADDING);
		camera.lookAt(center);
		camera.updateProjectionMatrix();
	}

	$effect(() => {
		inputs.level = audioLevel;
		inputs.audible = audible;
		inputs.printing = printing;
	});

	/** Buffered while the scene boots, so no transcript text is dropped. */
	const queued: string[] = [];

	export function beginResponse(): void {
		if (robot) robot.beginResponse();
	}

	export function appendTranscript(delta: string): void {
		if (robot) robot.appendTranscript(delta);
		else queued.push(delta);
	}

	export function clearTranscript(): void {
		queued.length = 0;
		robot?.clearTranscript();
	}

	/** A snapshot of the character's animation state, for tests and debugging. */
	export function debugState() {
		if (!robot) return null;
		return {
			...robot.getState(),
			inputs: { ...inputs },
			outputAudioActive: (robot as unknown as { outputAudioActive: boolean }).outputAudioActive,
			paperFeedDistance: robot.paperFeedDistance,
			paperProgress: robot.paperProgress
		};
	}

	$effect(() => {
		if (!canvas) return;

		const world = new THREE.Scene();
		const view = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
		camera = view;
		world.add(createVerityStudioLights());
		scene = world;

		const gl = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		gl.outputColorSpace = THREE.SRGBColorSpace;
		// Capping at 2 keeps a 3× phone from rendering four times the pixels for
		// a difference nobody can see on a character this soft.
		gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		gl.shadowMap.enabled = true;
		gl.shadowMap.type = THREE.PCFSoftShadowMap;
		gl.toneMapping = THREE.ACESFilmicToneMapping;
		gl.toneMappingExposure = 0.98;
		renderer = gl;

		let frame = 0;
		let previous = performance.now();

		const resize = () => {
			const width = Math.max(1, Math.floor(canvas!.clientWidth));
			const height = Math.max(1, Math.floor(canvas!.clientHeight));
			const ratio = gl.getPixelRatio();
			if (
				canvas!.width === Math.floor(width * ratio) &&
				canvas!.height === Math.floor(height * ratio)
			) {
				return;
			}
			gl.setSize(width, height, false);
			fitCamera(view, width / height);
		};

		const animate = (now: number) => {
			frame = requestAnimationFrame(animate);
			resize();
			const delta = Math.min((now - previous) / 1000, 0.05);
			previous = now;

			if (robot) {
				if (inputs.printing) {
					robot.setAudioLevel(printerEnvelope(now / 1000));
					robot.setOutputAudioActive(true);
				} else {
					robot.setAudioLevel(inputs.level);
					robot.setOutputAudioActive(inputs.audible);
				}
				robot.update(now / 1000, delta);
			}
			gl.render(world, view);
		};

		frame = requestAnimationFrame(animate);
		ready = true;

		return () => {
			cancelAnimationFrame(frame);
			detachPointer?.();
			detachPointer = null;
			robot?.dispose();
			robot = null;
			gl.dispose();
			renderer = null;
			scene = null;
			camera = null;
			bounds = null;
			ready = false;
		};
	});

	// Swapping characters rebuilds the character but not the scene around it.
	$effect(() => {
		const appearance = CHARACTERS[character].appearance;
		if (!ready || !renderer || !scene || !canvas) return;

		const next = new VerityRobot({ renderer, appearance });
		scene.add(next.object3d);
		robot = next;
		detachPointer = attachVerityPointerControls(canvas, next);

		// Measure before the first frame moves her, then reframe — until a
		// character existed there was nothing to fit the camera to.
		measure(next);
		if (camera) {
			fitCamera(camera, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight));
		}

		// Anything the transport said while the scene was booting still prints.
		for (const delta of queued.splice(0)) next.appendTranscript(delta);

		return () => {
			detachPointer?.();
			detachPointer = null;
			next.dispose();
			if (robot === next) robot = null;
		};
	});

	$effect(() => {
		robot?.setMode(mode);
	});

</script>

<div class="stage" data-mode={mode}>
	<div class="glow" aria-hidden="true"></div>
	<canvas bind:this={canvas} aria-label="Verity, an animated calculator robot"></canvas>
</div>

<style>
	.stage {
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		min-height: 0;
	}

	canvas {
		position: relative;
		z-index: 1;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	/*
	 * A pool of light on the ground rather than a panel behind her: warm, wide,
	 * and slightly stronger while she is speaking.
	 */
	.glow {
		position: absolute;
		left: 50%;
		bottom: 6%;
		width: 78%;
		height: 34%;
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(
			closest-side,
			color-mix(in srgb, var(--accent) 22%, white) 0%,
			color-mix(in srgb, var(--accent) 8%, white) 45%,
			transparent 78%
		);
		opacity: 0.5;
		filter: blur(14px);
		transition: opacity 600ms var(--ease);
	}

	/* The contact shadow that stops her floating in nothing. */
	.stage::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 9%;
		width: 44%;
		height: 5%;
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(closest-side, rgba(18, 22, 47, 0.22), transparent 72%);
		filter: blur(7px);
		pointer-events: none;
	}

	.stage[data-mode='speaking'] .glow {
		opacity: 0.9;
	}

	.stage[data-mode='listening'] .glow {
		opacity: 0.68;
	}
</style>
