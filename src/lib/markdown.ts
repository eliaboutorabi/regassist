/**
 * A deliberately small markdown renderer for assistant prose.
 *
 * The model is instructed not to decorate, so this covers only what actually
 * turns up: emphasis, inline code, links, and simple lists. Everything is
 * escaped before any markup is introduced, so model output can never inject
 * HTML — which matters more here than feature coverage, since the text is
 * partly steered by whatever document the user pasted in.
 */

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function inline(text: string): string {
	return (
		escapeHtml(text)
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
			// Only http(s) links, and only ones the escape pass already made inert.
			.replace(
				/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
				'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
			)
			.replace(
				/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
				'$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
			)
	);
}

/** Render a subset of markdown to HTML. Input is treated as untrusted. */
export function renderMarkdown(source: string): string {
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	const html: string[] = [];
	let listTag: 'ul' | 'ol' | null = null;
	let paragraph: string[] = [];

	const closeParagraph = () => {
		if (!paragraph.length) return;
		html.push(`<p>${inline(paragraph.join(' '))}</p>`);
		paragraph = [];
	};
	const closeList = () => {
		if (!listTag) return;
		html.push(`</${listTag}>`);
		listTag = null;
	};

	for (const line of lines) {
		const trimmed = line.trim();

		if (!trimmed) {
			closeParagraph();
			closeList();
			continue;
		}

		const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
		if (heading) {
			closeParagraph();
			closeList();
			const level = Math.min(heading[1].length + 2, 6);
			html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
			continue;
		}

		const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
		const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);

		if (bullet || ordered) {
			closeParagraph();
			const wanted = bullet ? 'ul' : 'ol';
			if (listTag !== wanted) {
				closeList();
				html.push(`<${wanted}>`);
				listTag = wanted;
			}
			html.push(`<li>${inline(bullet ? bullet[1] : ordered![2])}</li>`);
			continue;
		}

		closeList();
		paragraph.push(trimmed);
	}

	closeParagraph();
	closeList();
	return html.join('');
}
