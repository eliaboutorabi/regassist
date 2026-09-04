<script lang="ts">
	/** Bring-your-own-key entry. Nothing happens until this succeeds. */
	import { session } from '$lib/state/session.svelte';

	let { onready }: { onready: () => void } = $props();

	let value = $state('');
	let revealed = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (await session.verify(value)) {
			value = '';
			onready();
		}
	}
</script>

<div class="gate">
	<p class="eyebrow">Bring your own key</p>
	<h2>Verity runs on your OpenAI account.</h2>
	<p class="lead">
		Paste a key with Realtime access and start talking. It is kept in this browser only, sent with
		each request, and never written down on the server.
	</p>

	<form onsubmit={submit}>
		<div class="field">
			<input
				type={revealed ? 'text' : 'password'}
				bind:value
				placeholder="sk-…"
				autocomplete="off"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				aria-label="OpenAI API key"
				aria-invalid={session.keyError ? 'true' : undefined}
			/>
			<button
				class="reveal"
				type="button"
				onclick={() => (revealed = !revealed)}
				aria-label={revealed ? 'Hide the key' : 'Show the key'}
			>
				{revealed ? 'Hide' : 'Show'}
			</button>
		</div>

		<button class="go" type="submit" disabled={session.verifying || !value.trim()}>
			{session.verifying ? 'Checking…' : 'Start'}
		</button>
	</form>

	{#if session.keyError}
		<p class="error" role="alert">{session.keyError}</p>
	{/if}

	<ul class="facts">
		<li>Stored in this browser's local storage, and removable at any time.</li>
		<li>Used only to reach OpenAI on your behalf — nothing else calls it.</li>
		<li>Regulations come from the free public eCFR and Federal Register APIs.</li>
	</ul>

	<p class="footnote">
		Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
			>platform.openai.com</a
		>. Voice needs Realtime access on the account; text mode works without it.
	</p>
</div>

<style>
	.gate {
		display: grid;
		align-content: center;
		gap: 6px;
		max-width: 48ch;
		margin: auto;
		padding: 8px 0;
	}

	.eyebrow {
		margin: 0;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
	}

	h2 {
		margin: 4px 0 0;
		font-size: clamp(24px, 3.4vw, 31px);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1.15;
	}

	.lead {
		margin: 10px 0 0;
		font-size: 15px;
		line-height: 1.6;
		color: var(--ink-soft);
	}

	form {
		display: flex;
		gap: 8px;
		margin-top: 20px;
		flex-wrap: wrap;
	}

	.field {
		flex: 1 1 260px;
		display: flex;
		align-items: center;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 4px 6px 4px 18px;
		box-shadow: var(--shadow-card);
	}

	.field:focus-within {
		border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
	}

	input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 15px;
		padding: 9px 0;
		color: var(--ink);
		letter-spacing: 0.02em;
	}

	input:focus {
		outline: none;
	}

	.reveal {
		border: 0;
		background: none;
		color: var(--muted);
		font-size: 12.5px;
		font-weight: 640;
		cursor: pointer;
		padding: 6px 10px;
	}

	.reveal:hover {
		color: var(--accent);
	}

	.go {
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		color: var(--paper);
		font-size: 15px;
		font-weight: 640;
		padding: 12px 30px;
		cursor: pointer;
		transition:
			background 180ms var(--ease),
			opacity 180ms var(--ease);
	}

	.go:hover:not(:disabled) {
		background: var(--accent);
	}

	.go:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.error {
		margin: 12px 0 0;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--severity-high);
	}

	.facts {
		list-style: none;
		margin: 22px 0 0;
		padding: 0;
		display: grid;
		gap: 7px;
	}

	.facts li {
		position: relative;
		padding-left: 18px;
		font-size: 13px;
		line-height: 1.5;
		color: var(--muted);
	}

	.facts li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 7px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		opacity: 0.55;
	}

	.footnote {
		margin: 18px 0 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--muted);
	}

	a {
		color: var(--accent);
		text-underline-offset: 2px;
	}
</style>
