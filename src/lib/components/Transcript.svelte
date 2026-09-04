<script lang="ts">
	/** The shared thread: typed turns, spoken turns, and the cards between them. */
	import ToolCard from './ToolCard.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { conversation } from '$lib/state/conversation.svelte';

	let scroller = $state<HTMLDivElement | null>(null);
	let pinned = $state(true);

	/** Stop yanking the view down when the reader has scrolled up to re-read. */
	function onScroll() {
		if (!scroller) return;
		const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		pinned = distance < 80;
	}

	$effect(() => {
		// Touching the entries makes this re-run as the turn streams in.
		conversation.entries.length;
		const last = conversation.entries.at(-1);
		if (last?.kind === 'assistant') last.text.length;
		if (!pinned || !scroller) return;
		scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
	});
</script>

<div class="scroller" bind:this={scroller} onscroll={onScroll}>
	<div class="thread">
		{#each conversation.entries as entry (entry.id)}
			{#if entry.kind === 'user'}
				<div class="row user">
					<p class="bubble">{entry.text}</p>
					{#if entry.source === 'voice'}<span class="via">spoken</span>{/if}
				</div>
			{:else if entry.kind === 'assistant'}
				<div class="row assistant" class:streaming={entry.streaming}>
					<div class="prose">
						{@html renderMarkdown(entry.text)}
					</div>
					{#if entry.streaming && !entry.text}
						<span class="thinking" aria-label="Verity is thinking">
							<i></i><i></i><i></i>
						</span>
					{/if}
				</div>
			{:else if entry.kind === 'tool'}
				<ToolCard {entry} />
			{:else}
				<p class="notice" data-tone={entry.tone}>{entry.text}</p>
			{/if}
		{/each}
	</div>
</div>

<style>
	.scroller {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 4px 2px 8px;
	}

	.thread {
		display: grid;
		gap: 16px;
		align-content: start;
	}

	.row {
		display: grid;
		gap: 4px;
		animation: rise 320ms var(--ease) both;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.user {
		justify-items: end;
	}

	.bubble {
		margin: 0;
		max-width: min(46ch, 88%);
		background: var(--ink);
		color: var(--paper);
		padding: 10px 15px;
		border-radius: 18px 18px 5px 18px;
		font-size: 14.5px;
		line-height: 1.5;
		box-shadow: var(--shadow-card);
	}

	.via {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.prose {
		font-size: 15px;
		line-height: 1.65;
		color: var(--ink);
		max-width: 66ch;
		overflow-wrap: anywhere;
	}

	.prose :global(p) {
		margin: 0 0 0.7em;
	}

	.prose :global(p:last-child) {
		margin-bottom: 0;
	}

	.prose :global(strong) {
		font-weight: 660;
	}

	/* Tailwind's reset strips list markers; prose is where we want them back. */
	.prose :global(ul),
	.prose :global(ol) {
		margin: 0.2em 0 0.8em;
		padding-left: 1.35em;
		display: grid;
		gap: 0.3em;
	}

	.prose :global(ul) {
		list-style: disc;
	}

	.prose :global(ol) {
		list-style: decimal;
	}

	.prose :global(li) {
		padding-left: 0.15em;
	}

	.prose :global(li::marker) {
		color: var(--muted);
	}

	.prose :global(code) {
		font-size: 0.9em;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 1px 5px;
	}

	.prose :global(a) {
		color: var(--accent);
		text-underline-offset: 2px;
	}

	.prose :global(h3),
	.prose :global(h4) {
		font-size: 15px;
		font-weight: 680;
		letter-spacing: -0.01em;
		margin: 1em 0 0.4em;
	}

	/* A caret while the answer is still arriving. */
	.streaming .prose :global(p:last-child)::after {
		content: '';
		display: inline-block;
		width: 2px;
		height: 1em;
		margin-left: 2px;
		vertical-align: -2px;
		background: var(--accent);
		animation: blink 1s steps(2, start) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.thinking {
		display: inline-flex;
		gap: 5px;
	}

	.thinking i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--muted);
		animation: bounce 1.1s ease-in-out infinite;
	}

	.thinking i:nth-child(2) {
		animation-delay: 0.15s;
	}
	.thinking i:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		30% {
			transform: translateY(-4px);
			opacity: 1;
		}
	}

	.notice {
		margin: 0;
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		font-size: 13.5px;
		line-height: 1.5;
		background: color-mix(in srgb, var(--severity-high) 8%, white);
		border: 1px solid color-mix(in srgb, var(--severity-high) 22%, transparent);
		color: color-mix(in srgb, var(--severity-high) 80%, black);
	}

	.notice[data-tone='info'] {
		background: var(--accent-soft);
		border-color: color-mix(in srgb, var(--accent) 22%, transparent);
		color: var(--accent);
	}
</style>
