import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';
import type { AnalysisResult } from '$lib/history';

// ── SSE helpers ───────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseChunk(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function makeCompleteStream(result: AnalysisResult): Response {
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

function makeErrorStream(message: string): Response {
	const chunks = [sseChunk('error', { message })];
	let i = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(c) { i < chunks.length ? c.enqueue(chunks[i++]) : c.close(); }
	});
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

function previewOk() {
	return {
		ok: true,
		json: () => Promise.resolve({
			preview: btoa('fake-jpeg'),
			metadata: { camera: 'Canon R5', iso: 400 }
		})
	};
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeResult(score: number, sujet = `Sujet score ${score}`): AnalysisResult {
	return {
		sujet,
		type_photo: 'Freeze / circuit',
		lumiere: 'Lumière test',
		composition: 'Composition test',
		ameliorations: ['Conseil test'],
		retouche: { style: 'S', colorimetrie: 'C', exposition: 'E', finition: 'F' },
		score
	};
}

function rawFile(name: string): File {
	return new File([new Uint8Array(64)], name);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('US5 — Analyse en lot', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
		vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		localStorage.clear();
	});

	function dropMultiple(files: File[]): void {
		render(Page);
		const dropzone = screen.getByRole('region', { name: /glisser|déposer|drop/i });
		fireEvent.dragOver(dropzone, { dataTransfer: { files, types: ['Files'] } });
		fireEvent.drop(dropzone, { dataTransfer: { files, types: ['Files'] } });
	}

	// ── Critère 1 : file d'attente ────────────────────────────────────────────

	it('affiche une file d\'attente avec tous les fichiers déposés', async () => {
		const files = [rawFile('photo1.ARW'), rawFile('photo2.CR3'), rawFile('photo3.NEF')];
		dropMultiple(files);
		await waitFor(() => {
			expect(screen.getByText('photo1.ARW')).toBeInTheDocument();
			expect(screen.getByText('photo2.CR3')).toBeInTheDocument();
			expect(screen.getByText('photo3.NEF')).toBeInTheDocument();
		});
	});

	// ── Critère 1 bis : max 10 fichiers ──────────────────────────────────────

	it('refuse un lot de plus de 10 fichiers et affiche une erreur', async () => {
		const files = Array.from({ length: 11 }, (_, i) => rawFile(`photo${i + 1}.ARW`));
		dropMultiple(files);
		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
	});

	// ── Critère 2 : statuts dans la file ─────────────────────────────────────

	it('affiche le statut "En attente" pour chaque fichier de la file', async () => {
		const files = [rawFile('photo1.ARW'), rawFile('photo2.DNG')];
		dropMultiple(files);
		await waitFor(() => {
			const items = screen.getAllByText(/en attente/i);
			expect(items.length).toBeGreaterThanOrEqual(2);
		});
	});

	it('affiche un bouton "Lancer l\'analyse" après dépôt de plusieurs fichiers', async () => {
		const files = [rawFile('photo1.ARW'), rawFile('photo2.ARW')];
		dropMultiple(files);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /lancer l.analyse/i })).toBeInTheDocument();
		});
	});

	// ── Critère 3 : exécution séquentielle + progression ─────────────────────

	it('affiche un indicateur de progression global durant l\'analyse', async () => {
		fetchMock
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(new Response(new ReadableStream({ start() {} }), {
				headers: { 'Content-Type': 'text/event-stream' }
			}));

		const files = [rawFile('photo1.ARW'), rawFile('photo2.ARW')];
		dropMultiple(files);
		fireEvent.click(screen.getByRole('button', { name: /lancer l.analyse/i }));

		await waitFor(() => {
			expect(screen.getByText(/\d+\s*\/\s*2\s*analysée/i)).toBeInTheDocument();
		});
	});

	it('affiche le statut "En cours" sur le fichier en cours d\'analyse', async () => {
		fetchMock
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(new Response(new ReadableStream({ start() {} }), {
				headers: { 'Content-Type': 'text/event-stream' }
			}));

		const files = [rawFile('photo1.ARW'), rawFile('photo2.ARW')];
		dropMultiple(files);
		fireEvent.click(screen.getByRole('button', { name: /lancer l.analyse/i }));

		await waitFor(() => {
			expect(screen.getAllByText(/en cours/i).length).toBeGreaterThanOrEqual(1);
		});
	});

	// ── Critère 5 : classement par score ─────────────────────────────────────

	it('classe les résultats par score décroissant à la fin du lot', async () => {
		fetchMock
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(makeCompleteStream(makeResult(5, 'Sujet score 5')))
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(makeCompleteStream(makeResult(9, 'Sujet score 9')));

		const files = [rawFile('photo1.ARW'), rawFile('photo2.ARW')];
		dropMultiple(files);
		fireEvent.click(screen.getByRole('button', { name: /lancer l.analyse/i }));

		await waitFor(() => {
			expect(screen.getByText('Sujet score 5')).toBeInTheDocument();
			expect(screen.getByText('Sujet score 9')).toBeInTheDocument();
		});

		const sujets = screen.getAllByText(/Sujet score \d/);
		expect(sujets[0].textContent).toContain('9');
		expect(sujets[1].textContent).toContain('5');
	});

	// ── Critère 6 : rapport markdown ─────────────────────────────────────────

	it('affiche un bouton pour télécharger le rapport une fois le lot terminé', async () => {
		fetchMock
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(makeCompleteStream(makeResult(7)))
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(makeCompleteStream(makeResult(5)));

		const files = [rawFile('photo1.ARW'), rawFile('photo2.ARW')];
		dropMultiple(files);
		fireEvent.click(screen.getByRole('button', { name: /lancer l.analyse/i }));

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /rapport/i })).toBeInTheDocument();
		});
	});

	// ── Critère 7 : isolation des erreurs ────────────────────────────────────

	it('une erreur sur un fichier ne bloque pas l\'analyse des suivants', async () => {
		fetchMock
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(makeErrorStream('Analyse échouée pour photo 1'))
			.mockResolvedValueOnce(previewOk())
			.mockReturnValueOnce(makeCompleteStream(makeResult(7, 'Sujet photo 2')));

		const files = [rawFile('photo1.ARW'), rawFile('photo2.ARW')];
		dropMultiple(files);
		fireEvent.click(screen.getByRole('button', { name: /lancer l.analyse/i }));

		await waitFor(() => {
			expect(screen.getByText('Sujet photo 2')).toBeInTheDocument();
			expect(screen.getAllByText(/erreur/i).length).toBeGreaterThanOrEqual(1);
		});
	});
});
