import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';
import type { AnalysisResult } from '$lib/history';

// ── SSE helpers ───────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseChunk(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function makeStream(result: AnalysisResult): Response {
	const chunks = [
		sseChunk('step', { step: 'Lecture de la photo' }),
		sseChunk('result', result),
		sseChunk('done', {})
	];
	let i = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(c) { i < chunks.length ? c.enqueue(chunks[i++]) : c.close(); }
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_STYLES = [
	'Rolling shot',
	'Panning',
	'Freeze / circuit',
	'Statique extérieur',
	'Studio',
	'Détail / macro',
	'Drift',
	'Aérien'
];

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
	return {
		sujet: 'Ferrari 488 Pista en virage',
		type_photo: 'Rolling shot',
		lumiere: 'Lumière dorée',
		composition: 'Angle bas',
		ameliorations: ['Conseil 1'],
		retouche: { style: 'Cinéma', colorimetrie: 'Teal', exposition: '+0.3', finition: 'Grain' },
		score: 8,
		...overrides
	};
}

function previewOk() {
	return {
		ok: true,
		json: () => Promise.resolve({ preview: btoa('fake-jpeg'), metadata: { camera: 'Canon R5' } })
	};
}

// ── Setup helpers ─────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

async function renderWithPreview(): Promise<void> {
	fetchMock = vi.fn().mockResolvedValueOnce(previewOk());
	vi.stubGlobal('fetch', fetchMock);
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
	vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

	render(Page);

	const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
	const file = new File([new Uint8Array(512)], 'DSC_0042.ARW');
	fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
	fireEvent.drop(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });

	await waitFor(() =>
		expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
	);
}

async function renderWithResult(result: AnalysisResult): Promise<void> {
	fetchMock = vi.fn()
		.mockResolvedValueOnce(previewOk())
		.mockReturnValueOnce(makeStream(result));
	vi.stubGlobal('fetch', fetchMock);
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
	vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

	render(Page);

	const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
	const file = new File([new Uint8Array(512)], 'DSC_0042.ARW');
	fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
	fireEvent.drop(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });

	await waitFor(() =>
		expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
	);
}

// ── US-C1 — Mode défi ─────────────────────────────────────────────────────────

describe('US-C1 — Mode défi : sélection du style cible', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	// ── Critère 1 : sélecteur de style ───────────────────────────────────────

	describe('Sélecteur de style cible', () => {
		it("est visible après le dépôt d'une photo, avant l'analyse", async () => {
			await renderWithPreview();
			expect(
				screen.getByRole('combobox', { name: /style.*(cible|visé)/i })
			).toBeInTheDocument();
		});

		it('propose exactement les 8 styles automobile', async () => {
			await renderWithPreview();
			const select = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			for (const style of ALL_STYLES) {
				expect(select).toHaveTextContent(style);
			}
		});

		it("a une option par défaut 'Aucun / Détection automatique'", async () => {
			await renderWithPreview();
			const select = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			expect(select).toHaveValue('');
		});

		it("n'est pas visible avant qu'une photo soit chargée", () => {
			vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
			render(Page);
			expect(
				screen.queryByRole('combobox', { name: /style.*(cible|visé)/i })
			).not.toBeInTheDocument();
		});
	});

	// ── Critère 2 : transmission au backend ──────────────────────────────────

	describe('Transmission du style au backend', () => {
		it("envoie le style sélectionné dans le FormData de la requête d'analyse", async () => {
			fetchMock = vi.fn()
				.mockResolvedValueOnce(previewOk())
				.mockReturnValueOnce(makeStream(makeResult()));
			vi.stubGlobal('fetch', fetchMock);
			vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
			vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

			render(Page);
			const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
			const file = new File([new Uint8Array(512)], 'DSC_0042.ARW');
			fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
			fireEvent.drop(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });

			await waitFor(() =>
				expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
			);

			// Sélectionner "Rolling shot"
			const select = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			fireEvent.change(select, { target: { value: 'Rolling shot' } });

			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

			const [, analyzeCallOptions] = fetchMock.mock.calls[1];
			const body = analyzeCallOptions.body as FormData;
			expect(body.get('targetStyle')).toBe('Rolling shot');
		});

		it("n'envoie pas de targetStyle si aucun style n'est sélectionné", async () => {
			fetchMock = vi.fn()
				.mockResolvedValueOnce(previewOk())
				.mockReturnValueOnce(makeStream(makeResult()));
			vi.stubGlobal('fetch', fetchMock);
			vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
			vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

			render(Page);
			const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
			const file = new File([new Uint8Array(512)], 'DSC_0042.ARW');
			fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
			fireEvent.drop(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });

			await waitFor(() =>
				expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
			);

			// Ne pas sélectionner de style — cliquer directement sur Analyser
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

			const [, analyzeCallOptions] = fetchMock.mock.calls[1];
			const body = analyzeCallOptions.body as FormData;
			expect(body.get('targetStyle')).toBeFalsy();
		});
	});

	// ── Critère 4 : affichage dans le résultat ────────────────────────────────

	describe("Affichage du style cible et du verdict dans le résultat", () => {
		it("affiche le style cible choisi dans le panneau de résultat", async () => {
			await renderWithResult(makeResult({ releve_defi: true }));

			const select = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			fireEvent.change(select, { target: { value: 'Rolling shot' } });

			fetchMock.mockReturnValueOnce(makeStream(makeResult({ releve_defi: true })));
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() =>
				expect(screen.getByText(/ferrari/i)).toBeInTheDocument()
			);

			// The challenge block shows "Style cible : Rolling shot" as a single span
			expect(screen.getByText(/style cible.*rolling shot/i)).toBeInTheDocument();
		});

		it("affiche 'relève le défi' quand releve_defi est true", async () => {
			await renderWithResult(makeResult({ releve_defi: true }));

			const select = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			fireEvent.change(select, { target: { value: 'Rolling shot' } });

			fetchMock.mockReturnValueOnce(makeStream(makeResult({ releve_defi: true })));
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() =>
				expect(screen.getByText(/ferrari/i)).toBeInTheDocument()
			);

			expect(screen.getByText(/relève le défi/i)).toBeInTheDocument();
		});

		it("affiche 'ne relève pas le défi' quand releve_defi est false", async () => {
			await renderWithResult(makeResult({ releve_defi: false }));

			const select = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			fireEvent.change(select, { target: { value: 'Panning' } });

			fetchMock.mockReturnValueOnce(makeStream(makeResult({ releve_defi: false })));
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() =>
				expect(screen.getByText(/ferrari/i)).toBeInTheDocument()
			);

			expect(screen.getByText(/ne relève pas le défi/i)).toBeInTheDocument();
		});

		it("n'affiche pas de verdict si aucun style n'est sélectionné", async () => {
			fetchMock = vi.fn()
				.mockResolvedValueOnce(previewOk())
				.mockReturnValueOnce(makeStream(makeResult()));
			vi.stubGlobal('fetch', fetchMock);
			vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
			vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

			render(Page);
			const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
			const file = new File([new Uint8Array(512)], 'DSC_0042.ARW');
			fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
			fireEvent.drop(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });

			await waitFor(() =>
				expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
			);

			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() =>
				expect(screen.getByText(/ferrari/i)).toBeInTheDocument()
			);

			expect(screen.queryByText(/relève.*(le )?défi/i)).not.toBeInTheDocument();
		});
	});

	// ── Critère 5 : reset du sélecteur ────────────────────────────────────────

	describe("Reset du sélecteur entre analyses", () => {
		it("le sélecteur revient à la valeur par défaut après un reset", async () => {
			await renderWithPreview();

			const select = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			fireEvent.change(select, { target: { value: 'Drift' } });
			expect(select).toHaveValue('Drift');

			fireEvent.click(screen.getByRole('button', { name: /nouvelle photo/i, hidden: true }));

			// After reset, drop a new file
			fetchMock.mockResolvedValueOnce(previewOk());
			const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
			const file = new File([new Uint8Array(512)], 'photo2.ARW');
			fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
			fireEvent.drop(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });

			await waitFor(() =>
				expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
			);

			const selectAfterReset = screen.getByRole('combobox', { name: /style.*(cible|visé)/i });
			expect(selectAfterReset).toHaveValue('');
		});
	});
});
