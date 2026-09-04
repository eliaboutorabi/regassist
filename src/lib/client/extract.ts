/**
 * Pulling text out of a dropped file, in the browser.
 *
 * Extraction stays client-side on purpose: the document never reaches our
 * server except as part of a turn the user actually sent.
 */

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'rtf'];

export const SUPPORTED_HINT = 'Plain text, Markdown, CSV, JSON and PDF are supported.';

const MAX_BYTES = 12 * 1024 * 1024;

function extensionOf(name: string): string {
	return name.split('.').pop()?.toLowerCase() ?? '';
}

export function isSupportedDocument(file: File): boolean {
	const extension = extensionOf(file.name);
	return (
		TEXT_EXTENSIONS.includes(extension) ||
		extension === 'pdf' ||
		file.type.startsWith('text/') ||
		file.type === 'application/json' ||
		file.type === 'application/pdf'
	);
}

export async function extractText(file: File): Promise<string> {
	if (file.size > MAX_BYTES) {
		throw new Error(`${file.name} is larger than 12 MB.`);
	}

	if (extensionOf(file.name) === 'pdf' || file.type === 'application/pdf') {
		return extractPdfText(file);
	}
	return file.text();
}

/**
 * PDF.js is a large dependency, so it is only fetched when someone actually
 * drops a PDF — a session that never does pays nothing for the capability.
 */
async function extractPdfText(file: File): Promise<string> {
	const pdfjs = await import('pdfjs-dist');
	const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

	// The loading task owns the worker; destroying it is what releases both.
	const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
	const pages: string[] = [];

	try {
		const pdf = await task.promise;
		for (let number = 1; number <= pdf.numPages; number += 1) {
			const page = await pdf.getPage(number);
			const content = await page.getTextContent();
			const text = content.items
				.map((item) => ('str' in item ? item.str : ''))
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim();
			if (text) pages.push(text);
			page.cleanup();
		}
	} finally {
		await task.destroy();
	}

	if (!pages.length) {
		throw new Error(
			`No text layer was found in ${file.name}. Scanned PDFs need OCR before they can be reviewed.`
		);
	}
	return pages.join('\n\n');
}
