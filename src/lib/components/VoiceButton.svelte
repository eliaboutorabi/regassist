<script lang="ts">
	/** The one control that matters: start talking, or stop. */
	import type { VoiceStatus } from '$lib/client/voice';

	interface Props {
		status: VoiceStatus;
		active: boolean;
		level?: number;
		disabled?: boolean;
		onclick: () => void;
	}

	let { status, active, level = 0, disabled = false, onclick }: Props = $props();

	const label = $derived(
		status === 'connecting'
			? 'Connecting…'
			: status === 'listening'
				? 'Listening'
				: status === 'thinking'
					? 'Thinking'
					: status === 'speaking'
						? 'Speaking'
						: active
							? 'End conversation'
							: 'Talk to Verity'
	);

	// A ring that breathes with Verity's own voice while she is speaking.
	const ring = $derived(status === 'speaking' ? 1 + level * 0.5 : 1);
</script>

<button
	class="mic"
	type="button"
	{onclick}
	{disabled}
	data-status={status}
	aria-pressed={active}
	aria-label={active ? 'End the voice conversation' : 'Start a voice conversation'}
>
	<span class="halo" aria-hidden="true" style="--ring: {ring}"></span>
	<span class="glyph" aria-hidden="true">
		{#if active}
			<span class="square"></span>
		{:else}
			<svg viewBox="0 0 24 24">
				<path
					d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Z"
					fill="currentColor"
				/>
				<path
					d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
		{/if}
	</span>
	<span class="label">{label}</span>
</button>

<style>
	.mic {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 11px;
		border: 0;
		border-radius: 999px;
		padding: 13px 26px 13px 18px;
		background: var(--ink);
		color: var(--paper);
		font-size: 15px;
		font-weight: 620;
		letter-spacing: -0.01em;
		cursor: pointer;
		box-shadow: var(--shadow-float);
		transition:
			background 220ms var(--ease),
			transform 180ms var(--ease),
			opacity 180ms var(--ease);
	}

	.mic:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.mic:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.mic[data-status='listening'],
	.mic[data-status='speaking'],
	.mic[data-status='thinking'] {
		background: var(--accent);
	}

	.mic[data-status='error'] {
		background: var(--severity-high);
	}

	.halo {
		position: absolute;
		inset: -3px;
		border-radius: inherit;
		border: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
		opacity: 0;
		transform: scale(var(--ring, 1));
		transition:
			opacity 240ms var(--ease),
			transform 90ms linear;
		pointer-events: none;
	}

	.mic[data-status='speaking'] .halo {
		opacity: 0.9;
	}

	.mic[data-status='listening'] .halo {
		opacity: 0.55;
		animation: breathe 2.4s ease-in-out infinite;
	}

	.mic[data-status='connecting'] .halo {
		opacity: 0.7;
		animation: breathe 1s ease-in-out infinite;
	}

	@keyframes breathe {
		50% {
			transform: scale(1.06);
			opacity: 0.25;
		}
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
	}

	svg {
		width: 22px;
		height: 22px;
	}

	.square {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: currentColor;
	}

	.label {
		white-space: nowrap;
	}
</style>
