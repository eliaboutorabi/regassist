<script lang="ts">
	/**
	 * The document, with Verity's marks on it.
	 *
	 * Pages render from the original file through pdf.js and stack in one
	 * continuous scroll, so a six-page memo reads as six pages rather than a
	 * widget with a page counter. Mistral's segmentation lands on top as boxes,
	 * and a highlight is one of those boxes tinted by severity.
	 *
	 * Pages render as they approach the viewport, so a long document costs what
	 * you actually look at. The aspect ratio is reserved before anything is
	 * drawn — a column of flat canvases that each jump to full height as they
	 * render is the layout moving under someone trying to read it.
	 *
	 * (The lazy-render and aspect-reservation approach is carried over from the
	 * Rowbot source view.)
	 */
	import { onMount, tick } from 'svelte';
	import { Cancel01Icon, Loading03Icon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
	import Icon from './Icon.svelte';
	import { openDocument, pageTextRuns, renderPage as drawPage, type TextRun } from '$lib/client/pdf';
	import { locateInRuns } from '$lib/text-locate';
	import { documents } from '$lib/state/documents.svelte';
	import { pages as reader } from '$lib/state/pages.svelte';
	import { session } from '$lib/state/session.svelte';

	interface Props {
		documentId: string | null;
		onclose: () => void;
	}
	let { documentId, onclose }: Props = $props();

	const document_ = $derived(documentId ? documents.get(documentId) : undefined);
	const status = $derived(documentId ? reader.status(documentId) : 'idle');
	const ocrPages = $derived(documentId ? reader.pages(documentId) : []);
	const readError = $derived(documentId ? reader.error(documentId) : null);
	const highlights = $derived(documentId ? reader.forDocument(documentId) : []);

	let dialog = $state<HTMLDialogElement | null>(null);
	let scroller = $state<HTMLDivElement | null>(null);
	let showBoxes = $state(true);
	let pageCount = $state(0);
	let shape = $state<{ width: number; height: number } | null>(null);
	let renderError = $state<string | null>(null);

	/**
	 * The page's own text, in the OCR's coordinate space.
	 *
	 * OCR blocks are the fallback, not the target: Mistral segments a numbered
	 * list as one block, so four findings inside it would share one rectangle.
	 * The PDF knows where it drew every word, so when there is a text layer the
	 * mark goes on the sentence. A scan has none, and keeps the block.
	 */
	let runs = $state<Record<number, TextRun[]>>({});

	const pageEls = $state<HTMLElement[]>([]);
	const canvases = $state<HTMLCanvasElement[]>([]);
	// Plain sets: render bookkeeping no template reads.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const drawn = new Set<number>();

	/* eslint-disable @typescript-eslint/no-explicit-any */
	// Plain, not `$state`: a state proxy around a pdf.js document breaks its
	// internals. `pdfReady` ticks instead, so effects have something to track.
	let pdf: any = null;
	let opening: Promise<void> | null = null;
	let pdfReady = $state(0);

	$effect(() => {
		if (!dialog) return;
		if (documentId && !dialog.open) dialog.showModal();
		if (!documentId && dialog.open) dialog.close();
	});

	/** Reset everything when a different document is opened. */
	$effect(() => {
		const id = documentId;
		if (!id) return;

		pdf = null;
		opening = null;
		pdfReady = 0;
		drawn.clear();
		runs = {};
		pageCount = 0;
		shape = null;
		renderError = null;

		void reader.read(id);
		void ensurePdf(id);
	});

	async function ensurePdf(id: string): Promise<void> {
		const url = documents.sourceUrl(id);
		if (!url) return;

		opening ??= openDocument(url)
			.then(async (doc: any) => {
				pdf = doc;
				pageCount = doc.numPages;
				const first = await doc.getPage(1);
				const { width, height } = first.getViewport({ scale: 1 });
				shape = { width, height };
				pdfReady += 1;
			})
			.catch((cause: unknown) => {
				renderError = cause instanceof Error ? cause.message : 'That file could not be opened.';
			});
		return opening;
	}

	async function draw(index: number) {
		const canvas = canvases[index];
		if (!canvas || drawn.has(index) || !pdf) return;
		drawn.add(index);

		try {
			const page = await pdf.getPage(index + 1);
			const unscaled = page.getViewport({ scale: 1 });
			const cssWidth = canvas.parentElement?.clientWidth || 640;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			const viewport = page.getViewport({ scale: (cssWidth / unscaled.width) * ratio });

			canvas.width = viewport.width;
			canvas.height = viewport.height;
			const context = canvas.getContext('2d');
			if (context) await drawPage(page, canvas, context, viewport);
		} catch (cause) {
			drawn.delete(index);
			renderError = cause instanceof Error ? cause.message : 'That page could not be drawn.';
		}
	}

	/** Read the text layer once both the file and the segmentation are in. */
	$effect(() => {
		const ocr = ocrPages;
		// Both reads are dependencies: the runs can only be taken once the file
		// is open *and* the segmentation has said what shape each page is.
		if (!pdfReady || !ocr.length || !pdf) return;

		let cancelled = false;
		void (async () => {
			const collected: Record<number, TextRun[]> = {};
			for (const page of ocr) {
				if (cancelled) return;
				if (!page.width || !page.height) continue;
				try {
					collected[page.index] = await pageTextRuns(pdf, page.index + 1, {
						width: page.width,
						height: page.height
					});
				} catch {
					// No text layer, or a page pdf.js will not give up. The block
					// box is a perfectly serviceable answer.
				}
			}
			if (!cancelled) runs = collected;
		})();

		return () => {
			cancelled = true;
		};
	});

	/** Draw on approach rather than all at once. */
	$effect(() => {
		if (!pageCount || !scroller) return;
		void pageCount;

		const near = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					void draw(Number((entry.target as HTMLElement).dataset.page));
				}
			},
			{ root: scroller, rootMargin: '700px 0px' }
		);

		void tick().then(() => {
			for (const el of pageEls) if (el) near.observe(el);
			// Page one is on screen already; waiting to be told so shows as a
			// white rectangle that fills in a beat later.
			void draw(0);
		});

		return () => near.disconnect();
	});

	/**
	 * Where each highlight lands, as page-relative percentages.
	 *
	 * Percentages rather than pixels because the canvas is sized by CSS and the
	 * OCR's coordinate space is its own — normalising once here means the
	 * overlay is correct at any zoom without recomputing anything.
	 */
	interface Marker {
		id: string;
		page: number;
		left: number;
		top: number;
		width: number;
		height: number;
		note: string;
		severity: string;
		quote: string;
	}

	const markers = $derived.by<Marker[]>(() => {
		if (!ocrPages.length) return [];
		const found: Marker[] = [];

		for (const highlight of highlights) {
			// The text layer is more precise than the block, so try every page's
			// runs first and only fall back to segmentation when none matches.
			let placed = false;

			for (const page of ocrPages) {
				if (!page.width || !page.height) continue;
				const box = locateInRuns(highlight.quote, runs[page.index] ?? []);
				if (!box) continue;
				found.push({
					id: highlight.id,
					page: page.index,
					left: (box.x / page.width) * 100,
					top: (box.y / page.height) * 100,
					width: (box.width / page.width) * 100,
					height: (box.height / page.height) * 100,
					note: highlight.note,
					severity: highlight.severity,
					quote: highlight.quote
				});
				placed = true;
				break;
			}
			if (placed) continue;

			for (const match of reader.locate(highlight)) {
				const page = ocrPages.find((candidate) => candidate.index === match.page);
				if (!page?.width || !page?.height) continue;
				found.push({
					id: highlight.id,
					page: match.page,
					left: (match.box.x / page.width) * 100,
					top: (match.box.y / page.height) * 100,
					width: (match.box.width / page.width) * 100,
					height: (match.box.height / page.height) * 100,
					note: highlight.note,
					severity: highlight.severity,
					quote: highlight.quote
				});
			}
		}
		return found;
	});

	const unplaced = $derived(
		status === 'ready' ? highlights.filter((h) => !markers.some((m) => m.id === h.id)) : []
	);

	/** Scroll to whatever was just asked for. */
	$effect(() => {
		const focus = reader.focus;
		if (!focus || !markers.length) return;
		const marker = markers.find((candidate) => candidate.id === focus.id);
		if (!marker) return;
		void tick().then(() => {
			pageEls[marker.page]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	});

	const total = $derived(pageCount || ocrPages.length);
</script>

<dialog
	bind:this={dialog}
	onclose={onclose}
	onclick={(event) => {
		if (event.target === dialog) onclose();
	}}
>
	{#if documentId}
	<div class="sheet">
		<header>
			<div class="title">
				<strong>{document_?.name ?? 'Document'}</strong>
				<small>
					{#if status === 'reading'}
						Reading the page…
					{:else if status === 'ready'}
						{total} page{total === 1 ? '' : 's'} · {markers.length} highlight{markers.length === 1
							? ''
							: 's'}
					{:else if total}
						{total} page{total === 1 ? '' : 's'}
					{/if}
				</small>
			</div>

			<div class="actions">
				{#if markers.length}
					<button
						class="ghost"
						type="button"
						onclick={() => (showBoxes = !showBoxes)}
						aria-pressed={showBoxes}
					>
						<Icon icon={showBoxes ? ViewIcon : ViewOffSlashIcon} size={16} />
						<span>Marks</span>
					</button>
				{/if}
				<button class="close" type="button" onclick={onclose} aria-label="Close document">
					<Icon icon={Cancel01Icon} size={18} />
				</button>
			</div>
		</header>

		{#if status === 'error' && readError}
			<p class="notice" data-tone={session.canOcr ? 'error' : 'info'}>{readError}</p>
		{:else if renderError}
			<p class="notice" data-tone="error">{renderError}</p>
		{/if}

		{#if unplaced.length}
			<p class="notice" data-tone="info">
				{unplaced.length} highlight{unplaced.length === 1 ? '' : 's'} could not be placed on the page.
				{unplaced.map((h) => `“${h.quote.slice(0, 60)}”`).join('  ')}
			</p>
		{/if}

		<div class="scroller" bind:this={scroller}>
			{#if !document_?.file}
				<div class="text-only">
					<p class="notice" data-tone="info">
						This document was pasted in, so there are no pages to draw. The text is still fully
						searchable and reviewable.
					</p>
					<pre>{document_?.text ?? ''}</pre>
				</div>
			{:else}
				{#each Array.from({ length: Math.max(total, 1) }, (_, index) => index) as index (index)}
					<div
						class="page"
						data-page={index}
						bind:this={pageEls[index]}
						style="aspect-ratio: {shape ? `${shape.width} / ${shape.height}` : '17 / 22'}"
					>
						<canvas bind:this={canvases[index]}></canvas>

						{#if showBoxes}
							{#each markers.filter((marker) => marker.page === index) as marker (marker.id + index)}
								<div
									class="marker"
									data-severity={marker.severity}
									style="left: {marker.left}%; top: {marker.top}%; width: {marker.width}%; height: {marker.height}%"
								>
									<span class="marker-note">{marker.note}</span>
								</div>
							{/each}
						{/if}
					</div>
				{/each}
			{/if}

			{#if status === 'reading'}
				<p class="reading"><Icon icon={Loading03Icon} size={16} class="spin" /> Reading the page…</p>
			{/if}
		</div>
	</div>
	{/if}
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
	}

	dialog::backdrop {
		background: color-mix(in srgb, var(--ink) 40%, transparent);
		backdrop-filter: blur(6px);
	}

	.sheet {
		position: absolute;
		inset: 0;
		width: min(880px, calc(100vw - 28px));
		height: min(88dvh, 940px);
		margin: auto;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 22px;
		box-shadow: var(--shadow-float);
		overflow: hidden;
		animation: rise 240ms var(--ease) both;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.99);
		}
	}

	header {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 13px 13px 13px 20px;
		border-bottom: 1px solid var(--line);
	}

	.title {
		display: grid;
		min-width: 0;
	}

	.title strong {
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.015em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title small {
		font-size: 12px;
		color: var(--muted);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		font-size: 12.5px;
		font-weight: 620;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.ghost[aria-pressed='true'] {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
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

	.scroller {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: color-mix(in srgb, var(--ink) 5%, var(--paper));
		padding: 18px;
		display: grid;
		gap: 18px;
		justify-items: center;
	}

	.page {
		position: relative;
		width: 100%;
		max-width: 720px;
		background: white;
		border-radius: 6px;
		box-shadow: 0 1px 2px rgba(18, 22, 47, 0.1), 0 10px 30px -18px rgba(18, 22, 47, 0.5);
		overflow: hidden;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* ------------------------------------------------------------- markers */

	.marker {
		position: absolute;
		border-radius: 4px;
		border: 2px solid var(--severity-info);
		background: color-mix(in srgb, var(--severity-info) 14%, transparent);
		pointer-events: auto;
		animation: mark 420ms var(--ease) both;
	}

	@keyframes mark {
		from {
			opacity: 0;
			transform: scale(1.02);
		}
	}

	.marker[data-severity='high'] {
		border-color: var(--severity-high);
		background: color-mix(in srgb, var(--severity-high) 15%, transparent);
	}

	.marker[data-severity='medium'] {
		border-color: var(--severity-medium);
		background: color-mix(in srgb, var(--severity-medium) 15%, transparent);
	}

	.marker[data-severity='low'] {
		border-color: var(--severity-low);
		background: color-mix(in srgb, var(--severity-low) 14%, transparent);
	}

	.marker-note {
		position: absolute;
		left: 0;
		bottom: calc(100% + 5px);
		max-width: min(340px, 90vw);
		background: var(--ink);
		color: var(--paper);
		font-size: 11.5px;
		line-height: 1.4;
		padding: 5px 9px;
		border-radius: 8px;
		box-shadow: var(--shadow-card);
		opacity: 0;
		transform: translateY(3px);
		transition:
			opacity 160ms var(--ease),
			transform 160ms var(--ease);
		pointer-events: none;
	}

	.marker:hover .marker-note {
		opacity: 1;
		transform: translateY(0);
	}

	/* -------------------------------------------------------------- states */

	.notice {
		flex: none;
		margin: 0;
		padding: 10px 20px;
		font-size: 12.5px;
		line-height: 1.5;
		border-bottom: 1px solid var(--line);
		background: var(--accent-soft);
		color: var(--accent);
	}

	.notice[data-tone='error'] {
		background: color-mix(in srgb, var(--severity-high) 8%, white);
		color: color-mix(in srgb, var(--severity-high) 80%, black);
	}

	.reading {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}

	.text-only {
		width: 100%;
		max-width: 720px;
		display: grid;
		gap: 12px;
	}

	.text-only .notice {
		border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
		border-radius: 12px;
		padding: 10px 14px;
	}

	pre {
		margin: 0;
		white-space: pre-wrap;
		font: inherit;
		font-size: 13.5px;
		line-height: 1.65;
		color: var(--ink-soft);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 16px 18px;
	}
</style>
