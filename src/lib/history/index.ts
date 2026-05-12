export interface Retouche {
	style: string;
	colorimetrie: string;
	exposition: string;
	finition: string;
}

export interface AnalysisResult {
	sujet: string;
	type_photo: string;
	lumiere: string;
	composition: string;
	ameliorations: string[];
	retouche: Retouche;
	score: number;
	releve_defi?: boolean;
}

export interface HistoryEntry {
	id: string;
	date: string;
	filename: string;
	thumbnail: string;
	metadata: Record<string, unknown>;
	result: AnalysisResult;
}

const KEY = 'photoassist_history';
const MAX = 20;

function load(): HistoryEntry[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]');
	} catch {
		return [];
	}
}

function persist(entries: HistoryEntry[]): void {
	localStorage.setItem(KEY, JSON.stringify(entries));
}

export function saveEntry(entry: HistoryEntry): void {
	persist([entry, ...load()].slice(0, MAX));
}

export function getEntries(): HistoryEntry[] {
	return load();
}

export function deleteEntry(id: string): void {
	persist(load().filter((e) => e.id !== id));
}

export function clearHistory(): void {
	localStorage.removeItem(KEY);
}
