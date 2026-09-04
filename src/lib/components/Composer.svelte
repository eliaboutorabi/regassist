<script lang="ts">
	/**
	 * The composer.
	 *
	 * Documents belong here rather than in a panel of their own: attaching a
	 * file to the thing you are about to say is how every other tool this
	 * audience uses already works, and a permanent drop zone taking a quarter of
	 * the left rail made the app look like a form.
	 */
	import {
		Attachment01Icon,
		ArrowRight01Icon,
		Cancel01Icon,
		File01Icon,
		Loading03Icon,
		Pdf01Icon,
		StopIcon
	} from '@hugeicons/core-free-icons';
	import Icon from './Icon.svelte';
	import { documents } from '$lib/state/documents.svelte';
	import { extractText, isSupportedDocument, SUPPORTED_HINT } from '$lib/client/extract';

	interface Props {
		disabled?: boolean;
		placeholder?: string;
		busy?: boolean;
		onsend: (text: string) => void;
		onstop?: () => void;
		onopen?: (id: string) => void;
	}

	let {
		disabled = false,
		placeholder = 'Ask about a regulation…',
		busy = false,
		onsend,
		onstop,
		onopen
	}: Props = $props();

	let value = $state('');
	let field = $state<HTMLTextAreaElement | null>(null);
	let picker = $state<HTMLInputElement | null>(null);
	let dragging = $state(false);
	let reading = $state(false);
	let problem = $state<string | null>(null);

	const canSend = $derived(value.trim().length > 0 && !disabled);

	function autosize() {
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
	}

	function submit() {
		if (!canSend) return;
		onsend(value.trim());
		value = '';
		queueMicrotask(autosize);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit();
		}
	}

	async function ingest(files: FileList | File[]) {
		problem = null;
		reading = true;
		try {
			for (const file of Array.from(files)) {
				if (!isSupportedDocument(file)) {
					problem = `${file.name} is not a supported format. ${SUPPORTED_HINT}`;
					continue;
				}
				const text = await extractText(file);
				if (!text.trim()) {
					problem = `${file.name} had no readable text.`;
					continue;
				}
				documents.add(file.name, text, 'file', file);
			}
		} catch (cause) {
			problem = cause instanceof Error ? cause.message : 'That file could not be read.';
		} finally {
			reading = false;
			if (picker) picker.value = '';
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (event.dataTransfer?.files.length) void ingest(event.dataTransfer.files);
	}

	/**
	 * A long paste is a document, not a message.
	 *
	 * Pasting six pages of an engagement letter into a chat box makes an
	 * unreadable message and an unusable prompt. Over this length it becomes an
	 * attachment instead, which is what the person meant.
	 */
	const PASTE_AS_DOCUMENT = 1200;

	function onPaste(event: ClipboardEvent) {
		const files = event.clipboardData?.files;
		if (files?.length) {
			event.preventDefault();
			void ingest(files);
			return;
		}
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (text.length < PASTE_AS_DOCUMENT) return;

		event.preventDefault();
		const firstLine = text.trim().split('\n')[0] ?? '';
		documents.add(firstLine.slice(0, 60) || 'Pasted text', text, 'paste');
	}

	export function focus() {
		field?.focus();
	}
</script>

<div
	class="composer"
	class:dragging
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	role="group"
	aria-label="Composer"
>
	{#if documents.items.length}
		<ul class="chips">
			{#each documents.items as document (document.id)}
				<li>
					<button
						class="chip"
						type="button"
						onclick={() => onopen?.(document.id)}
						title="Open {document.name}"
					>
						<Icon icon={document.kind === 'file' ? Pdf01Icon : File01Icon} size={15} />
						<span class="chip-name">{document.name}</span>
					</button>
					<button
						class="chip-remove"
						type="button"
						onclick={() => documents.remove(document.id)}
						aria-label="Remove {document.name}"
					>
						<Icon icon={Cancel01Icon} size={13} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<form
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<textarea
			bind:this={field}
			bind:value
			{placeholder}
			{disabled}
			rows="1"
			oninput={autosize}
			onkeydown={onKeydown}
			onpaste={onPaste}
			aria-label="Message Verity"
		></textarea>

		<div class="tools">
			<button
				class="tool"
				type="button"
				onclick={() => picker?.click()}
				disabled={reading}
				aria-label="Attach a document"
				title="Attach a document"
			>
				<Icon icon={reading ? Loading03Icon : Attachment01Icon} size={19} class={reading ? 'spin' : ''} />
			</button>

			<span class="spacer"></span>

			{#if busy && onstop}
				<button class="send stop" type="button" onclick={onstop} aria-label="Stop generating">
					<Icon icon={StopIcon} size={17} />
				</button>
			{:else}
				<button class="send" type="submit" disabled={!canSend} aria-label="Send message">
					<Icon icon={ArrowRight01Icon} size={20} />
				</button>
			{/if}
		</div>
	</form>

	<input
		bind:this={picker}
		type="file"
		multiple
		accept=".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.log,application/pdf,text/plain,text/markdown,text/csv,application/json"
		onchange={(event) => {
			const files = (event.currentTarget as HTMLInputElement).files;
			if (files?.length) void ingest(files);
		}}
		hidden
	/>
</div>

{#if problem}
	<p class="problem" role="alert">{problem}</p>
{/if}

<style>
	.composer {
		border: 1px solid var(--line);
		border-radius: 22px;
		background: var(--surface);
		box-shadow: var(--shadow-card);
		padding: 6px 6px 6px 6px;
		transition:
			border-color 180ms var(--ease),
			box-shadow 180ms var(--ease);
	}

	.composer:focus-within {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
		box-shadow:
			var(--shadow-card),
			0 0 0 4px color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.composer.dragging {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	textarea {
		width: 100%;
		border: 0;
		background: none;
		resize: none;
		font: inherit;
		font-size: 15px;
		line-height: 1.5;
		color: var(--ink);
		padding: 8px 10px 2px;
		max-height: 180px;
	}

	textarea:focus {
		outline: none;
	}

	textarea::placeholder {
		color: var(--muted);
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.spacer {
		flex: 1;
	}

	.tool,
	.send {
		display: grid;
		place-items: center;
		border: 0;
		cursor: pointer;
		transition:
			background 160ms var(--ease),
			color 160ms var(--ease),
			transform 160ms var(--ease),
			opacity 160ms var(--ease);
	}

	.tool {
		width: 34px;
		height: 34px;
		border-radius: 11px;
		background: none;
		color: var(--muted);
	}

	.tool:hover:not(:disabled) {
		background: var(--paper);
		color: var(--accent);
	}

	.send {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--ink);
		color: var(--paper);
	}

	.send:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.send:not(:disabled):hover {
		background: var(--accent);
		transform: scale(1.06);
	}

	.send.stop {
		background: var(--severity-high);
		color: white;
	}

	/* ------------------------------------------------------------- chips */

	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 2px 4px 6px;
		padding: 0;
	}

	.chips li {
		display: flex;
		align-items: center;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 999px;
		max-width: 100%;
		overflow: hidden;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		border: 0;
		background: none;
		padding: 5px 4px 5px 11px;
		font-size: 12.5px;
		font-weight: 560;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.chip:hover {
		color: var(--accent);
	}

	.chip-name {
		max-width: 22ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-remove {
		display: grid;
		place-items: center;
		width: 22px;
		height: 26px;
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
		padding-right: 4px;
	}

	.chip-remove:hover {
		color: var(--severity-high);
	}

	.problem {
		margin: 6px 4px 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--severity-high);
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
