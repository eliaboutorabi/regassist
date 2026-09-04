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
	import { Comment01Icon, Settings02Icon } from '@hugeicons/core-free-icons';
	import Composer from '$lib/components/Composer.svelte';
	import DocumentViewer from '$lib/components/DocumentViewer.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import KeyGate from '$lib/components/KeyGate.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import RobotStage from '$lib/components/RobotStage.svelte';
	import SettingsDialog from '$lib/components/SettingsDialog.svelte';
	import Transcript from '$lib/components/Transcript.svelte';
	import VoiceButton from '$lib/components/VoiceButton.svelte';
	import { streamTurn } from '$lib/client/chat';
	import { VoiceSession, type VoiceStatus } from '$lib/client/voice';
	import { brain } from '$lib/state/brain.svelte';
	import { conversation } from '$lib/state/conversation.svelte';
	import { documents } from '$lib/state/documents.svelte';
	import { pages } from '$lib/state/pages.svelte';
	import { session } from '$lib/state/session.svelte';
	import { CHARACTERS, type CharacterId } from '$lib/voices';

	let stage = $state<ReturnType<typeof RobotStage> | null>(null);
	let composer = $state<ReturnType<typeof Composer> | null>(null);

	let unlocked = $state(false);
	let settingsOpen = $state(false);
	let viewing = $state<string | null>(null);

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
			absorbMarks(view as never);
		},
		onError: (message) => conversation.addNotice(message),
		// Asked for at connect time, including after a reconnect, so a dropped
		// session comes back knowing everything said before it dropped.
		transcript: () => conversation.toMessages(),
		onReview: (status, reasons) => {
			// A listener is not looking at the screen, so the correction is spoken.
			// The badge is for whoever is.
			if (status === 'clean') conversation.markChecked();
			else conversation.markVoiceRevision(reasons);
		},
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

	/**
	 * A highlight is decided on the server and placed in the browser.
	 *
	 * The tool names passages; matching them to a position needs the OCR, which
	 * lives in this tab along with the file. So every finished tool result is
	 * checked for marks, whichever transport carried it.
	 */
	function absorbMarks(view?: { card: string } & Record<string, unknown>) {
		if (view?.card !== 'highlight') return;
		const documentId = view.documentId as string;
		const marks = view.marks as { quote: string; note: string; severity: 'high' | 'medium' | 'low' | 'info' }[];
		for (const mark of marks) pages.add(documentId, mark.quote, mark.note, mark.severity);
		// Reading is what turns a quote into a place, and it takes a moment —
		// start it now rather than when the viewer opens.
		if (marks.length) void pages.read(documentId);
	}

	function showOnPage(documentId: string, quote: string) {
		viewing = documentId;
		const highlight = pages
			.forDocument(documentId)
			.find((candidate) => candidate.quote === quote);
		if (highlight) pages.reveal(highlight.id);
	}

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
				brain: brain.payload(),
				// Only greet a cold start; mid-conversation, just start listening.
				greet: conversation.isEmpty
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
				brain: brain.payload(),
				signal: abort.signal
			})) {
				conversation.applyAgentEvent(event);
				if (event.type === 'tool-result') absorbMarks(event.view as never);
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
		documents.clear();
		pages.clear();
		viewing = null;
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
		<a class="brand" href="/" aria-label="Verity, regulations assistant">
			<Logo size={30} />
			<span>Verity</span>
		</a>

		<div class="bar-actions">
			{#if unlocked}
				<button class="bar-button" type="button" onclick={startOver} disabled={conversation.isEmpty}>
					<Icon icon={Comment01Icon} size={17} />
					<span>New</span>
				</button>
				<button
					class="bar-button icon-only"
					type="button"
					aria-label="Settings"
					title="Settings"
					onclick={() => (settingsOpen = true)}
				>
					<Icon icon={Settings02Icon} size={18} />
				</button>
			{/if}
		</div>
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
				{#if !unlocked}
					<p class="status">Add a key to begin.</p>
				{:else if !session.realtimeAvailable}
					<p class="status">Voice needs Realtime access on this key.</p>
				{:else if voiceActive}
					<p class="status">Interrupting is fine.</p>
				{/if}
			</div>
		</section>

		<section class="work-col">
			{#if !unlocked}
				<div class="pane">
					<KeyGate onready={() => (unlocked = true)} />
				</div>
			{:else}
				<div class="pane">
					{#if conversation.isEmpty}
						<div class="opening">
							<h2>What are you checking?</h2>
							<p>
								Verity reads the live Code of Federal Regulations before she answers, and cites what
								she read.
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
						<Transcript onshow={showOnPage} />
					{/if}
				</div>

				{#if conversation.citations.length}
					<div class="rail" aria-label="Regulations cited in this session">
						{#each conversation.citations as citation (citation.citation)}
							<a
								href={citation.url}
								target="_blank"
								rel="noopener noreferrer"
								title={citation.heading}
							>
								{citation.citation}
							</a>
						{/each}
					</div>
				{/if}

				<div class="composer-slot">
					<Composer
						bind:this={composer}
						busy={textBusy}
						disabled={textBusy}
						placeholder={voiceActive ? 'Type while you talk…' : 'Ask about a regulation…'}
						onsend={send}
						onstop={stopTurn}
						onopen={(id) => (viewing = id)}
					/>
				</div>
			{/if}
		</section>
	</main>
</div>

<DocumentViewer documentId={viewing} onclose={() => (viewing = null)} />

<SettingsDialog
	open={settingsOpen}
	onclose={() => (settingsOpen = false)}
	oncharacter={switchCharacter}
	onforget={() => {
		startOver();
		session.forgetKey();
		unlocked = false;
	}}
/>

<style>
	.app {
		height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	/* ------------------------------------------------------------------ bar */

	/*
	 * The bar floats over the content rather than sitting above it, so a long
	 * answer scrolls up behind frosted glass instead of being clipped by a
	 * hard edge. Thin, because it holds two controls and a name.
	 */
	.bar {
		position: fixed;
		inset: 0 0 auto;
		z-index: 40;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 clamp(14px, 2.4vw, 30px);
		background: color-mix(in srgb, var(--ground) 72%, transparent);
		backdrop-filter: blur(18px) saturate(140%);
		-webkit-backdrop-filter: blur(18px) saturate(140%);
		border-bottom: 1px solid transparent;
		transition: border-color 200ms var(--ease);
	}

	/* The rule appears only once something has scrolled behind the glass. The
	   class is set by the transcript, hence :global. */
	.app:has(:global(.scrolled)) .bar {
		border-bottom-color: var(--line);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.brand span {
		font-size: 16px;
		font-weight: 680;
		letter-spacing: -0.025em;
	}

	.bar-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.bar-button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 34px;
		padding: 0 14px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		color: var(--ink-soft);
		font-size: 13px;
		font-weight: 620;
		cursor: pointer;
		transition:
			background 160ms var(--ease),
			color 160ms var(--ease),
			opacity 160ms var(--ease);
	}

	.bar-button.icon-only {
		width: 34px;
		padding: 0;
		justify-content: center;
	}

	.bar-button:hover:not(:disabled) {
		background: var(--surface);
		color: var(--accent);
	}

	.bar-button:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* ----------------------------------------------------------------- main */

	main {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(300px, 0.8fr) minmax(0, 1.2fr);
		gap: clamp(14px, 2.4vw, 34px);
		padding: 0 clamp(14px, 2.4vw, 30px) clamp(12px, 1.6vw, 20px);
		max-width: 1500px;
		width: 100%;
		margin: 0 auto;
	}

	main > * {
		min-width: 0;
	}

	.stage-col {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		align-content: center;
		gap: 14px;
		min-height: 0;
		padding-top: 56px;
	}

	/*
	 * No card. She sits on the page itself, with light pooled under her — a
	 * bordered rectangle around a character reads as a widget, and she is
	 * meant to read as someone in the room.
	 */
	.stage-frame {
		position: relative;
		min-height: 0;
		/* She has a comfortable size; past it a tall window just inflates her. */
		width: 100%;
		max-width: 400px;
		max-height: min(46vh, 430px);
		margin: 0 auto;
	}

	.controls {
		display: grid;
		justify-items: center;
		gap: 10px;
		text-align: center;
		padding-bottom: 6px;
	}

	.status {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--muted);
		max-width: 30ch;
	}

	/* ------------------------------------------------------------ work col */

	.work-col {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 0;
	}

	.pane {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* Content clears the bar, then scrolls up under it. */
	.pane :global(.scroller) {
		padding-top: 68px;
	}

	.opening {
		flex: 1;
		display: grid;
		align-content: center;
		gap: 10px;
		max-width: 52ch;
		padding-top: 56px;
	}

	.opening h2 {
		margin: 0;
		font-size: clamp(25px, 3.2vw, 33px);
		font-weight: 700;
		letter-spacing: -0.032em;
		line-height: 1.12;
	}

	.opening p {
		margin: 0;
		font-size: 15px;
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.suggestions {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.suggestions button {
		width: 100%;
		text-align: left;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 16px;
		padding: 13px 17px;
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

	/* ----------------------------------------------------------------- rail */

	.rail {
		flex: none;
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 2px;
		scrollbar-width: none;
		mask-image: linear-gradient(to right, #000 92%, transparent);
	}

	.rail::-webkit-scrollbar {
		display: none;
	}

	.rail a {
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

	.rail a:hover {
		background: color-mix(in srgb, var(--accent) 20%, white);
	}

	.composer-slot {
		flex: none;
	}

	/* --------------------------------------------------------------- mobile */

	/*
	 * A phone gets the chat-app shape: the robot stays visible as a compact
	 * band, the transcript scrolls in its own pane, and the composer never
	 * leaves the bottom of the screen.
	 */
	@media (max-width: 900px) {
		main {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
			gap: 8px;
			padding-bottom: max(10px, env(safe-area-inset-bottom));
		}

		.stage-col {
			grid-template-columns: 104px minmax(0, 1fr);
			grid-template-rows: none;
			grid-template-areas: 'robot controls';
			align-items: center;
			gap: 14px;
			padding-top: 60px;
		}

		.stage-frame {
			grid-area: robot;
			width: 104px;
			height: 104px;
		}

		.controls {
			grid-area: controls;
			justify-items: start;
			text-align: left;
			gap: 6px;
			padding-bottom: 0;
		}

		.status {
			max-width: none;
			font-size: 12px;
		}

		.pane :global(.scroller) {
			padding-top: 6px;
		}

		.opening {
			align-content: start;
			padding-top: 4px;
		}

		.opening h2 {
			font-size: 24px;
		}
	}

	@media (max-width: 900px) and (max-height: 680px) {
		.stage-frame {
			width: 84px;
			height: 84px;
		}
	}

	@media (max-width: 400px) {
		.bar-button:not(.icon-only) span {
			display: none;
		}

		.bar-button:not(.icon-only) {
			width: 34px;
			padding: 0;
			justify-content: center;
		}
	}
</style>
