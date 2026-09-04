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
		createVerityStudioLights,
		frameVerityCamera
	} from '$lib/robot/index.js';
	import { CHARACTERS, type CharacterId } from '$lib/voices';

	interface Props {
		character: CharacterId;
		mode: 'idle' | 'listening' | 'thinking' | 'speaking';
		audioLevel?: number;
		audible?: boolean;
	}

	let { character, mode, audioLevel = 0, audible = false }: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let robot: VerityRobot | null = null;
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let detachPointer: (() => void) | null = null;
	/** Flips once the scene exists, which is what gates the character effect. */
	let ready = $state(false);

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

	$effect(() => {
		if (!canvas) return;

		const world = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
		frameVerityCamera(camera);
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
			frameVerityCamera(camera, width / height);
		};

		const animate = (now: number) => {
			frame = requestAnimationFrame(animate);
			resize();
			const delta = Math.min((now - previous) / 1000, 0.05);
			previous = now;
			robot?.update(now / 1000, delta);
			gl.render(world, camera);
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

	$effect(() => {
		robot?.setAudioLevel(audioLevel);
		robot?.setOutputAudioActive(audible);
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

	/* A soft pool of light that warms slightly while Verity is speaking. */
	.glow {
		position: absolute;
		inset: 8% 12% 14%;
		border-radius: 50%;
		background: radial-gradient(
			circle at 50% 42%,
			color-mix(in srgb, var(--accent) 16%, white) 0%,
			rgba(255, 255, 255, 0.55) 42%,
			transparent 70%
		);
		opacity: 0.55;
		filter: blur(6px);
		transition: opacity 600ms var(--ease);
	}

	.stage[data-mode='speaking'] .glow {
		opacity: 0.95;
	}

	.stage[data-mode='listening'] .glow {
		opacity: 0.75;
	}
</style>
