<script lang="ts">
	/**
	 * An icon that changes when you change it.
	 *
	 * `@hugeicons/svelte`'s own component reads its `icon` prop once, inside
	 * `onMount`, and its update path only forwards size, colour and class — so
	 * an icon swapped for another after the first render never changes. Keying
	 * on the icon remounts the svg when, and only when, the glyph actually
	 * changes, so a static icon costs nothing and a dynamic one is correct.
	 *
	 * Everything in the app goes through here: there is no way to tell from a
	 * call site whether its icon will ever change, and the cheapest way not to
	 * get that wrong is not to have to decide.
	 *
	 * (Carried over from the Rowbot codebase, where this bug was found.)
	 */
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import type { ComponentProps } from 'svelte';

	let { icon, ...rest }: ComponentProps<typeof HugeiconsIcon> = $props();
</script>

{#key icon}
	<HugeiconsIcon {icon} {...rest} />
{/key}
