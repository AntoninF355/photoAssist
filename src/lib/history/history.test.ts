import { describe, it, expect, beforeEach } from 'vitest';
import { saveEntry, getEntries, deleteEntry, clearHistory } from '.';
import type { HistoryEntry } from '.';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		id: '1000000',
		date: '2026-05-11T10:00:00.000Z',
		filename: 'photo.ARW',
		thumbnail: 'data:image/jpeg;base64,fake',
		metadata: {},
		result: {
			sujet: 'Porsche 911',
			type_photo: 'Freeze / circuit',
			lumiere: 'Lumière directe',
			composition: 'Règle des tiers',
			ameliorations: ['Conseil 1'],
			retouche: { style: 'Ciné', colorimetrie: 'Chaud', exposition: '+0.5', finition: 'Grain' },
			score: 7
		},
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('History service — localStorage', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	// -------------------------------------------------------------------------
	// getEntries
	// -------------------------------------------------------------------------

	describe('getEntries', () => {
		it("retourne un tableau vide si l'historique est vide", () => {
			expect(getEntries()).toEqual([]);
		});

		it('retourne les entrées sauvegardées', () => {
			saveEntry(makeEntry({ id: '1' }));
			expect(getEntries()).toHaveLength(1);
			expect(getEntries()[0].id).toBe('1');
		});
	});

	// -------------------------------------------------------------------------
	// saveEntry
	// -------------------------------------------------------------------------

	describe('saveEntry', () => {
		it('sauvegarde une entrée en tête de liste', () => {
			saveEntry(makeEntry({ id: '1' }));
			saveEntry(makeEntry({ id: '2' }));
			expect(getEntries()[0].id).toBe('2');
		});

		it('limite le stockage à 20 entrées', () => {
			for (let i = 0; i < 25; i++) saveEntry(makeEntry({ id: String(i) }));
			expect(getEntries()).toHaveLength(20);
		});

		it('supprime les plus anciennes quand la limite est atteinte', () => {
			for (let i = 0; i < 20; i++) saveEntry(makeEntry({ id: String(i) }));
			saveEntry(makeEntry({ id: 'new' }));
			const entries = getEntries();
			expect(entries[0].id).toBe('new');
			expect(entries.find((e) => e.id === '0')).toBeUndefined();
		});

		it('persiste les données entre deux lectures', () => {
			const entry = makeEntry({ id: '42', filename: 'test.ARW' });
			saveEntry(entry);
			expect(getEntries()[0].filename).toBe('test.ARW');
		});
	});

	// -------------------------------------------------------------------------
	// deleteEntry
	// -------------------------------------------------------------------------

	describe('deleteEntry', () => {
		it("supprime l'entrée correspondant à l'id", () => {
			saveEntry(makeEntry({ id: '1' }));
			saveEntry(makeEntry({ id: '2' }));
			deleteEntry('1');
			const entries = getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].id).toBe('2');
		});

		it("ne fait rien si l'id n'existe pas", () => {
			saveEntry(makeEntry({ id: '1' }));
			deleteEntry('inexistant');
			expect(getEntries()).toHaveLength(1);
		});
	});

	// -------------------------------------------------------------------------
	// clearHistory
	// -------------------------------------------------------------------------

	describe('clearHistory', () => {
		it('supprime toutes les entrées', () => {
			saveEntry(makeEntry({ id: '1' }));
			saveEntry(makeEntry({ id: '2' }));
			clearHistory();
			expect(getEntries()).toHaveLength(0);
		});

		it("ne lève pas d'erreur si l'historique est déjà vide", () => {
			expect(() => clearHistory()).not.toThrow();
		});
	});
});
