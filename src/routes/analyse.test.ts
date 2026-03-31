import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';

// ---------------------------------------------------------------------------
// Types — contrat du backend SSE
// ---------------------------------------------------------------------------

interface StepEvent {
	step: 'Lecture de la photo' | "Préparation de l'analyse" | 'Analyse en cours';
}

interface AnalysisResult {
	sujet: string;
	type_photo: string;
	lumiere: string;
	composition: string;
	ameliorations: string[];
	score: number; // /10
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const MOCK_RESULT: AnalysisResult = {
	sujet: 'Porsche 911 GT3 en virage serré',
	type_photo: 'Sport automobile — action',
	lumiere: 'Lumière en contre-jour créant un effet dramatique et un halo sur la carrosserie.',
	composition: 'Règle des tiers respectée, bon dynamisme avec la ligne de fuite.',
	ameliorations: [
		"Augmenter légèrement l'exposition pour récupérer les ombres sous le becquet",
		'Essayer un angle plus bas pour accentuer la sensation de vitesse'
	],
	score: 8
};

// ---------------------------------------------------------------------------
// Helpers SSE
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function sseChunk(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Stream contrôlable — permet d'émettre les événements un à un dans les tests.
 */
function createControllableStream() {
	let ctrl!: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });

	return {
		response: new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
		emitStep(step: StepEvent['step']) { ctrl.enqueue(sseChunk('step', { step })); },
		emitResult(result: AnalysisResult = MOCK_RESULT) { ctrl.enqueue(sseChunk('result', result)); },
		emitError(message: string) { ctrl.enqueue(sseChunk('error', { message })); },
		close() { ctrl.close(); }
	};
}

/**
 * Stream complet — émet toutes les étapes + résultat d'un coup.
 */
function makeCompleteStream(result: AnalysisResult = MOCK_RESULT): Response {
	const chunks = [
		sseChunk('step', { step: 'Lecture de la photo' } satisfies StepEvent),
		sseChunk('step', { step: "Préparation de l'analyse" } satisfies StepEvent),
		sseChunk('step', { step: 'Analyse en cours' } satisfies StepEvent),
		sseChunk('result', result),
		sseChunk('done', {})
	];

	let i = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(c) { i < chunks.length ? c.enqueue(chunks[i++]) : c.close(); }
	});

	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

/**
 * Stream qui ne se termine jamais — simule une analyse en cours.
 */
function makeHangingStream(): Response {
	return new Response(new ReadableStream({ start() {} }), {
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

// ---------------------------------------------------------------------------
// Helper de setup : amène le composant à l'état "photo prête"
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

async function renderWithReadyPhoto(): Promise<void> {
	render(Page);
	const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
	const file = new File([new Uint8Array(512)], 'photo.ARW');
	fireEvent.dragOver(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });
	fireEvent.drop(dropzone, { dataTransfer: { files: [file], types: ['Files'] } });

	await waitFor(() =>
		expect(screen.getByRole('img', { name: /aperçu|preview/i })).toBeInTheDocument()
	);
}

// ---------------------------------------------------------------------------
// US — En tant qu'utilisateur, je veux recevoir une analyse IA de ma photo
// ---------------------------------------------------------------------------

describe("US — Analyse IA de la photo", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview');

		// Premier appel fetch = conversion preview — retourne { preview: base64, metadata }
		fetchMock = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				preview: btoa('fake-jpeg'),
				metadata: { camera: 'Sony A7 IV', iso: 800, shutter: 0.001, aperture: 2.8, focal: 85 }
			})
		});
		vi.stubGlobal('fetch', fetchMock);
	});

	// -------------------------------------------------------------------------
	// Panneau latéral
	// -------------------------------------------------------------------------

	describe('Panneau latéral', () => {
		it("n'est pas visible avant le lancement de l'analyse", async () => {
			fetchMock.mockReturnValueOnce(makeHangingStream());
			await renderWithReadyPhoto();

			expect(
				screen.queryByRole('complementary', { name: /résultat|analyse/i })
			).not.toBeInTheDocument();
		});

		it("s'ouvre dynamiquement après clic sur Analyser sans rechargement de page", async () => {
			fetchMock.mockReturnValueOnce(makeHangingStream());
			await renderWithReadyPhoto();

			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() =>
				expect(
					screen.getByRole('complementary', { name: /résultat|analyse/i })
				).toBeInTheDocument()
			);
		});

		it("reste ouvert après réception du résultat", async () => {
			fetchMock.mockReturnValueOnce(makeCompleteStream());
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() =>
				expect(screen.getByText(MOCK_RESULT.sujet)).toBeInTheDocument()
			);

			expect(
				screen.getByRole('complementary', { name: /résultat|analyse/i })
			).toBeInTheDocument();
		});
	});

	// -------------------------------------------------------------------------
	// Indicateur de progression (étapes SSE)
	// -------------------------------------------------------------------------

	describe("Indicateur de progression", () => {
		it("affiche un indicateur pendant que l'IA analyse", async () => {
			fetchMock.mockReturnValueOnce(makeHangingStream());
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() => {
				const spinner = screen.queryByRole('status');
				const busyEl = document.querySelector('[aria-busy="true"]');
				expect(spinner ?? busyEl).toBeTruthy();
			});
		});

		it("affiche l'étape 'Lecture de la photo'", async () => {
			const sse = createControllableStream();
			fetchMock.mockReturnValueOnce(sse.response);
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			sse.emitStep('Lecture de la photo');

			await waitFor(() =>
				expect(screen.getByText(/lecture de la photo/i)).toBeInTheDocument()
			);
		});

		it("affiche l'étape 'Préparation de l'analyse'", async () => {
			const sse = createControllableStream();
			fetchMock.mockReturnValueOnce(sse.response);
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			sse.emitStep('Lecture de la photo');
			sse.emitStep("Préparation de l'analyse");

			await waitFor(() =>
				expect(screen.getByText(/préparation de l.analyse/i)).toBeInTheDocument()
			);
		});

		it("affiche l'étape 'Analyse en cours'", async () => {
			const sse = createControllableStream();
			fetchMock.mockReturnValueOnce(sse.response);
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			sse.emitStep('Lecture de la photo');
			sse.emitStep("Préparation de l'analyse");
			sse.emitStep('Analyse en cours');

			await waitFor(() =>
				expect(screen.getByText(/analyse en cours/i)).toBeInTheDocument()
			);
		});

		it("disparaît une fois le résultat reçu", async () => {
			fetchMock.mockReturnValueOnce(makeCompleteStream());
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() => {
				const spinner = screen.queryByRole('status');
				const busyEl = document.querySelector('[aria-busy="true"]');
				expect(spinner ?? busyEl).toBeFalsy();
			});
		});
	});

	// -------------------------------------------------------------------------
	// Résultat de l'analyse
	// -------------------------------------------------------------------------

	describe("Résultat de l'analyse", () => {
		async function renderWithResult(result = MOCK_RESULT) {
			fetchMock.mockReturnValueOnce(makeCompleteStream(result));
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));
			await waitFor(() => expect(screen.getByText(result.sujet)).toBeInTheDocument());
		}

		it("affiche le sujet identifié par l'IA", async () => {
			await renderWithResult();
			expect(screen.getByText(MOCK_RESULT.sujet)).toBeInTheDocument();
		});

		it("affiche le type de photo", async () => {
			await renderWithResult();
			expect(screen.getByText(new RegExp(MOCK_RESULT.type_photo, 'i'))).toBeInTheDocument();
		});

		it("affiche l'analyse de la lumière", async () => {
			await renderWithResult();
			expect(screen.getByText(new RegExp(MOCK_RESULT.lumiere, 'i'))).toBeInTheDocument();
		});

		it("affiche l'analyse de la composition", async () => {
			await renderWithResult();
			expect(screen.getByText(new RegExp(MOCK_RESULT.composition, 'i'))).toBeInTheDocument();
		});

		it("affiche les axes d'amélioration", async () => {
			await renderWithResult();
			for (const conseil of MOCK_RESULT.ameliorations) {
				expect(screen.getByText(new RegExp(conseil, 'i'))).toBeInTheDocument();
			}
		});

		it("affiche le score sur 10", async () => {
			await renderWithResult();
			// Le score et "/10" peuvent être dans des éléments séparés — on vérifie sur le textContent du panneau
			const panel = screen.getByRole('complementary', { name: /résultat|analyse/i });
			expect(panel.textContent).toMatch(new RegExp(`${MOCK_RESULT.score}\\s*/\\s*10`, 'i'));
		});
	});

	// -------------------------------------------------------------------------
	// Gestion des erreurs
	// -------------------------------------------------------------------------

	describe("Gestion des erreurs", () => {
		it("affiche une erreur dans le panneau si la requête HTTP échoue", async () => {
			fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			await waitFor(() => {
				const panel = screen.getByRole('complementary', { name: /résultat|analyse/i });
				expect(panel.querySelector('[role="alert"]')).toBeTruthy();
			});
		});

		it("affiche une erreur dans le panneau si le backend renvoie un event 'error'", async () => {
			const sse = createControllableStream();
			fetchMock.mockReturnValueOnce(sse.response);
			await renderWithReadyPhoto();
			fireEvent.click(screen.getByRole('button', { name: /analyser/i }));

			sse.emitError("Claude n'a pas pu analyser cette image.");
			sse.close();

			await waitFor(() => {
				const panel = screen.getByRole('complementary', { name: /résultat|analyse/i });
				expect(panel.querySelector('[role="alert"]')).toBeTruthy();
			});
		});
	});
});
