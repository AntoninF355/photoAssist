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
//        sur le site facilement
// ---------------------------------------------------------------------------

describe('US1 — Upload d'une image RAW', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// Zone de dépôt
	// -------------------------------------------------------------------------

	describe('Zone de dépôt', () => {
		it('affiche une zone de drag & drop visible', () => {
			render(Page);
			expect(getDropzone()).toBeInTheDocument();
		});

		it('affiche un bouton d'envoi sous la zone d'upload', () => {
			render(Page);
			expect(screen.getByRole('button', { name: /analyser|envoyer/i })).toBeInTheDocument();
		});
	});

	// -------------------------------------------------------------------------
	// Formats acceptés
	// -------------------------------------------------------------------------

	describe('Formats RAW acceptés', () => {
		it.each(RAW_FORMATS)('accepte un fichier .%s sans afficher d'erreur', async (ext) => {
			render(Page);
			dropFile(getDropzone(), makeFile(`photo.${ext}`));

			// On attend un court délai pour laisser la réaction se propager
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

		it('propose "Réessayer" ou "Changer de photo" dans le message d'erreur', async () => {
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
		it('apparaît immédiatement après le dépôt d'un fichier RAW valide', async () => {
			// On simule un fetch qui ne résout jamais pour rester en état "chargement"
			vi.stubGlobal('fetch', () => new Promise(() => {}));

			render(Page);
			dropFile(getDropzone(), makeFile('photo.ARW'));

			await waitFor(() => {
				// L'indicateur peut être un role="status" ou aria-busy=true
				const spinner = screen.queryByRole('status');
				const busyEl = document.querySelector('[aria-busy="true"]');
				expect(spinner ?? busyEl).toBeTruthy();
			});
		});

		it('disparaît une fois la conversion terminée', async () => {
			vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
			vi.stubGlobal('fetch', () =>
				Promise.resolve({
					ok: true,
					blob: () => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }))
				})
			);

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

	describe('Aperçu de l'image', () => {
		it('affiche un aperçu après la conversion d'un fichier RAW', async () => {
			const previewUrl = 'blob:mock-preview-url';
			vi.spyOn(URL, 'createObjectURL').mockReturnValue(previewUrl);
			vi.stubGlobal('fetch', () =>
				Promise.resolve({
					ok: true,
					blob: () => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }))
				})
			);

			render(Page);
			dropFile(getDropzone(), makeFile('photo.DNG'));

			await waitFor(() => {
				const preview = screen.getByRole('img', { name: /aperçu|preview/i });
				expect(preview).toBeInTheDocument();
				expect(preview).toHaveAttribute('src', previewUrl);
			});
		});

		it('n'affiche pas d'aperçu avant qu'un fichier soit déposé', () => {
			render(Page);
			expect(screen.queryByRole('img', { name: /aperçu|preview/i })).not.toBeInTheDocument();
		});
	});
});
