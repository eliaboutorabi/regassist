<script lang="ts">
	/** The text input. Present in both modes — typing into a live voice session
	 * injects the message into the conversation Verity is already having. */
	interface Props {
		disabled?: boolean;
		placeholder?: string;
		busy?: boolean;
		onsend: (text: string) => void;
		onstop?: () => void;
	}

	let { disabled = false, placeholder = 'Ask about a regulation…', busy = false, onsend, onstop }: Props =
		$props();

	let value = $state('');
	let field = $state<HTMLTextAreaElement | null>(null);

	const canSend = $derived(value.trim().length > 0 && !disabled);

	function autosize() {
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
	}

	function submit() {
		if (!canSend) return;
		onsend(value.trim());
		value = '';
		queueMicrotask(autosize);
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter sends; Shift+Enter is a newline, as in every chat app.
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit();
		}
	}

	export function focus() {
		field?.focus();
	}
</script>

<form
	class="composer"
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
		aria-label="Message Verity"
	></textarea>

	{#if busy && onstop}
		<button class="stop" type="button" onclick={onstop} aria-label="Stop generating">
			<span class="square" aria-hidden="true"></span>
		</button>
	{:else}
		<button class="send" type="submit" disabled={!canSend} aria-label="Send message">
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path
					d="M4.5 12h13m0 0-5.2-5.2M17.5 12l-5.2 5.2"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	{/if}
</form>

<style>
	.composer {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 22px;
		padding: 7px 7px 7px 16px;
		box-shadow: var(--shadow-card);
		transition: border-color 160ms var(--ease);
	}

	.composer:focus-within {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
	}

	textarea {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		resize: none;
		font: inherit;
		font-size: 15px;
		line-height: 1.5;
		color: var(--ink);
		padding: 6px 0;
		max-height: 160px;
	}

	textarea:focus {
		outline: none;
	}

	textarea::placeholder {
		color: var(--muted);
	}

	button {
		flex: none;
		width: 38px;
		height: 38px;
		border: 0;
		border-radius: 50%;
		display: grid;
		place-items: center;
		cursor: pointer;
		transition:
			background 160ms var(--ease),
			transform 160ms var(--ease),
			opacity 160ms var(--ease);
	}

	.send {
		background: var(--ink);
		color: var(--paper);
	}

	.send:disabled {
		opacity: 0.28;
		cursor: default;
	}

	.send:not(:disabled):hover {
		background: var(--accent);
		transform: scale(1.05);
	}

	.stop {
		background: var(--severity-high);
		color: white;
	}

	.square {
		width: 11px;
		height: 11px;
		border-radius: 2px;
		background: currentColor;
	}

	svg {
		width: 20px;
		height: 20px;
	}
</style>
