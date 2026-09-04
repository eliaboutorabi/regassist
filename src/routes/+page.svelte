<script lang="ts">
	/**
	 * Verity — the whole app.
	 *
	 * The robot is mounted from the first paint, before a key is entered, so the
	 * character is the first thing a visitor sees rather than a form. Voice and
	 * text share one transcript and one tool registry; the only difference is
	 * which transport carries the turn.
	 */
	import { onMount } from 'svelte';
	import Composer from '$lib/components/Composer.svelte';
	import DocumentPanel from '$lib/components/DocumentPanel.svelte';
	import KeyGate from '$lib/components/KeyGate.svelte';
	import RobotStage from '$lib/components/RobotStage.svelte';
	import Transcript from '$lib/components/Transcript.svelte';
	import VoiceButton from '$lib/components/VoiceButton.svelte';
	import { streamTurn } from '$lib/client/chat';
	import { VoiceSession, type VoiceStatus } from '$lib/client/voice';
	import { conversation } from '$lib/state/conversation.svelte';
	import { documents } from '$lib/state/documents.svelte';
	import { session } from '$lib/state/session.svelte';
	import { CHARACTERS, CHARACTER_IDS, type CharacterId } from '$lib/voices';

	let stage = $state<ReturnType<typeof RobotStage> | null>(null);
	let composer = $state<ReturnType<typeof Composer> | null>(null);

	let unlocked = $state(false);
	let settingsOpen = $state(false);

	let voiceStatus = $state<VoiceStatus>('idle');
	let voiceActive = $state(false);
	let audioLevel = $state(0);
	let audible = $state(false);
	let starting = $state(false);

	let textBusy = $state(false);
	/** True from the first text delta until the turn settles. */
	let textStreaming = $state(false);
	let abort: AbortController | null = null;

	const character = $derived(CHARACTERS[session.character]);

	/** What the robot should be doing. Voice wins when a session is live. */
	const robotMode = $derived(
		voiceActive
			? voiceStatus === 'speaking'
				? 'speaking'
				: voiceStatus === 'thinking'
					? 'thinking'
					: voiceStatus === 'listening'
						? 'listening'
						: 'idle'
			: textStreaming
				? 'speaking'
				: textBusy
					? 'thinking'
					: 'idle'
	);

	const voice = new VoiceSession({
		onStatus: (status) => {
			voiceStatus = status;
			voiceActive = voice.active;
		},
		onUserTranscript: (text) => conversation.addUser(text, 'voice'),
		onAssistantDelta: (delta) => {
			conversation.appendAssistant(delta, 'voice');
			stage?.appendTranscript(delta);
		},
		onAssistantDone: () => conversation.settleAssistant(),
		onToolCall: (callId, name, view) => {
			conversation.startTool(callId, name, toolLabel(name), view);
		},
		onToolResult: (callId, isError, view, durationMs) => {
			conversation.finishTool(callId, isError, view, durationMs);
		},
		onError: (message) => conversation.addNotice(message),
		onAudioLevel: (level, isAudible) => {
			audioLevel = level;
			audible = isAudible;
		}
	});

	/**
	 * Voice-mode calls arrive with only a name, since the schemas live server
	 * side. This keeps the card headings readable without a round trip.
	 */
	const TOOL_LABELS: Record<string, string> = {
		search_regulations: 'Searching the eCFR',
		read_regulation: 'Reading the regulation',
		find_rule_changes: 'Checking the Federal Register',
		review_document: 'Reviewing the document',
		list_documents: 'Checking loaded documents'
	};
	const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;

	onMount(() => {
		// A remembered key still gets checked, so a revoked one fails at the
		// gate rather than three seconds into the first answer.
		if (session.hasKey) void session.verify().then((ok) => (unlocked = ok));

		if (import.meta.env.DEV) {
			// A console handle for inspecting the character while developing.
			// onMount only, because this module is also rendered on the server.
			(window as unknown as Record<string, unknown>).__verity = {
				robot: () => stage?.debugState(),
				voice: () => ({ status: voiceStatus, active: voiceActive, level: audioLevel, audible })
			};
		}

		return () => voice.stop();
	});

	// The character drives the accent colour for the whole document.
	$effect(() => {
		document.documentElement.dataset.character = session.character;
	});

	// Documents can be added mid-conversation; the live session sees them.
	$effect(() => {
		voice.setDocuments(documents.payload());
	});

	async function toggleVoice() {
		if (voice.active) {
			voice.stop();
			voiceActive = false;
			return;
		}
		starting = true;
		try {
			await voice.start({
				apiKey: session.apiKey,
				character: session.character,
				documents: documents.payload(),
				// Only greet a cold start; mid-conversation, just start listening.
				greet: conversation.isEmpty,
				history: conversation.toMessages()
			});
			voiceActive = voice.active;
			stage?.beginResponse();
		} catch {
			// The session already reported it through onError.
			voiceActive = false;
		} finally {
			starting = false;
		}
	}

	function switchCharacter(next: CharacterId) {
		if (next === session.character) return;
		const wasActive = voice.active;
		// A realtime voice cannot change mid-session, so the session has to end.
		if (wasActive) voice.stop();
		session.setCharacter(next);
		voiceActive = false;
		if (wasActive) {
			conversation.addNotice(
				`Switched to ${CHARACTERS[next].displayName}. Start a new conversation to hear the new voice.`,
				'info'
			);
		}
	}

	async function send(text: string) {
		// Typing into a live voice session joins the conversation already running
		// rather than starting a competing one.
		if (voice.active && voice.say(text)) {
			conversation.addUser(text, 'voice');
			return;
		}

		conversation.addUser(text, 'text');
		const messages = conversation.toMessages();

		textBusy = true;
		conversation.busy = true;
		abort = new AbortController();
		stage?.beginResponse();

		try {
			for await (const event of streamTurn({
				apiKey: session.apiKey,
				model: session.model,
				messages,
				documents: documents.payload(),
				signal: abort.signal
			})) {
				conversation.applyAgentEvent(event);
				if (event.type === 'text') {
					textStreaming = true;
					stage?.appendTranscript(event.delta);
				}
				// A tool call between paragraphs stops the printer until prose resumes.
				if (event.type === 'tool-call') textStreaming = false;
			}
		} catch (cause) {
			if (!abort.signal.aborted) {
				conversation.addNotice(
					cause instanceof Error ? cause.message : 'That turn could not be completed.'
				);
			}
		} finally {
			conversation.settleAssistant();
			textBusy = false;
			textStreaming = false;
			conversation.busy = false;
			abort = null;
		}
	}

	function stopTurn() {
		abort?.abort();
		conversation.settleAssistant();
		textBusy = false;
		textStreaming = false;
		conversation.busy = false;
	}

	function startOver() {
		stopTurn();
		voice.stop();
		voiceActive = false;
		conversation.reset();
		stage?.clearTranscript();
		settingsOpen = false;
	}

	const SUGGESTIONS = [
		'What has to be true for a business meal to be deductible?',
		'What does the CFR say about classifying a worker as a contractor?',
		'Any recent IRS rule-making on the research credit?'
	];
</script>

<svelte:head>
	<title>Verity — Regulations Assistant</title>
	<meta
		name="description"
		content="Talk to a small robot that looks up federal tax and financial regulations in the actual Code of Federal Regulations."
	/>
	<meta name="theme-color" content="#dfdcd6" />
</svelte:head>

<div class="app">
	<header class="bar">
		<div class="brand">
			<span class="mark" aria-hidden="true"></span>
			<div>
				<h1>Verity</h1>
				<p>Regulations assistant · {character.displayName}</p>
			</div>
		</div>

		<div class="bar-actions">
			<div class="switcher" role="group" aria-label="Choose a character">
				{#each CHARACTER_IDS as id (id)}
					<button
						type="button"
						class:selected={session.character === id}
						aria-pressed={session.character === id}
						onclick={() => switchCharacter(id)}
					>
						{CHARACTERS[id].displayName}
					</button>
				{/each}
			</div>

			{#if unlocked}
				<button
					class="icon"
					type="button"
					aria-label="Session settings"
					aria-expanded={settingsOpen}
					onclick={() => (settingsOpen = !settingsOpen)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8" />
						<path
							d="M12 3.6v2.1M12 18.3v2.1M20.4 12h-2.1M5.7 12H3.6M18 6l-1.5 1.5M7.5 16.5 6 18M18 18l-1.5-1.5M7.5 7.5 6 6"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			{/if}
		</div>

		{#if settingsOpen}
			<div class="settings">
				<label>
					<span>Text model</span>
					<select
						value={session.model}
						onchange={(event) => session.setModel((event.currentTarget as HTMLSelectElement).value)}
					>
						{#each session.availableModels as model (model)}
							<option value={model}>{model}</option>
						{/each}
					</select>
				</label>

				<p class="realtime" data-ok={session.realtimeAvailable}>
					{session.realtimeAvailable
						? 'Realtime voice is available on this key.'
						: 'This key has no Realtime access — text mode only.'}
				</p>

				<div class="settings-actions">
					<button type="button" onclick={startOver}>Start over</button>
					<button
						class="danger"
						type="button"
						onclick={() => {
							startOver();
							session.forgetKey();
							unlocked = false;
						}}>Forget key</button
					>
				</div>
			</div>
		{/if}
	</header>

	<main>
		<section class="stage-col">
			<div class="stage-frame">
				<RobotStage
					bind:this={stage}
					character={session.character}
					mode={robotMode}
					{audioLevel}
					{audible}
					printing={textStreaming}
				/>
			</div>

			<div class="controls">
				<VoiceButton
					status={voiceStatus}
					active={voiceActive}
					level={audioLevel}
					disabled={!unlocked || starting || !session.realtimeAvailable}
					onclick={toggleVoice}
				/>
				<p class="status">
					{#if !unlocked}
						Add a key to begin.
					{:else if !session.realtimeAvailable}
						Voice needs Realtime access on this key. Text mode is ready.
					{:else if voiceActive}
						Speak naturally — interrupting is fine.
					{:else}
						Talk, or type below. Every citation is looked up live.
					{/if}
				</p>
			</div>

			{#if unlocked}
				<DocumentPanel
					onloaded={(name) =>
						conversation.addNotice(`Loaded “${name}”. Ask Verity to review it.`, 'info')}
				/>
			{/if}
		</section>

		<section class="work-col">
			{#if !unlocked}
				<KeyGate onready={() => (unlocked = true)} />
			{:else}
				{#if conversation.isEmpty}
					<div class="opening">
						<h2>What are you checking?</h2>
						<p>
							Verity searches the live Code of Federal Regulations and the Federal Register. She reads
							the section before answering, and cites what she read.
						</p>
						<ul class="suggestions">
							{#each SUGGESTIONS as suggestion (suggestion)}
								<li>
									<button type="button" onclick={() => send(suggestion)}>{suggestion}</button>
								</li>
							{/each}
						</ul>
					</div>
				{:else}
					<Transcript />
				{/if}

				{#if conversation.citations.length}
					<div class="rail" aria-label="Regulations cited in this session">
						<span class="rail-label">Cited</span>
						<div class="rail-items">
							{#each conversation.citations as citation (citation.citation)}
								<a href={citation.url} target="_blank" rel="noopener noreferrer" title={citation.heading}>
									{citation.citation}
								</a>
							{/each}
						</div>
					</div>
				{/if}

				<div class="composer-slot">
					<Composer
						bind:this={composer}
						busy={textBusy}
						disabled={textBusy}
						placeholder={voiceActive ? 'Type to Verity while you talk…' : 'Ask about a regulation…'}
						onsend={send}
						onstop={stopTurn}
					/>
					<p class="disclaimer">
						Research assistance, not a tax opinion. Verity quotes the regulation; the judgement is
						yours.
					</p>
				</div>
			{/if}
		</section>
	</main>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100svh;
		max-width: 1440px;
		margin: 0 auto;
		padding: 0 clamp(12px, 2.4vw, 28px) clamp(10px, 1.6vw, 18px);
	}

	/* ------------------------------------------------------------------ bar */

	.bar {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: clamp(12px, 1.8vw, 18px) 2px;
		flex: none;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 11px;
		min-width: 0;
	}

	.mark {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		flex: none;
		background: linear-gradient(150deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--ink)));
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
	}

	h1 {
		margin: 0;
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.025em;
		line-height: 1.1;
	}

	.brand p {
		margin: 1px 0 0;
		font-size: 11.5px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.switcher {
		display: flex;
		background: color-mix(in srgb, white 55%, transparent);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 3px;
	}

	.switcher button {
		border: 0;
		background: none;
		border-radius: 999px;
		padding: 6px 14px;
		font-size: 12.5px;
		font-weight: 620;
		color: var(--muted);
		cursor: pointer;
		transition:
			background 180ms var(--ease),
			color 180ms var(--ease);
	}

	.switcher button.selected {
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow-card);
	}

	.icon {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: color-mix(in srgb, white 55%, transparent);
		color: var(--muted);
		cursor: pointer;
		transition:
			color 160ms var(--ease),
			background 160ms var(--ease);
	}

	.icon:hover {
		color: var(--accent);
		background: var(--surface);
	}

	.icon svg {
		width: 19px;
		height: 19px;
	}

	.settings {
		position: absolute;
		top: calc(100% - 4px);
		right: 2px;
		z-index: 20;
		width: min(300px, calc(100vw - 32px));
		display: grid;
		gap: 12px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-float);
		padding: 14px;
		animation: drop 200ms var(--ease) both;
	}

	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}

	.settings label {
		display: grid;
		gap: 5px;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	select {
		font: inherit;
		font-size: 14px;
		text-transform: none;
		letter-spacing: normal;
		font-weight: 500;
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--paper);
		padding: 8px 10px;
	}

	.realtime {
		margin: 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--muted);
	}

	.realtime[data-ok='false'] {
		color: var(--severity-medium);
	}

	.settings-actions {
		display: flex;
		gap: 8px;
	}

	.settings-actions button {
		flex: 1;
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		padding: 7px 10px;
		font-size: 12.5px;
		font-weight: 620;
		cursor: pointer;
	}

	.settings-actions button:hover {
		background: var(--accent-soft);
	}

	.settings-actions .danger:hover {
		background: color-mix(in srgb, var(--severity-high) 10%, white);
		color: var(--severity-high);
	}

	/* ----------------------------------------------------------------- main */

	main {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(320px, 0.85fr) minmax(0, 1.15fr);
		gap: clamp(14px, 2vw, 26px);
	}

	main > * {
		min-width: 0;
	}

	.stage-col {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto auto;
		gap: 14px;
		min-height: 0;
	}

	.stage-frame {
		position: relative;
		min-height: 0;
		border-radius: var(--radius-lg);
		background:
			radial-gradient(90% 60% at 50% 12%, rgba(255, 255, 255, 0.95), transparent 70%),
			var(--paper);
		border: 1px solid var(--line);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.controls {
		display: grid;
		justify-items: center;
		gap: 9px;
		text-align: center;
	}

	.status {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--muted);
		max-width: 34ch;
	}

	.work-col {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 0;
		min-width: 0;
	}

	.opening {
		flex: 1;
		display: grid;
		align-content: center;
		gap: 10px;
		max-width: 52ch;
	}

	.opening h2 {
		margin: 0;
		font-size: clamp(24px, 3.2vw, 32px);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1.15;
	}

	.opening p {
		margin: 0;
		font-size: 15px;
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.suggestions {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.suggestions button {
		width: 100%;
		text-align: left;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius-md);
		padding: 12px 16px;
		font-size: 14px;
		line-height: 1.45;
		cursor: pointer;
		box-shadow: var(--shadow-card);
		transition:
			transform 160ms var(--ease),
			border-color 160ms var(--ease);
	}

	.suggestions button:hover {
		transform: translateX(3px);
		border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
	}

	.rail {
		flex: none;
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.rail-label {
		font-size: 10.5px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
		flex: none;
	}

	.rail-items {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 2px;
		scrollbar-width: none;
	}

	.rail-items::-webkit-scrollbar {
		display: none;
	}

	.rail-items a {
		flex: none;
		font-size: 11.5px;
		font-weight: 640;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 4px 11px;
		text-decoration: none;
		white-space: nowrap;
	}

	.rail-items a:hover {
		background: color-mix(in srgb, var(--accent) 20%, white);
	}

	.composer-slot {
		flex: none;
		display: grid;
		gap: 7px;
	}

	.disclaimer {
		margin: 0;
		text-align: center;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--muted);
	}

	/* --------------------------------------------------------------- mobile */

	/*
	 * A phone gets the chat-app shape rather than one long scrolling page: the
	 * robot stays visible as a compact band, the transcript scrolls inside its
	 * own pane, and the composer never leaves the bottom of the screen.
	 */
	@media (max-width: 900px) {
		.app {
			height: 100dvh;
			padding-bottom: max(10px, env(safe-area-inset-bottom));
		}

		main {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
			gap: 12px;
		}

		.stage-col {
			display: grid;
			grid-template-columns: 118px minmax(0, 1fr);
			grid-template-areas:
				'robot controls'
				'docs docs';
			align-items: center;
			gap: 12px;
		}

		.stage-frame {
			grid-area: robot;
			width: 118px;
			height: 118px;
			border-radius: var(--radius-md);
		}

		.controls {
			grid-area: controls;
			justify-items: start;
			text-align: left;
			gap: 7px;
		}

		.status {
			max-width: none;
			font-size: 12px;
		}

		.stage-col :global(.panel) {
			grid-area: docs;
		}

		.brand p {
			display: none;
		}

		.opening h2 {
			font-size: 25px;
		}

		.opening {
			align-content: start;
			padding-top: 4px;
		}
	}

	/* Below this the robot band competes with the transcript for space. */
	@media (max-width: 900px) and (max-height: 680px) {
		.stage-frame {
			width: 92px;
			height: 92px;
		}
	}

	@media (max-width: 420px) {
		.switcher button {
			padding: 6px 11px;
			font-size: 12px;
		}

		.stage-col {
			grid-template-columns: 96px minmax(0, 1fr);
		}

		.stage-frame {
			width: 96px;
			height: 96px;
		}
	}

</style>
