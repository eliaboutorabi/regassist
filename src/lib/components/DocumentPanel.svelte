<script lang="ts">
	/**
	 * Loading a document into the session.
	 *
	 * Text never leaves the browser except as part of a turn, and the server
	 * drops it the moment the turn ends. Nothing is stored anywhere.
	 */
	import { documents } from '$lib/state/documents.svelte';
	import { extractText, isSupportedDocument, SUPPORTED_HINT } from '$lib/client/extract';

	interface Props {
		onloaded?: (name: string) => void;
	}
	let { onloaded }: Props = $props();

	let open = $state(false);
	let pasted = $state('');
	let dragging = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	async function ingest(files: FileList | File[]) {
		problem = null;
		busy = true;
		try {
			for (const file of Array.from(files)) {
				if (!isSupportedDocument(file)) {
					problem = `${file.name} is not a supported format. ${SUPPORTED_HINT}`;
					continue;
				}
				const text = await extractText(file);
				if (!text.trim()) {
					problem = `${file.name} contained no readable text.`;
					continue;
				}
				const added = documents.add(file.name, text, 'file');
				if (added) onloaded?.(added.name);
			}
		} catch (cause) {
			problem = cause instanceof Error ? cause.message : 'That file could not be read.';
		} finally {
			busy = false;
			if (input) input.value = '';
		}
	}

	function addPasted() {
		const firstLine = pasted.trim().split('\n')[0] ?? '';
		const name = firstLine.slice(0, 60).trim() || 'Pasted text';
		const added = documents.add(name, pasted, 'paste');
		if (added) {
			pasted = '';
			open = false;
			onloaded?.(added.name);
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (event.dataTransfer?.files.length) void ingest(event.dataTransfer.files);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- The drop target is a convenience; "Choose a file" is the accessible path. -->
<section
	class="panel"
	aria-label="Documents"
	class:dragging
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
>
	<header>
		<h2>Documents</h2>
		<button class="ghost" type="button" onclick={() => (open = !open)} aria-expanded={open}>
			{open ? 'Close' : 'Add'}
		</button>
	</header>

	{#if documents.items.length}
		<ul class="loaded">
			{#each documents.items as document (document.id)}
				<li>
					<span class="dot" aria-hidden="true"></span>
					<span class="name" title={document.name}>{document.name}</span>
					<span class="size">{(document.text.length / 1000).toFixed(1)}k</span>
					<button
						class="remove"
						type="button"
						onclick={() => documents.remove(document.id)}
						aria-label={`Remove ${document.name}`}>×</button
					>
				</li>
			{/each}
		</ul>
	{:else if !open}
		<p class="empty">
			Drop an engagement letter, a client memo, or a draft position and ask Verity to review it.
		</p>
	{/if}

	{#if open}
		<div class="adder">
			<textarea
				bind:value={pasted}
				rows="4"
				placeholder="Paste the text you want reviewed…"
				aria-label="Paste document text"
			></textarea>
			<div class="actions">
				<button class="ghost" type="button" onclick={() => input?.click()} disabled={busy}>
					{busy ? 'Reading…' : 'Choose a file'}
				</button>
				<button class="primary" type="button" onclick={addPasted} disabled={!pasted.trim()}>
					Add text
				</button>
			</div>
			<p class="hint">{SUPPORTED_HINT} Nothing is stored on the server.</p>
		</div>
	{/if}

	{#if problem}
		<p class="problem">{problem}</p>
	{/if}

	<input
		bind:this={input}
		type="file"
		multiple
		accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf"
		onchange={(event) => {
			const files = (event.currentTarget as HTMLInputElement).files;
			if (files?.length) void ingest(files);
		}}
		hidden
	/>
</section>

<style>
	.panel {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
		padding: 12px 14px 14px;
		box-shadow: var(--shadow-card);
		transition:
			border-color 160ms var(--ease),
			background 160ms var(--ease);
	}

	.panel.dragging {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	h2 {
		margin: 0;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.empty {
		margin: 8px 0 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--muted);
	}

	.loaded {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.loaded li {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		flex: none;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.size {
		font-size: 11.5px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.remove {
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
		padding: 0 2px;
	}

	.remove:hover {
		color: var(--severity-high);
	}

	.adder {
		margin-top: 10px;
		display: grid;
		gap: 8px;
	}

	textarea {
		width: 100%;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--paper);
		padding: 10px 12px;
		font: inherit;
		font-size: 13.5px;
		line-height: 1.5;
		resize: vertical;
		color: var(--ink);
	}

	textarea:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	button.ghost,
	button.primary {
		border-radius: 999px;
		padding: 6px 14px;
		font-size: 12.5px;
		font-weight: 640;
		cursor: pointer;
		transition:
			background 160ms var(--ease),
			opacity 160ms var(--ease);
	}

	button.ghost {
		border: 1px solid var(--line);
		background: var(--paper);
	}

	button.ghost:hover:not(:disabled) {
		background: var(--accent-soft);
	}

	button.primary {
		border: 0;
		background: var(--ink);
		color: var(--paper);
	}

	button.primary:disabled,
	button.ghost:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.hint,
	.problem {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--muted);
	}

	.problem {
		margin-top: 8px;
		color: var(--severity-high);
	}
</style>
