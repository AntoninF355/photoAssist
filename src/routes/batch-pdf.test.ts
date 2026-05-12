import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';
import type { AnalysisResult } from '$lib/history';

// ---------------------------------------------------------------------------
// Mock jsPDF
// ---------------------------------------------------------------------------

const mockSave      = vi.fn();
const mockText      = vi.fn();
const mockImage     = vi.fn();
const mockSetFont   = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTextColor = vi.fn();
const mockSetFillColor = vi.fn();
const mockSetDrawColor = vi.fn();
const mockRect      = vi.fn();
const mockLine      = vi.fn();
const mockInternal  = { scaleFactor: 1, pageSize: { getWidth: () => 210, getHeight: () => 297 } };

vi.mock('jspdf', () => {
	function JsPDF() {
		return {
			save: mockSave,
			text: mockText,
			addImage: mockImage,
			setFont: mockSetFont,
			setFontSize: mockSetFontSize,
			setTextColor: mockSetTextColor,
			setFillColor: mockSetFillColor,
			setDrawColor: mockSetDrawColor,
			rect: mockRect,
			line: mockLine,
			internal: mockInternal,
			splitTextToSize: (_txt: string) => [_txt],
			addPage: vi.fn()
		};
	}
	return { default: JsPDF, jsPDF: JsPDF };
});

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function sseChunk(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function makeCompleteStream(result: AnalysisResult): Response {
	const chunks = [
		sseChunk('step',   { step: 'Lecture de la photo' }),
		sseChunk('result', result),
		sseChunk('done',   {})
	];
	let i = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(c) { i < chunks.length ? c.enqueue(chunks[i++]) : c.close(); }
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

function previewOk() {
	return {
		ok: true,
		json: () => Promise.resolve({ preview: btoa('fake-jpeg'), metadata: { camera: 'Canon R5' } })
	};
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(score: number, sujet = `Sujet score ${score}`, filename = `photo${score}.ARW`): AnalysisResult & { _filename?: string } {
	return {
		sujet,
		type_photo: 'Rolling shot',
		lumiere:    'Lumière dorée',
		composition:'Angle bas',
		ameliorations: ['Conseil A', 'Conseil B'],
		retouche: { style: 'Cinéma', colorimetrie: 'Teal', exposition: '+0.3', finition: 'Grain' },
		score
	};
}

function rawFile(name: string): File {
	return new File([new Uint8Array(64)], name);
}

// ---------------------------------------------------------------------------
// Helper : amène le composant à l'état "lot analysé"
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

async function renderWithBatchDone(results: Array<{ score: number; sujet: string; file: string }>) {
	fetchMock = vi.fn();
	for (const { score, sujet } of results) {
		fetchMock
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(makeCompleteStream(makeResult(score, sujet)));
	}
	vi.stubGlobal('fetch', fetchMock);
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
	vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

	render(Page);

	const files = results.map(r => rawFile(r.file));
	const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
	fireEvent.dragOver(dropzone, { dataTransfer: { files, types: ['Files'] } });
	fireEvent.drop(dropzone,     { dataTransfer: { files, types: ['Files'] } });

	await waitFor(() =>
		expect(screen.getByRole('button', { name: /lancer l.analyse/i })).toBeInTheDocument()
	);
	fireEvent.click(screen.getByRole('button', { name: /lancer l.analyse/i }));

	// Attend la fin de toutes les analyses
	await waitFor(() =>
		expect(screen.getByRole('button', { name: /rapport/i })).toBeInTheDocument(),
		{ timeout: 5000 }
	);
}

// ---------------------------------------------------------------------------
// US — Export PDF du rapport de lot
// ---------------------------------------------------------------------------

describe('US — Export PDF du rapport de lot', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockSave.mockClear();
		mockText.mockClear();
		mockImage.mockClear();
		localStorage.clear();
	});

	// ── Visibilité du bouton ──────────────────────────────────────────────────

	describe('Bouton "Exporter en PDF"', () => {
		it("n'est pas visible avant que l'analyse du lot soit terminée", () => {
			vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
			render(Page);
			expect(screen.queryByRole('button', { name: /exporter.*pdf/i })).not.toBeInTheDocument();
		});

		it('est visible dans le panneau une fois le lot analysé', async () => {
			await renderWithBatchDone([
				{ score: 8, sujet: 'Ferrari en virage', file: 'ferrari.ARW' },
				{ score: 6, sujet: 'Lamborghini drift',  file: 'lambo.NEF'   }
			]);

			expect(screen.getByRole('button', { name: /exporter.*pdf/i })).toBeInTheDocument();
		});
	});

	// ── Génération côté client ────────────────────────────────────────────────

	describe('Génération côté client', () => {
		it("ne déclenche aucun appel réseau supplémentaire lors du clic", async () => {
			await renderWithBatchDone([
				{ score: 7, sujet: 'Sujet A', file: 'a.ARW' },
				{ score: 5, sujet: 'Sujet B', file: 'b.CR3' }
			]);

			const callsBefore = fetchMock.mock.calls.length;
			fireEvent.click(screen.getByRole('button', { name: /exporter.*pdf/i }));

			await waitFor(() => expect(mockSave).toHaveBeenCalled());
			expect(fetchMock.mock.calls.length).toBe(callsBefore);
		});

		it("appelle jsPDF.save() avec un nom de fichier contenant 'rapport-lot' et la date", async () => {
			await renderWithBatchDone([
				{ score: 9, sujet: 'Sujet C', file: 'c.DNG' },
				{ score: 7, sujet: 'Sujet D', file: 'd.ARW' }
			]);

			fireEvent.click(screen.getByRole('button', { name: /exporter.*pdf/i }));
			await waitFor(() => expect(mockSave).toHaveBeenCalled());

			const filename: string = mockSave.mock.calls[0][0];
			expect(filename).toMatch(/^rapport-lot-\d{4}-\d{2}-\d{2}\.pdf$/);
		});
	});

	// ── Contenu du PDF ────────────────────────────────────────────────────────

	describe('Contenu du PDF', () => {
		async function clickExportLot() {
			await renderWithBatchDone([
				{ score: 9, sujet: 'McLaren 720S en drift',   file: 'mclaren.ARW' },
				{ score: 6, sujet: 'Aston Martin statique',   file: 'aston.NEF'   }
			]);
			mockText.mockClear();
			fireEvent.click(screen.getByRole('button', { name: /exporter.*pdf/i }));
			await waitFor(() => expect(mockSave).toHaveBeenCalled());
		}

		it("inclut le nom du fichier de chaque photo analysée", async () => {
			await clickExportLot();
			const allText = mockText.mock.calls.map((a) => String(a[0])).join(' ');
			expect(allText).toContain('mclaren.ARW');
			expect(allText).toContain('aston.NEF');
		});

		it("inclut le score de chaque photo", async () => {
			await clickExportLot();
			const allText = mockText.mock.calls.map((a) => String(a[0])).join(' ');
			expect(allText).toContain('9');
			expect(allText).toContain('6');
		});

		it("inclut le sujet de chaque photo", async () => {
			await clickExportLot();
			const allText = mockText.mock.calls.map((a) => String(a[0])).join(' ');
			expect(allText).toContain('McLaren 720S en drift');
			expect(allText).toContain('Aston Martin statique');
		});

		it("inclut le type de photo de chaque résultat", async () => {
			await clickExportLot();
			const allText = mockText.mock.calls.map((a) => String(a[0])).join(' ');
			expect(allText).toContain('Rolling shot');
		});

		it("inclut un aperçu image pour chaque photo analysée via addImage", async () => {
			await clickExportLot();
			// 2 photos analysées avec succès → au moins 2 appels addImage
			expect(mockImage.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
	});
});
