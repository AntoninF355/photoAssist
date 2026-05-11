import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Page from './+page.svelte';
import { saveEntry } from '$lib/history';
import type { HistoryEntry } from '$lib/history';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		id: '1746000000000',
		date: '2026-05-01T10:00:00.000Z',
		filename: 'DSC_0042.ARW',
		thumbnail: 'data:image/jpeg;base64,/9j/fakedata',
		metadata: { camera: 'Sony A7 IV', iso: 800 },
		result: {
			sujet: 'Porsche 911 GT3 en virage',
			type_photo: 'Freeze / circuit',
			lumiere: 'Lumière directe contrastée',
			composition: 'Règle des tiers respectée',
			ameliorations: ["Augmenter légèrement l'exposition"],
			retouche: {
				style: 'Cinématique',
				colorimetrie: 'Tons chauds',
				exposition: '+0.5 EV',
				finition: 'Grain subtil'
			},
			score: 8
		},
		...overrides
	};
}

// ---------------------------------------------------------------------------
// US4 — Historique des analyses (UI)
// ---------------------------------------------------------------------------

describe("US4 — Historique des analyses (UI)", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	// -------------------------------------------------------------------------
	// Bouton Historique dans le header
	// -------------------------------------------------------------------------

	describe('Bouton Historique', () => {
		it('est présent dans le header', () => {
			render(Page);
			expect(screen.getByRole('button', { name: /historique/i })).toBeInTheDocument();
		});

		it("affiche un badge avec le nombre d'entrées", async () => {
			saveEntry(makeEntry({ id: '1' }));
			saveEntry(makeEntry({ id: '2' }));
			render(Page);
			await waitFor(() => {
				expect(screen.getByRole('button', { name: /historique/i }).textContent).toMatch('2');
			});
		});

		it("n'affiche pas de badge quand l'historique est vide", () => {
			render(Page);
			expect(screen.getByRole('button', { name: /historique/i }).textContent).not.toMatch(/[1-9]/);
		});
	});

	// -------------------------------------------------------------------------
	// Panneau Historique
	// -------------------------------------------------------------------------

	describe('Panneau Historique', () => {
		it('est fermé par défaut', () => {
			render(Page);
			expect(
				screen.queryByRole('region', { name: /historique des analyses/i })
			).not.toBeInTheDocument();
		});

		it("s'ouvre après clic sur le bouton Historique", async () => {
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));
			await waitFor(() => {
				expect(
					screen.getByRole('region', { name: /historique des analyses/i })
				).toBeInTheDocument();
			});
		});

		it('se referme après un deuxième clic', async () => {
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));
			await waitFor(() =>
				expect(screen.getByRole('region', { name: /historique des analyses/i })).toBeInTheDocument()
			);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));
			await waitFor(() => {
				expect(
					screen.queryByRole('region', { name: /historique des analyses/i })
				).not.toBeInTheDocument();
			});
		});

		it("affiche un message d'invitation si l'historique est vide", async () => {
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));
			await waitFor(() => {
				expect(screen.getByText(/première photo/i)).toBeInTheDocument();
			});
		});

		it('affiche une carte par analyse sauvegardée', async () => {
			saveEntry(makeEntry({ id: '1', filename: 'photo_a.ARW' }));
			saveEntry(makeEntry({ id: '2', filename: 'photo_b.ARW' }));
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));
			await waitFor(() => {
				expect(screen.getByText('photo_a.ARW')).toBeInTheDocument();
				expect(screen.getByText('photo_b.ARW')).toBeInTheDocument();
			});
		});
	});

	// -------------------------------------------------------------------------
	// Restauration depuis l'historique
	// -------------------------------------------------------------------------

	describe("Restauration depuis l'historique", () => {
		it("ouvre le panneau d'analyse avec le résultat de l'entrée cliquée", async () => {
			const entry = makeEntry();
			saveEntry(entry);
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));

			await waitFor(() => expect(screen.getByText(entry.filename)).toBeInTheDocument());
			fireEvent.click(screen.getByText(entry.filename));

			await waitFor(() => {
				expect(
					screen.getByRole('complementary', { name: /résultat|analyse/i })
				).toBeInTheDocument();
				expect(screen.getByText(entry.result.sujet)).toBeInTheDocument();
			});
		});

		it("affiche le score de l'analyse restaurée", async () => {
			const entry = makeEntry({ result: { ...makeEntry().result, score: 9 } });
			saveEntry(entry);
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));

			await waitFor(() => expect(screen.getByText(entry.filename)).toBeInTheDocument());
			fireEvent.click(screen.getByText(entry.filename));

			await waitFor(() => {
				const panel = screen.getByRole('complementary', { name: /résultat|analyse/i });
				expect(panel.textContent).toMatch(/9\s*\/\s*10/);
			});
		});
	});

	// -------------------------------------------------------------------------
	// Suppression d'une entrée
	// -------------------------------------------------------------------------

	describe("Suppression d'une entrée", () => {
		it('retire la carte de la liste après suppression', async () => {
			saveEntry(makeEntry({ id: '1', filename: 'photo_a.ARW' }));
			saveEntry(makeEntry({ id: '2', filename: 'photo_b.ARW' }));
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));

			await waitFor(() => {
				expect(screen.getByText('photo_a.ARW')).toBeInTheDocument();
				expect(screen.getByText('photo_b.ARW')).toBeInTheDocument();
			});

			fireEvent.click(screen.getAllByRole('button', { name: /supprimer/i })[0]);

			await waitFor(() => {
				expect(screen.getAllByRole('button', { name: /supprimer/i })).toHaveLength(1);
			});
		});

		it('met à jour le badge du bouton Historique après suppression', async () => {
			saveEntry(makeEntry({ id: '1' }));
			render(Page);
			fireEvent.click(screen.getByRole('button', { name: /historique/i }));

			await waitFor(() =>
				expect(screen.getByRole('button', { name: /historique/i }).textContent).toMatch('1')
			);

			fireEvent.click(screen.getByRole('button', { name: /supprimer/i }));

			await waitFor(() => {
				expect(screen.getByRole('button', { name: /historique/i }).textContent).not.toMatch(/[1-9]/);
			});
		});
	});
});
