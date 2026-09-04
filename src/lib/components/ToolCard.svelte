<script lang="ts">
	/**
	 * One tool call, rendered as a card.
	 *
	 * The card kind comes from the tool's own pure presenter, so a tool decides
	 * how it looks without importing anything from the UI, and the same card
	 * renders whether the call came from a typed question or a spoken one.
	 */
	import type { Entry } from '$lib/state/conversation.svelte';

	let { entry }: { entry: Extract<Entry, { kind: 'tool' }> } = $props();

	const result = $derived(entry.result);
	const call = $derived(entry.call);
	let expanded = $state(false);

	const REGULATION_PREVIEW = 900;

	const severityLabel: Record<string, string> = {
		high: 'High',
		medium: 'Medium',
		low: 'Low',
		info: 'Note'
	};
</script>

<article class="card" data-state={entry.state} aria-busy={entry.state === 'running'}>
	<header>
		<span class="pip" aria-hidden="true"></span>
		<span class="label">{entry.label}</span>
		{#if entry.state === 'running'}
			<span class="timing">working…</span>
		{:else if entry.durationMs !== undefined}
			<span class="timing">{(entry.durationMs / 1000).toFixed(1)}s</span>
		{/if}
	</header>

	{#if entry.state === 'running'}
		<p class="pending">
			{#if call?.card === 'search'}
				Searching <strong>{call.title}</strong> for “{call.query}”
			{:else if call?.card === 'regulation'}
				Pulling <strong>{call.citation}</strong>
			{:else if call?.card === 'review'}
				Reading <strong>{call.documentName}</strong>
			{:else if call?.card === 'generic'}
				{call.title}
			{:else}
				Working…
			{/if}
		</p>
	{:else if result?.card === 'results'}
		<p class="lead">
			{result.hits.length} section{result.hits.length === 1 ? '' : 's'} for “{result.query}”{result.truncated
				? ', best matches first'
				: ''}
		</p>
		<ul class="hits">
			{#each result.hits as hit, index (`${hit.citation}#${index}`)}
				<li>
					<a href={hit.url} target="_blank" rel="noopener noreferrer">
						<span class="citation">{hit.citation}</span>
						<span class="heading">{hit.heading}</span>
					</a>
					<p class="hierarchy">{hit.hierarchy}</p>
					{#if hit.excerpt}
						<p class="excerpt">{hit.excerpt}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if result?.card === 'regulation'}
		<a class="section-head" href={result.section.url} target="_blank" rel="noopener noreferrer">
			<span class="citation">{result.section.citation}</span>
			<span class="heading">{result.section.heading}</span>
		</a>
		<p class="hierarchy">{result.section.hierarchy}</p>
		<div class="body" class:clipped={!expanded}>
			{expanded ? result.body : result.body.slice(0, REGULATION_PREVIEW)}
		</div>
		{#if result.body.length > REGULATION_PREVIEW}
			<button class="more" type="button" onclick={() => (expanded = !expanded)}>
				{expanded ? 'Show less' : 'Read the full section'}
			</button>
		{/if}
	{:else if result?.card === 'changes'}
		<p class="lead">Rule-making matching “{result.query}”</p>
		<ul class="changes">
			{#each result.changes as change, index (`${change.url}#${index}`)}
				<li>
					<a href={change.url} target="_blank" rel="noopener noreferrer">{change.title}</a>
					<p class="meta">
						<span class="tag">{change.type}</span>
						{change.agency} · published {change.publishedOn}
						{#if change.effectiveOn}· <strong>effective {change.effectiveOn}</strong>{/if}
					</p>
					{#if change.cfrReferences?.length}
						<p class="hierarchy">Amends {change.cfrReferences.join(', ')}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if result?.card === 'review'}
		<p class="lead">{result.documentName} — {result.summary}</p>
		<ul class="findings">
			{#each result.findings as finding, index (index)}
				<li data-severity={finding.severity}>
					<p class="finding-head">
						<span class="severity">{severityLabel[finding.severity] ?? finding.severity}</span>
						{finding.topic}
					</p>
					<blockquote>{finding.quote}</blockquote>
					<p class="concern">{finding.concern}</p>
				</li>
			{/each}
		</ul>
	{:else if result?.card === 'error'}
		<p class="failure">{result.detail}</p>
	{:else if result?.card === 'generic'}
		<p class="lead">{result.title}</p>
		{#if result.detail}<p class="excerpt">{result.detail}</p>{/if}
	{/if}
</article>

<style>
	.card {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-card);
		padding: 14px 16px 16px;
		animation: rise 380ms var(--ease) both;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.timing {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: none;
	}

	.pip {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		flex: none;
	}

	[data-state='running'] .pip {
		animation: pulse 1.1s ease-in-out infinite;
	}

	[data-state='error'] .pip {
		background: var(--severity-high);
	}

	@keyframes pulse {
		50% {
			opacity: 0.25;
			transform: scale(0.75);
		}
	}

	.pending {
		margin: 8px 0 0;
		color: var(--muted);
		font-size: 14px;
	}

	.lead {
		margin: 8px 0 0;
		font-size: 13px;
		color: var(--muted);
	}

	ul {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}

	.hits li,
	.changes li,
	.findings li {
		padding-left: 12px;
		border-left: 2px solid var(--line);
	}

	a {
		color: inherit;
		text-decoration: none;
	}

	a:hover .heading,
	a:hover .citation {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.citation {
		display: block;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.heading {
		display: block;
		font-size: 15px;
		font-weight: 620;
		letter-spacing: -0.01em;
		line-height: 1.3;
		margin-top: 2px;
	}

	.section-head {
		display: block;
		margin-top: 10px;
	}

	.hierarchy {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--muted);
	}

	.excerpt,
	.concern {
		margin: 6px 0 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--ink-soft);
	}

	.body {
		margin-top: 12px;
		font-size: 14px;
		line-height: 1.62;
		white-space: pre-wrap;
		color: var(--ink-soft);
	}

	.body.clipped {
		-webkit-mask-image: linear-gradient(to bottom, #000 72%, transparent);
		mask-image: linear-gradient(to bottom, #000 72%, transparent);
		max-height: 22em;
		overflow: hidden;
	}

	.more {
		margin-top: 10px;
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		padding: 6px 14px;
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		transition: background 160ms var(--ease);
	}

	.more:hover {
		background: var(--accent-soft);
	}

	.changes a {
		font-size: 14.5px;
		font-weight: 600;
		line-height: 1.35;
		display: block;
	}

	.meta {
		margin: 5px 0 0;
		font-size: 12px;
		color: var(--muted);
	}

	.tag {
		display: inline-block;
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 999px;
		padding: 1px 8px;
		font-weight: 700;
		font-size: 11px;
		margin-right: 6px;
	}

	.findings li[data-severity='high'] {
		border-left-color: var(--severity-high);
	}
	.findings li[data-severity='medium'] {
		border-left-color: var(--severity-medium);
	}
	.findings li[data-severity='low'] {
		border-left-color: var(--severity-low);
	}

	.finding-head {
		margin: 0;
		font-size: 14.5px;
		font-weight: 640;
		letter-spacing: -0.01em;
	}

	.severity {
		display: inline-block;
		font-size: 10.5px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
		margin-right: 8px;
		vertical-align: 1px;
	}

	li[data-severity='high'] .severity {
		color: var(--severity-high);
	}
	li[data-severity='medium'] .severity {
		color: var(--severity-medium);
	}

	blockquote {
		margin: 6px 0 0;
		padding: 8px 12px;
		background: var(--paper);
		border-radius: var(--radius-sm);
		font-size: 13.5px;
		line-height: 1.5;
		font-style: italic;
		color: var(--ink-soft);
	}

	.failure {
		margin: 8px 0 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--severity-high);
	}
</style>
