import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RAW_FORMATS = ['ARW', 'CR3', 'DNG', 'NEF', 'RAF'] as const;

function makeFile(name: string, type = ''): File {
	return new File([new Uint8Array(512)], name, { type });
}

function dropFile(dropzone: HTMLElement, file: File): void {
	const dataTransfer = { files: [file], types: ['Files'] };
	fireEvent.dragOver(dropzone, { dataTransfer });
	fireEvent.drop(dropzone, { dataTransfer });
}

function getDropzone(): HTMLElement {
	return screen.getByRole('region', { name: /glisser|déposer|drop/i });
}

// ---------------------------------------------------------------------------
// US1 — En tant qu'utilisateur, je dois pouvoir ajouter une image RAW
// ---------------------------------------------------------------------------

describe('US1 — Upload RAW', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		// Mock par défaut : conversion réussie
		// Le endpoint preview retourne désormais { preview: base64, metadata: {} }
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						preview: btoa('fake-jpeg'),
						metadata: { camera: 'Sony A7 IV', iso: 800 }
					})
				})
			)
		);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview-url');
	});

	// -------------------------------------------------------------------------
	// Zone de dépôt
	// -------------------------------------------------------------------------

	describe('Zone de dépôt', () => {
		it('affiche une zone de drag & drop visible', () => {
			render(Page);
			expect(getDropzone()).toBeInTheDocument();
		});

		it("affiche un bouton d'envoi sous la zone d'upload", () => {
			render(Page);
			expect(screen.getByRole('button', { name: /analyser|envoyer/i })).toBeInTheDocument();
		});
	});

	// -------------------------------------------------------------------------
	// Formats acceptés
	// -------------------------------------------------------------------------

	describe('Formats RAW acceptés', () => {
		it.each(RAW_FORMATS)("accepte un fichier .%s sans afficher d'erreur", async (ext) => {
			render(Page);
			dropFile(getDropzone(), makeFile(`photo.${ext}`));

			await waitFor(() => {
				expect(screen.queryByRole('alert')).not.toBeInTheDocument();
			});
		});
	});

	// -------------------------------------------------------------------------
	// Fichier invalide
	// -------------------------------------------------------------------------

	describe('Fichier non-RAW', () => {
		it('affiche une alerte pour un fichier JPEG', async () => {
			render(Page);
			dropFile(getDropzone(), makeFile('photo.jpg', 'image/jpeg'));

			await waitFor(() => {
				expect(screen.getByRole('alert')).toBeInTheDocument();
			});
		});

		it('affiche une alerte pour un fichier PDF', async () => {
			render(Page);
			dropFile(getDropzone(), makeFile('document.pdf', 'application/pdf'));

			await waitFor(() => {
				expect(screen.getByRole('alert')).toBeInTheDocument();
			});
		});

		it('propose "Réessayer" ou "Changer de photo" en cas d\'erreur', async () => {
			render(Page);
			dropFile(getDropzone(), makeFile('photo.png', 'image/png'));

			await waitFor(() => {
				const retryBtn = screen.queryByRole('button', { name: /réessayer/i });
				const changeBtn = screen.queryByRole('button', { name: /changer de photo/i });
				expect(retryBtn ?? changeBtn).toBeInTheDocument();
			});
		});
	});

	// -------------------------------------------------------------------------
	// Indicateur de chargement
	// -------------------------------------------------------------------------

	describe('Indicateur de chargement', () => {
		it("apparaît immédiatement après le dépôt d'un fichier RAW valide", async () => {
			// Fetch qui ne résout jamais → reste en état chargement
			vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

			render(Page);
			dropFile(getDropzone(), makeFile('photo.ARW'));

			await waitFor(() => {
				const spinner = screen.queryByRole('status');
				const busyEl = document.querySelector('[aria-busy="true"]');
				expect(spinner ?? busyEl).toBeTruthy();
			});
		});

		it('disparaît une fois la conversion terminée', async () => {
			render(Page);
			dropFile(getDropzone(), makeFile('photo.CR3'));

			await waitFor(() => {
				const spinner = screen.queryByRole('status');
				const busyEl = document.querySelector('[aria-busy="true"]');
				expect(spinner ?? busyEl).toBeFalsy();
			});
		});
	});

	// -------------------------------------------------------------------------
	// Aperçu de l'image
	// -------------------------------------------------------------------------

	describe("Aperçu de l'image", () => {
		it("affiche un aperçu après la conversion d'un fichier RAW", async () => {
			render(Page);
			dropFile(getDropzone(), makeFile('photo.DNG'));

			await waitFor(() => {
				const preview = screen.getByRole('img', { name: /aperçu|preview/i });
				expect(preview).toBeInTheDocument();
				expect(preview).toHaveAttribute('src', 'blob:mock-preview-url');
			});
		});

		it("n'affiche pas d'aperçu avant qu'un fichier soit déposé", () => {
			render(Page);
			expect(screen.queryByRole('img', { name: /aperçu|preview/i })).not.toBeInTheDocument();
		});
	});
});
