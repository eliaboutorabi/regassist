<script lang="ts">
	/**
	 * Everything about how Verity works, in one place.
	 *
	 * A native `<dialog>` rather than a popover: Escape, the backdrop, focus
	 * trapping and inertness of the page behind all come free and all behave
	 * the way people already expect them to.
	 */
	import {
		AiBrain01Icon,
		Cancel01Icon,
		CheckmarkCircle02Icon,
		Delete02Icon,
		Key01Icon,
		PlusSignIcon,
		SparklesIcon,
		UserCircleIcon
	} from '@hugeicons/core-free-icons';
	import Icon from './Icon.svelte';
	import { brain, MAX_KNOWLEDGE_CHARS } from '$lib/state/brain.svelte';
	import { session } from '$lib/state/session.svelte';
	import { CHARACTERS, CHARACTER_IDS, type CharacterId } from '$lib/voices';

	interface Props {
		open: boolean;
		onclose: () => void;
		oncharacter: (id: CharacterId) => void;
		onforget: () => void;
	}

	let { open, onclose, oncharacter, onforget }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let newSkillName = $state('');
	let newSkillInstructions = $state('');
	let addingSkill = $state(false);
	let mistralDraft = $state('');
	let mistralSaved = $state(false);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	function addSkill() {
		if (brain.addSkill(newSkillName, newSkillInstructions)) {
			newSkillName = '';
			newSkillInstructions = '';
			addingSkill = false;
		}
	}

	function saveMistral() {
		session.setMistralKey(mistralDraft);
		mistralDraft = '';
		mistralSaved = true;
		setTimeout(() => (mistralSaved = false), 2200);
	}

	const maskedKey = $derived(
		session.apiKey ? `${session.apiKey.slice(0, 7)}…${session.apiKey.slice(-4)}` : ''
	);
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={(event) => {
	// Clicking the backdrop closes it; clicking the card does not.
	if (event.target === dialog) onclose();
}}>
	<div class="sheet">
		<header>
			<h2>Settings</h2>
			<button class="close" type="button" onclick={onclose} aria-label="Close settings">
				<Icon icon={Cancel01Icon} size={18} />
			</button>
		</header>

		<div class="body">
			<!-- ------------------------------------------------------ character -->
			<section>
				<h3><Icon icon={UserCircleIcon} size={16} /> Character</h3>
				<p class="hint">Changes her look and her voice. Switching ends a live conversation.</p>
				<div class="characters">
					{#each CHARACTER_IDS as id (id)}
						{@const profile = CHARACTERS[id]}
						<button
							class="character"
							class:selected={session.character === id}
							type="button"
							aria-pressed={session.character === id}
							onclick={() => oncharacter(id)}
						>
							<span class="swatch" data-character={id}></span>
							<span class="character-text">
								<strong>{profile.displayName}</strong>
								<small>{profile.blurb} · {profile.voice}</small>
							</span>
							{#if session.character === id}
								<Icon icon={CheckmarkCircle02Icon} size={17} />
							{/if}
						</button>
					{/each}
				</div>
			</section>

			<!-- ---------------------------------------------------------- model -->
			<section>
				<h3><Icon icon={SparklesIcon} size={16} /> Model</h3>
				<p class="hint">
					{session.availableModels.length
						? 'Everything this key can reach, newest first.'
						: 'Add a key to see what it can reach.'}
				</p>
				<select
					value={session.model}
					disabled={!session.availableModels.length}
					onchange={(event) => session.setModel((event.currentTarget as HTMLSelectElement).value)}
				>
					{#each session.availableModels as model (model)}
						<option value={model}>{model}</option>
					{/each}
				</select>
				<p class="hint" data-ok={session.realtimeAvailable}>
					{session.realtimeAvailable
						? 'Realtime voice is available on this key.'
						: 'This key has no Realtime access, so voice is off. Text works.'}
				</p>
			</section>

			<!-- ------------------------------------------------------ knowledge -->
			<section>
				<h3><Icon icon={AiBrain01Icon} size={16} /> What she knows about you</h3>
				<p class="hint">
					Standing background about your practice — the kind of clients, the entity types, what you
					keep having to explain. Background, never authority: she will still look the rule up.
				</p>
				<textarea
					rows="4"
					maxlength={MAX_KNOWLEDGE_CHARS}
					placeholder="Mostly S-corps and small partnerships in New England. Calendar-year filers. I care about substantiation more than planning."
					value={brain.knowledge}
					oninput={(event) => brain.setKnowledge((event.currentTarget as HTMLTextAreaElement).value)}
				></textarea>
				<p class="count">{brain.knowledge.length} / {MAX_KNOWLEDGE_CHARS}</p>
			</section>

			<!-- --------------------------------------------------------- skills -->
			<section>
				<h3><Icon icon={SparklesIcon} size={16} /> Skills</h3>
				<p class="hint">
					Switched on, she follows these. Switching one off also withholds the tools it needs — it is
					not a suggestion she can weigh against everything else.
				</p>

				<ul class="skills">
					{#each brain.skills as skill (skill.id)}
						<li class:off={!skill.enabled}>
							<label>
								<input
									type="checkbox"
									checked={skill.enabled}
									onchange={() => brain.toggle(skill.id)}
								/>
								<span class="skill-text">
									<strong>{skill.name}</strong>
									<small>{skill.instructions}</small>
								</span>
							</label>
							{#if !skill.builtin}
								<button
									class="delete"
									type="button"
									onclick={() => brain.removeSkill(skill.id)}
									aria-label="Delete {skill.name}"
								>
									<Icon icon={Delete02Icon} size={15} />
								</button>
							{/if}
						</li>
					{/each}
				</ul>

				{#if addingSkill}
					<div class="new-skill">
						<input
							type="text"
							bind:value={newSkillName}
							placeholder="Name it — “Flag anything touching crypto”"
							aria-label="Skill name"
						/>
						<textarea
							bind:value={newSkillInstructions}
							rows="3"
							placeholder="What she should do when it applies."
							aria-label="Skill instructions"
						></textarea>
						<div class="new-skill-actions">
							<button class="ghost" type="button" onclick={() => (addingSkill = false)}>
								Cancel
							</button>
							<button
								class="primary"
								type="button"
								disabled={!newSkillName.trim() || !newSkillInstructions.trim()}
								onclick={addSkill}
							>
								Add skill
							</button>
						</div>
					</div>
				{:else}
					<button class="ghost add" type="button" onclick={() => (addingSkill = true)}>
						<Icon icon={PlusSignIcon} size={15} /> Teach her something
					</button>
				{/if}
			</section>

			<!-- ----------------------------------------------------------- keys -->
			<section>
				<h3><Icon icon={Key01Icon} size={16} /> Keys</h3>

				<div class="key-row">
					<div class="key-text">
						<strong>OpenAI</strong>
						<small>{maskedKey || 'Not set'} · conversation and voice</small>
					</div>
					<button class="ghost danger" type="button" onclick={onforget}>Forget</button>
				</div>

				<div class="key-row stack">
					<div class="key-text">
						<strong>Mistral <span class="optional">optional</span></strong>
						<small>
							{session.canOcr
								? 'Set — she can read a scan and highlight the page.'
								: 'Lets her read a scanned PDF and point at passages on the page.'}
						</small>
					</div>
					{#if session.canOcr}
						<button class="ghost danger" type="button" onclick={() => session.forgetMistralKey()}>
							Forget
						</button>
					{:else}
						<div class="key-entry">
							<input
								type="password"
								bind:value={mistralDraft}
								placeholder="Mistral API key"
								autocomplete="off"
								spellcheck="false"
								aria-label="Mistral API key"
							/>
							<button
								class="primary"
								type="button"
								disabled={!mistralDraft.trim()}
								onclick={saveMistral}
							>
								{mistralSaved ? 'Saved' : 'Save'}
							</button>
						</div>
					{/if}
				</div>

				<p class="hint">
					Both stay in this browser and travel with a request. Neither is written down on the server.
				</p>
			</section>
		</div>
	</div>
</dialog>

<style>
	dialog {
		border: 0;
		padding: 0;
		background: none;
		max-width: none;
		max-height: none;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	dialog::backdrop {
		background: color-mix(in srgb, var(--ink) 34%, transparent);
		backdrop-filter: blur(6px);
	}

	dialog[open] .sheet {
		animation: rise 260ms var(--ease) both;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.985);
		}
	}

	.sheet {
		width: min(560px, calc(100vw - 32px));
		max-height: min(84dvh, 760px);
		margin: auto;
		position: absolute;
		inset: 0;
		height: fit-content;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 24px;
		box-shadow: var(--shadow-float);
		overflow: hidden;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 16px 12px 22px;
		border-bottom: 1px solid var(--line);
		flex: none;
	}

	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 680;
		letter-spacing: -0.02em;
	}

	.close {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 50%;
		background: var(--paper);
		color: var(--muted);
		cursor: pointer;
	}

	.close:hover {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.body {
		overflow-y: auto;
		padding: 4px 22px 22px;
		display: grid;
		gap: 24px;
	}

	section {
		display: grid;
		gap: 8px;
		padding-top: 18px;
	}

	section + section {
		border-top: 1px solid var(--line);
	}

	h3 {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0;
		font-size: 12px;
		font-weight: 780;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.hint {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--muted);
	}

	.hint[data-ok='false'] {
		color: var(--severity-medium);
	}

	.count {
		margin: 0;
		text-align: right;
		font-size: 11px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	/* ---------------------------------------------------------- character */

	.characters {
		display: grid;
		gap: 8px;
	}

	.character {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		text-align: left;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--paper);
		padding: 11px 13px;
		cursor: pointer;
		color: var(--muted);
		transition:
			border-color 160ms var(--ease),
			background 160ms var(--ease);
	}

	.character.selected {
		border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
		background: var(--surface);
		color: var(--accent);
	}

	.swatch {
		width: 26px;
		height: 26px;
		border-radius: 9px;
		flex: none;
	}

	.swatch[data-character='classic'] {
		background: linear-gradient(150deg, #6f5fd0, #3f3583);
	}

	.swatch[data-character='rose'] {
		background: linear-gradient(150deg, #e2749f, #a83a68);
	}

	.character-text {
		flex: 1;
		min-width: 0;
		display: grid;
	}

	.character-text strong {
		font-size: 14.5px;
		font-weight: 620;
		color: var(--ink);
	}

	.character-text small,
	.skill-text small,
	.key-text small {
		font-size: 12px;
		line-height: 1.45;
		color: var(--muted);
	}

	/* ------------------------------------------------------------- inputs */

	select,
	textarea,
	input[type='password'],
	input[type='text'] {
		width: 100%;
		font: inherit;
		font-size: 14px;
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--paper);
		padding: 9px 12px;
	}

	textarea {
		resize: vertical;
		line-height: 1.55;
	}

	select:focus,
	textarea:focus,
	input:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
	}

	/* ------------------------------------------------------------- skills */

	.skills {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}

	.skills li {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		border-radius: 12px;
		padding: 8px 8px 8px 10px;
		transition: opacity 160ms var(--ease);
	}

	.skills li:hover {
		background: var(--paper);
	}

	.skills li.off {
		opacity: 0.5;
	}

	.skills label {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		flex: 1;
		min-width: 0;
		cursor: pointer;
	}

	input[type='checkbox'] {
		margin-top: 3px;
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		flex: none;
		cursor: pointer;
	}

	.skill-text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.skill-text strong {
		font-size: 14px;
		font-weight: 600;
	}

	.delete {
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
		padding: 3px;
		border-radius: 8px;
		flex: none;
	}

	.delete:hover {
		color: var(--severity-high);
	}

	.new-skill {
		display: grid;
		gap: 8px;
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 12px;
		background: var(--paper);
	}

	.new-skill input,
	.new-skill textarea {
		background: var(--surface);
	}

	.new-skill-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	/* --------------------------------------------------------------- keys */

	.key-row {
		display: flex;
		align-items: center;
		gap: 12px;
		justify-content: space-between;
	}

	.key-row.stack {
		flex-wrap: wrap;
	}

	.key-text {
		display: grid;
		gap: 2px;
		min-width: 0;
		flex: 1 1 200px;
	}

	.key-text strong {
		font-size: 14px;
		font-weight: 620;
	}

	.optional {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
		background: var(--paper);
		border-radius: 999px;
		padding: 2px 7px;
		margin-left: 5px;
		vertical-align: 1px;
	}

	.key-entry {
		display: flex;
		gap: 6px;
		flex: 1 1 220px;
	}

	/* ------------------------------------------------------------ buttons */

	button.ghost,
	button.primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: 999px;
		padding: 8px 15px;
		font-size: 13px;
		font-weight: 620;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 160ms var(--ease),
			opacity 160ms var(--ease);
	}

	button.ghost {
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink);
	}

	button.ghost:hover:not(:disabled) {
		background: var(--accent-soft);
	}

	button.ghost.danger:hover {
		background: color-mix(in srgb, var(--severity-high) 10%, white);
		color: var(--severity-high);
	}

	button.ghost.add {
		justify-self: start;
	}

	button.primary {
		border: 0;
		background: var(--ink);
		color: var(--paper);
	}

	button.primary:hover:not(:disabled) {
		background: var(--accent);
	}

	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
