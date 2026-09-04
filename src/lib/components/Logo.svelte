<script lang="ts">
	/**
	 * Verity in miniature.
	 *
	 * The character reduced to the four things that identify her — the rounded
	 * body, the receipt tab, the screen with its face, and the one accented
	 * key. It follows the live accent, so the mark changes with the character.
	 */
	let { size = 28, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 64 64"
	class={className}
	role="img"
	aria-label="Verity"
>
	<!-- Receipt tab, behind the body. -->
	<rect x="23" y="3" width="18" height="11" rx="3" class="paper" />
	<rect x="7" y="10" width="50" height="50" rx="15" class="body" />
	<rect x="14" y="17" width="36" height="15" rx="6" class="screen" />
	<ellipse cx="24" cy="24" rx="3.1" ry="3.4" class="eye" />
	<ellipse cx="40" cy="24" rx="3.1" ry="3.4" class="eye" />
	<path
		d="M28.6 27.4a5.2 5.2 0 0 0 6.8 0"
		class="smile"
		fill="none"
		stroke-width="2.1"
		stroke-linecap="round"
	/>
	<rect x="15" y="37" width="14" height="7" rx="2.8" class="key" />
	<rect x="35" y="37" width="14" height="7" rx="2.8" class="key" />
	<rect x="15" y="47" width="14" height="7" rx="2.8" class="key" />
	<rect x="35" y="47" width="14" height="7" rx="2.8" class="key accent" />
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}

	.paper {
		fill: color-mix(in srgb, var(--ink) 12%, white);
	}

	.body {
		fill: var(--ink);
	}

	.screen {
		fill: color-mix(in srgb, var(--ink) 55%, black);
	}

	.eye {
		fill: var(--paper);
	}

	.smile {
		stroke: var(--paper);
	}

	.key {
		fill: color-mix(in srgb, var(--paper) 32%, var(--ink));
	}

	.key.accent {
		fill: var(--accent);
	}
</style>
