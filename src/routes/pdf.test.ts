import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';
import type { AnalysisResult } from '$lib/history';

// ---------------------------------------------------------------------------
// Mock jsPDF — capturé globalement pour vérifier les appels
// ---------------------------------------------------------------------------

const mockSave  = vi.fn();
const mockText  = vi.fn();
const mockImage = vi.fn();
const mockSetFont = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTextColor = vi.fn();
const mockSetFillColor = vi.fn();
const mockRect  = vi.fn();
const mockLine  = vi.fn();
const mockGetStringUnitWidth = vi.fn().mockReturnValue(10);
const mockInternal = { scaleFactor: 1, pageSize: { getWidth: () => 210, getHeight: () => 297 } };

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
			rect: mockRect,
			line: mockLine,
			getStringUnitWidth: mockGetStringUnitWidth,
			internal: mockInternal,
			splitTextToSize: (_txt: string) => [_txt],
			setDrawColor: vi.fn()
		};
	}
	return { default: JsPDF, jsPDF: JsPDF };
});

// ---------------------------------------------------------------------------
// Fixture SSE
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function sseChunk(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const MOCK_RESULT: AnalysisResult = {
	sujet:        'Ferrari 488 Pista en virage',
	type_photo:   'Rolling shot',
	lumiere:      'Lumière dorée en fin de journée, contrejour maîtrisé.',
	composition:  'Angle bas accentuant la puissance du bolide.',
	ameliorations: [
		"Réduire l'exposition de 0,5 EV",
		'Tenter un panning plus lent'
	],
	retouche: {
		style:        'Cinématique contrasté',
		colorimetrie: 'Tons chauds avec pointe de teal',
		exposition:   '+0,3 EV global',
		finition:     'Grain léger 15%'
	},
	score: 9
};

function makeCompleteStream(result: AnalysisResult = MOCK_RESULT): Response {
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

// ---------------------------------------------------------------------------
// Setup : amène le composant à l'état "résultat affiché"
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

async function renderWithResult(result: AnalysisResult = MOCK_RESULT): Promise<void> {
	fetchMock = vi.fn()
		.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ preview: btoa('fake-jpeg'), metadata: { camera: 'Canon R5' } })
		})
		.mockReturnValueOnce(makeCompleteStream(result));

	vi.stubGlobal('fetch', fetchMock);
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview');

	render(Page);

	const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
	const file = new File([new Uint8Array(512)], 'DSC_0042.ARW');
	fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
	fireEvent.drop(dropzone,     { dataTransfer: { files: [file], types: ['Files'] } });

	await waitFor(() =>
		expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
	);

	fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

	await waitFor(() => expect(screen.getByText(result.sujet)).toBeInTheDocument());
}

// ---------------------------------------------------------------------------
// US-B2 — Export PDF
// ---------------------------------------------------------------------------

describe('US-B2 — Export rapport PDF', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockSave.mockClear();
		mockText.mockClear();
		mockImage.mockClear();
	});

	// ── Visibilité du bouton ──────────────────────────────────────────────────

	describe('Bouton "Exporter en PDF"', () => {
		it("n'est pas visible avant que l'analyse soit affichée", () => {
			vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
			render(Page);
			expect(screen.queryByRole('button', { name: /exporter en pdf/i })).not.toBeInTheDocument();
		});

		it("est visible dans le panneau une fois l'analyse affichée", async () => {
			await renderWithResult();
			expect(screen.getByRole('button', { name: /exporter en pdf/i })).toBeInTheDocument();
		});
	});

	// ── Génération côté client ────────────────────────────────────────────────

	describe('Génération côté client', () => {
		it("ne déclenche aucun appel réseau supplémentaire lors du clic", async () => {
			await renderWithResult();
			const callCountBefore = fetchMock.mock.calls.length;

			fireEvent.click(screen.getByRole('button', { name: /exporter en pdf/i }));

			await waitFor(() => expect(mockSave).toHaveBeenCalled());
			expect(fetchMock.mock.calls.length).toBe(callCountBefore);
		});

		it("appelle jsPDF.save() avec le nom de fichier correct", async () => {
			await renderWithResult();
			fireEvent.click(screen.getByRole('button', { name: /exporter en pdf/i }));

			await waitFor(() => expect(mockSave).toHaveBeenCalled());
			expect(mockSave).toHaveBeenCalledWith('analyse-DSC_0042.pdf');
		});
	});

	// ── Contenu du PDF ────────────────────────────────────────────────────────

	describe('Contenu du PDF', () => {
		async function clickExport() {
			await renderWithResult();
			fireEvent.click(screen.getByRole('button', { name: /exporter en pdf/i }));
			await waitFor(() => expect(mockSave).toHaveBeenCalled());
		}

		it("inclut le score dans le contenu généré", async () => {
			await clickExport();
			const allTextCalls = mockText.mock.calls.map((args) => String(args[0]));
			expect(allTextCalls.some(t => t.includes('9'))).toBe(true);
		});

		it("inclut le type de photo dans le contenu généré", async () => {
			await clickExport();
			const allTextCalls = mockText.mock.calls.map((args) => String(args[0]));
			expect(allTextCalls.some(t => t.includes(MOCK_RESULT.type_photo))).toBe(true);
		});

		it("inclut la lumière dans le contenu généré", async () => {
			await clickExport();
			const allTextCalls = mockText.mock.calls.map((args) => String(args[0]));
			expect(allTextCalls.some(t => t.includes(MOCK_RESULT.lumiere))).toBe(true);
		});

		it("inclut la composition dans le contenu généré", async () => {
			await clickExport();
			const allTextCalls = mockText.mock.calls.map((args) => String(args[0]));
			expect(allTextCalls.some(t => t.includes(MOCK_RESULT.composition))).toBe(true);
		});

		it("inclut les axes d'amélioration dans le contenu généré", async () => {
			await clickExport();
			const allTextCalls = mockText.mock.calls.map((args) => String(args[0]));
			const joined = allTextCalls.join(' ');
			for (const axe of MOCK_RESULT.ameliorations) {
				expect(joined).toContain(axe);
			}
		});

		it("inclut la direction de retouche dans le contenu généré", async () => {
			await clickExport();
			const allTextCalls = mockText.mock.calls.map((args) => String(args[0]));
			const joined = allTextCalls.join(' ');
			expect(joined).toContain(MOCK_RESULT.retouche.style);
		});

		it("inclut l'aperçu de la photo via addImage", async () => {
			await clickExport();
			expect(mockImage).toHaveBeenCalled();
		});
	});
});
