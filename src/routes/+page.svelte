<script lang="ts">
	import { saveEntry, getEntries, deleteEntry } from '$lib/history';
	import type { HistoryEntry, AnalysisResult } from '$lib/history';

	// ── État upload ────────────────────────────────────────────────────────────
	const ACCEPTED = ['ARW', 'CR3', 'DNG', 'NEF', 'RAF'];

	let previewUrl    = $state<string | null>(null);
	let previewBlob   = $state<Blob | null>(null);
	let metadata      = $state<Record<string, unknown>>({});
	let isLoading     = $state(false);
	let error         = $state<string | null>(null);
	let currentFile   = $state<File | null>(null);
	let isDragOver    = $state(false);

	// ── Toast ─────────────────────────────────────────────────────────────────
	let showToast    = $state(false);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	// ── État analyse ───────────────────────────────────────────────────────────
	let panelOpen      = $state(false);
	let isAnalyzing    = $state(false);
	let currentStep    = $state<string | null>(null);
	let analysisResult = $state<AnalysisResult | null>(null);
	let analysisError  = $state<string | null>(null);

	// ── Historique ─────────────────────────────────────────────────────────────
	let historyEntries = $state<HistoryEntry[]>([]);
	let historyOpen    = $state(false);

	// ── Mode lot ────────────────────────────────────────────────────────────────
	type BatchStatus = 'pending' | 'processing' | 'done' | 'error';
	interface BatchItem {
		id: string;
		file: File;
		previewBlob: Blob | null;
		metadata: Record<string, unknown>;
		status: BatchStatus;
		result: AnalysisResult | null;
		errorMsg: string | null;
	}
	let batchMode    = $state(false);
	let batchItems   = $state<BatchItem[]>([]);
	let batchRunning = $state(false);
	let batchDone    = $state(false);

	$effect(() => {
		historyEntries = getEntries();
	});

	// ── Helpers ────────────────────────────────────────────────────────────────
	function getExt(file: File) {
		return file.name.split('.').pop()?.toUpperCase() ?? '';
	}

	// ── Upload + conversion preview ────────────────────────────────────────────
	async function processFile(file: File) {
		error = null;
		previewUrl = null;
		previewBlob = null;
		metadata = {};
		currentFile = null;

		if (!ACCEPTED.includes(getExt(file))) {
			error = `Format non supporté. Utilisez un fichier RAW (${ACCEPTED.join(', ')}).`;
			return;
		}

		currentFile = file;
		isLoading = true;

		try {
			const form = new FormData();
			form.append('file', file);
			const res = await fetch('/api/analyze/preview', { method: 'POST', body: form });
			if (!res.ok) throw new Error();

			// Le endpoint retourne { preview: base64, metadata: {...} }
			const { preview, metadata: exifMeta } = await res.json();
			metadata = exifMeta ?? {};

			const bytes = Uint8Array.from(atob(preview), (c) => c.charCodeAt(0));
			previewBlob = new Blob([bytes], { type: 'image/jpeg' });
			previewUrl = URL.createObjectURL(previewBlob);
			if (toastTimer) clearTimeout(toastTimer);
			showToast = true;
			toastTimer = setTimeout(() => { showToast = false; }, 3000);
		} catch {
			error = 'La conversion a échoué. Vérifiez votre fichier et réessayez.';
			currentFile = null;
		} finally {
			isLoading = false;
		}
	}

	// ── Analyse IA via SSE ─────────────────────────────────────────────────────
	async function analyzePhoto() {
		if (!previewBlob) return;

		panelOpen = true;
		isAnalyzing = true;
		currentStep = null;
		analysisResult = null;
		analysisError = null;

		try {
			const form = new FormData();
			form.append('jpeg', previewBlob, 'preview.jpg');
			form.append('metadata', JSON.stringify(metadata));

			const res = await fetch('/api/analyze', { method: 'POST', body: form });

			if (!res.ok) {
				analysisError = "L'analyse a échoué. Veuillez réessayer.";
				isAnalyzing = false;
				return;
			}

			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				// Parse des blocs SSE séparés par \n\n
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';

				for (const part of parts) {
					if (!part.trim()) continue;
					let eventName = '';
					let data = '';
					for (const line of part.split('\n')) {
						if (line.startsWith('event: ')) eventName = line.slice(7).trim();
						if (line.startsWith('data: '))  data      = line.slice(6).trim();
					}
					if (!eventName || !data) continue;

					const parsed = JSON.parse(data);
					if (eventName === 'step')   currentStep = parsed.step;
					if (eventName === 'result') {
						analysisResult = parsed as AnalysisResult;
						if (previewBlob && currentFile) {
							const blob = previewBlob, file = currentFile, meta = metadata;
							createThumbnail(blob).then(thumbnail => {
								saveEntry({ id: Date.now().toString(), date: new Date().toISOString(),
									filename: file.name, thumbnail, metadata: meta, result: parsed as AnalysisResult });
								historyEntries = getEntries();
							}).catch(() => {});
						}
					}
					if (eventName === 'error')  { analysisError = parsed.message; isAnalyzing = false; }
					if (eventName === 'done')   { isAnalyzing = false; currentStep = null; }
				}
			}
		} catch {
			analysisError = "Une erreur inattendue s'est produite.";
			isAnalyzing = false;
		}
	}

	// ── Thumbnail (canvas client-side) ────────────────────────────────────────
	function createThumbnail(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			const url = URL.createObjectURL(blob);
			img.onload = () => {
				const canvas = document.createElement('canvas');
				const maxW = 160;
				const scale = Math.min(1, maxW / img.naturalWidth);
				canvas.width  = Math.round(img.naturalWidth  * scale);
				canvas.height = Math.round(img.naturalHeight * scale);
				canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
				URL.revokeObjectURL(url);
				resolve(canvas.toDataURL('image/jpeg', 0.6));
			};
			img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('thumbnail failed')); };
			img.src = url;
		});
	}

	// ── Historique ─────────────────────────────────────────────────────────────
	function toggleHistory() { historyOpen = !historyOpen; }

	function restoreFromHistory(entry: HistoryEntry) {
		analysisResult = entry.result;
		panelOpen      = true;
		isAnalyzing    = false;
		currentStep    = null;
		analysisError  = null;
	}

	function removeEntry(id: string) {
		deleteEntry(id);
		historyEntries = getEntries();
	}

	function formatDate(iso: string): string {
		const diff = (Date.now() - new Date(iso).getTime()) / 1000;
		if (diff < 60)    return "à l'instant";
		if (diff < 3600)  return `il y a ${Math.floor(diff / 60)}min`;
		if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
		return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
	}

	// ── Drag & drop ────────────────────────────────────────────────────────────
	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragOver = false;
		const files = [...(e.dataTransfer?.files ?? [])];
		if (files.length > 1) startBatchMode(files);
		else if (files.length === 1) processFile(files[0]);
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragOver = true;
	}

	function handleInputChange(e: Event) {
		const files = [...((e.target as HTMLInputElement).files ?? [])];
		if (files.length > 1) startBatchMode(files);
		else if (files.length === 1) processFile(files[0]);
	}

	// ── Export PDF ─────────────────────────────────────────────────────────────
	async function exportToPDF() {
		if (!analysisResult) return;

		const { default: jsPDF } = await import('jspdf');
		const doc = new jsPDF({ unit: 'mm', format: 'a4' });

		const pageW  = doc.internal.pageSize.getWidth();
		const margin = 15;
		const colW   = pageW - margin * 2;
		let y = margin;

		const white  = [255, 255, 255] as const;
		const dark   = [30,  30,  40]  as const;
		const accent = [110, 123, 255] as const;
		const grey   = [90,  95, 114]  as const;
		const light  = [196, 200, 216] as const;

		// Fond blanc — mise en page imprimable
		doc.setFillColor(...white);
		doc.rect(0, 0, pageW, doc.internal.pageSize.getHeight(), 'F');

		// ── Aperçu photo ──
		if (previewBlob) {
			const imgData = await new Promise<string>((resolve) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as string);
				reader.readAsDataURL(previewBlob!);
			});
			const imgH = 70;
			doc.addImage(imgData, 'JPEG', margin, y, colW, imgH);
			y += imgH + 5;
		}

		// ── Titre / sujet ──
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(16);
		doc.setTextColor(...dark);
		doc.text(analysisResult.sujet, margin, y);
		y += 7;

		// ── Type + score ──
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(10);
		doc.setTextColor(...accent);
		doc.text(analysisResult.type_photo, margin, y);

		doc.setFont('helvetica', 'bold');
		doc.setFontSize(12);
		doc.setTextColor(...dark);
		doc.text(`${analysisResult.score}/10`, pageW - margin - 20, y);
		y += 8;

		// Séparateur
		doc.setDrawColor(...grey);
		doc.line(margin, y, pageW - margin, y);
		y += 6;

		// ── Sections helper ──
		const section = (title: string, body: string | string[]) => {
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(9);
			doc.setTextColor(...grey);
			doc.text(title.toUpperCase(), margin, y);
			y += 5;

			doc.setFont('helvetica', 'normal');
			doc.setFontSize(10);
			doc.setTextColor(...light);

			const lines = Array.isArray(body) ? body : doc.splitTextToSize(body, colW);
			for (const line of lines) {
				doc.text(line, margin, y);
				y += 5;
			}
			y += 2;
		};

		section('Lumière',      analysisResult.lumiere);
		section('Composition',  analysisResult.composition);
		section("Axes d'amélioration", analysisResult.ameliorations.map(a => `• ${a}`));

		if (analysisResult.retouche) {
			const r = analysisResult.retouche;
			section('Direction de retouche', [
				`Style : ${r.style}`,
				`Colorimétrie : ${r.colorimetrie}`,
				`Exposition : ${r.exposition}`,
				`Finition : ${r.finition}`
			]);
		}

		const base = currentFile?.name.replace(/\.[^.]+$/, '') ?? 'photo';
		doc.save(`analyse-${base}.pdf`);
	}

	// ── Téléchargement de l'analyse ────────────────────────────────────────────
	function downloadAnalysis() {
		if (!analysisResult) return;

		const r = analysisResult;
		const filename = currentFile?.name.replace(/\.[^.]+$/, '') ?? 'photo';

		const lines = [
			`# Analyse — ${r.sujet}`,
			``,
			`**Type :** ${r.type_photo}`,
			`**Score :** ${r.score}/10`,
			``,
			`## Lumière`,
			r.lumiere,
			``,
			`## Composition`,
			r.composition,
			``,
			`## Axes d'amélioration`,
			...r.ameliorations.map((c) => `- ${c}`),
		];

		if (r.retouche) {
			lines.push(
				``,
				`## Direction de retouche`,
				``,
				`**Style :** ${r.retouche.style}`,
				`**Colorimétrie :** ${r.retouche.colorimetrie}`,
				`**Exposition :** ${r.retouche.exposition}`,
				`**Finition :** ${r.retouche.finition}`
			);
		}

		const blob = new Blob([lines.join('\n')], { type: 'text/markdown; charset=utf-8' });
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement('a');
		a.href     = url;
		a.download = `analyse-${filename}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// ── Reset ──────────────────────────────────────────────────────────────────
	function reset() {
		if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
		showToast = false;
		error = null;
		previewUrl = null;
		previewBlob = null;
		metadata = {};
		currentFile = null;
		isLoading = false;
		panelOpen = false;
		isAnalyzing = false;
		currentStep = null;
		analysisResult = null;
		analysisError = null;
		batchMode    = false;
		batchItems   = [];
		batchRunning = false;
		batchDone    = false;
	}

	// ── Mode lot : helpers ─────────────────────────────────────────────────────
	function startBatchMode(files: File[]) {
		error = null;
		if (files.length > 10) {
			error = 'Maximum 10 fichiers par lot.';
			return;
		}
		const valid = files.filter(f => ACCEPTED.includes(getExt(f)));
		if (valid.length === 0) {
			error = `Aucun fichier RAW valide. Utilisez ${ACCEPTED.join(', ')}.`;
			return;
		}
		batchMode    = true;
		batchRunning = false;
		batchDone    = false;
		batchItems   = valid.map(f => ({
			id: Math.random().toString(36).slice(2),
			file: f,
			previewBlob: null,
			metadata: {},
			status: 'pending' as BatchStatus,
			result: null,
			errorMsg: null
		}));
	}

	async function parseSseStream(res: Response): Promise<AnalysisResult> {
		const reader  = res.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let result: AnalysisResult | null = null;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split('\n\n');
			buffer = parts.pop() ?? '';
			for (const part of parts) {
				if (!part.trim()) continue;
				let eventName = '';
				let data = '';
				for (const line of part.split('\n')) {
					if (line.startsWith('event: ')) eventName = line.slice(7).trim();
					if (line.startsWith('data: '))  data      = line.slice(6).trim();
				}
				if (!eventName || !data) continue;
				const parsed = JSON.parse(data);
				if (eventName === 'result') result = parsed as AnalysisResult;
				if (eventName === 'error')  throw new Error(parsed.message);
			}
		}
		if (!result) throw new Error('Aucun résultat reçu');
		return result;
	}

	async function runBatch() {
		batchRunning = true;
		batchDone    = false;
		panelOpen    = true;

		for (let i = 0; i < batchItems.length; i++) {
			batchItems = batchItems.map((it, j) =>
				j === i ? { ...it, status: 'processing' as BatchStatus } : it
			);
			try {
				const previewForm = new FormData();
				previewForm.append('file', batchItems[i].file);
				const previewRes = await fetch('/api/analyze/preview', { method: 'POST', body: previewForm });
				if (!previewRes.ok) throw new Error('Conversion échouée');
				const { preview, metadata: exifMeta } = await previewRes.json();
				const bytes = Uint8Array.from(atob(preview), (c) => c.charCodeAt(0));
				const blob  = new Blob([bytes], { type: 'image/jpeg' });

				const analyzeForm = new FormData();
				analyzeForm.append('jpeg', blob, 'preview.jpg');
				analyzeForm.append('metadata', JSON.stringify(exifMeta ?? {}));
				const analyzeRes = await fetch('/api/analyze', { method: 'POST', body: analyzeForm });
				if (!analyzeRes.ok) throw new Error('Analyse échouée');

				const result = await parseSseStream(analyzeRes);

				const file = batchItems[i].file;
				createThumbnail(blob).then(thumbnail => {
					saveEntry({ id: Date.now().toString(), date: new Date().toISOString(),
						filename: file.name, thumbnail, metadata: exifMeta ?? {}, result });
					historyEntries = getEntries();
				}).catch(() => {});

				batchItems = batchItems.map((it, j) =>
					j === i ? { ...it, status: 'done' as BatchStatus, previewBlob: blob, metadata: exifMeta ?? {}, result } : it
				);
			} catch (e) {
				const msg = e instanceof Error ? e.message : 'Erreur inconnue';
				batchItems = batchItems.map((it, j) =>
					j === i ? { ...it, status: 'error' as BatchStatus, errorMsg: msg } : it
				);
			}
		}

		batchRunning = false;
		batchDone    = true;
		batchItems   = [...batchItems].sort((a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1));
	}

	function downloadBatchReport() {
		const date = new Date().toLocaleDateString('fr-FR');
		const lines: string[] = [
			`# Rapport d'analyse en lot — ${date}`,
			``,
			`${batchItems.length} photo(s) analysée(s), classées par score décroissant.`,
			``
		];
		for (const item of batchItems) {
			if (!item.result) {
				lines.push(`## ${item.file.name} — Erreur`, ``, item.errorMsg ?? 'Analyse échouée', ``);
				continue;
			}
			const r = item.result;
			lines.push(
				`## ${item.file.name} — Score : ${r.score}/10`,
				``,
				`**Sujet :** ${r.sujet}`,
				`**Type :** ${r.type_photo}`,
				``,
				`### Lumière`, r.lumiere, ``,
				`### Composition`, r.composition, ``,
				`### Axes d'amélioration`,
				...r.ameliorations.map(c => `- ${c}`),
				``
			);
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/markdown; charset=utf-8' });
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement('a');
		a.href     = url;
		a.download = `rapport-lot-${new Date().toISOString().slice(0, 10)}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function downloadBatchPDF() {
		const { default: jsPDF } = await import('jspdf');
		const doc = new jsPDF({ unit: 'mm', format: 'a4' });

		const pageW  = doc.internal.pageSize.getWidth();
		const pageH  = doc.internal.pageSize.getHeight();
		const margin = 15;
		const colW   = pageW - margin * 2;

		const white  = [255, 255, 255] as const;
		const dark   = [30,  30,  40]  as const;
		const accent = [110, 123, 255] as const;
		const grey   = [90,  95, 114]  as const;
		const light  = [196, 200, 216] as const;

		doc.setFillColor(...white);
		doc.rect(0, 0, pageW, pageH, 'F');

		const dateStr = new Date().toISOString().slice(0, 10);
		let y = margin;

		// ── Titre ──
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(18);
		doc.setTextColor(...dark);
		doc.text("Rapport d'analyse en lot", margin, y);
		y += 7;

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(10);
		doc.setTextColor(...grey);
		doc.text(dateStr, margin, y);
		y += 10;

		// ── Entrées ──
		for (let i = 0; i < batchItems.length; i++) {
			const item = batchItems[i];

			if (y > pageH - 40) {
				doc.addPage();
				doc.setFillColor(...white);
				doc.rect(0, 0, pageW, pageH, 'F');
				y = margin;
			}

			doc.setDrawColor(...grey);
			doc.line(margin, y, pageW - margin, y);
			y += 5;

			// Rank + filename + score
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(11);
			doc.setTextColor(...dark);
			doc.text(`#${i + 1}  ${item.file.name}`, margin, y);

			if (item.result) {
				doc.setTextColor(...accent);
				doc.text(`${item.result.score}/10`, pageW - margin - 15, y);
			}
			y += 6;

			if (!item.result) {
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(9);
				doc.setTextColor(239, 68, 68);
				doc.text(item.errorMsg ?? 'Analyse échouée', margin, y);
				y += 8;
				continue;
			}

			const r = item.result;

			// Aperçu photo
			if (item.previewBlob) {
				const imgData = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as string);
					reader.readAsDataURL(item.previewBlob!);
				});
				const imgH = 45;
				if (y + imgH > pageH - margin) {
					doc.addPage();
					doc.setFillColor(...white);
					doc.rect(0, 0, pageW, pageH, 'F');
					y = margin;
				}
				doc.addImage(imgData, 'JPEG', margin, y, colW, imgH);
				y += imgH + 4;
			}

			// Sujet + type
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(10);
			doc.setTextColor(...light);
			doc.text(r.sujet, margin, y);
			y += 5;

			doc.setFontSize(9);
			doc.setTextColor(...accent);
			doc.text(r.type_photo, margin, y);
			y += 7;

			// Lumière
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(8);
			doc.setTextColor(...grey);
			doc.text('LUMIÈRE', margin, y);
			y += 4;
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(...light);
			const lumiereLines = doc.splitTextToSize(r.lumiere, colW);
			for (const line of lumiereLines) { doc.text(line, margin, y); y += 4; }
			y += 2;

			// Composition
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(8);
			doc.setTextColor(...grey);
			doc.text('COMPOSITION', margin, y);
			y += 4;
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(...light);
			const compoLines = doc.splitTextToSize(r.composition, colW);
			for (const line of compoLines) { doc.text(line, margin, y); y += 4; }
			y += 5;
		}

		doc.save(`rapport-lot-${dateStr}.pdf`);
	}
</script>

<div class="page" class:panel-open={panelOpen}>
	<header class="header">
		<a href="/" class="logo" onclick={reset}>
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
				<circle cx="12" cy="13" r="4"/>
			</svg>
			<span>PhotoAssist</span>
		</a>
		<button class="btn-history" onclick={toggleHistory}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/>
				<polyline points="12 6 12 12 16 14"/>
			</svg>
			Historique
			{#if historyEntries.length > 0}
				<span class="badge-count">{historyEntries.length}</span>
			{/if}
		</button>
	</header>

	<div class="workspace">
		<!-- ── Colonne upload ── -->
		<main class="upload-col">
			{#if batchMode}
				<div class="batch-queue">
					<div class="batch-queue-header">
						<span class="batch-title">Lot de {batchItems.length} photo{batchItems.length > 1 ? 's' : ''}</span>
						{#if batchRunning || batchDone}
							<span class="batch-progress">
								{batchItems.filter(it => it.status === 'done' || it.status === 'error').length}
								/ {batchItems.length} analysées
							</span>
						{/if}
					</div>
					<ul class="batch-list">
						{#each batchItems as item (item.id)}
							<li class="batch-item">
								<span class="batch-item-name">{item.file.name}</span>
								<span class="batch-status status-{item.status}">
									{#if item.status === 'pending'}En attente
									{:else if item.status === 'processing'}En cours
									{:else if item.status === 'done'}Terminé
									{:else}Erreur{/if}
								</span>
							</li>
						{/each}
					</ul>
					{#if !batchRunning && !batchDone}
						<button class="btn-primary" onclick={runBatch}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polygon points="5 3 19 12 5 21 5 3"/>
							</svg>
							Lancer l'analyse
						</button>
					{/if}
					{#if batchDone}
						<button class="btn-nouvelle" onclick={reset}>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="1 4 1 10 7 10"/>
								<path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
							</svg>
							Nouvelle photo
						</button>
					{/if}
				</div>
			{:else}
				<section
					role="region"
					aria-label="Zone de glisser-déposer votre photo RAW"
					class="dropzone"
					class:drag-over={isDragOver}
					class:has-preview={previewUrl}
					class:loading={isLoading}
					ondrop={handleDrop}
					ondragover={handleDragOver}
					ondragleave={() => (isDragOver = false)}
				>
					{#if isLoading}
						<div role="status" aria-label="Traitement en cours" class="status-loading">
							<div class="spinner"></div>
							<p>Traitement en cours…</p>
						</div>
					{:else if previewUrl}
						<img src={previewUrl} alt="Aperçu de votre photo" class="preview-img" />
						<div class="preview-overlay">
							<span class="file-name">{currentFile?.name}</span>
						</div>
					{:else}
						<label class="drop-content" for="file-input">
							<div class="drop-icon">
								<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
									<polyline points="17 8 12 3 7 8"/>
									<line x1="12" y1="3" x2="12" y2="15"/>
								</svg>
							</div>
							<p class="drop-title">Glissez votre photo RAW ici</p>
							<p class="drop-sub">ou <span class="browse-link">parcourez vos fichiers</span></p>
							<div class="formats">
								{#each ACCEPTED as fmt}
									<span class="badge">.{fmt}</span>
								{/each}
							</div>
						</label>
						<input
							id="file-input"
							type="file"
							accept={ACCEPTED.map((e) => `.${e}`).join(',')}
							multiple
							onchange={handleInputChange}
							class="file-input"
						/>
					{/if}
				</section>

				{#if error}
					<div role="alert" class="alert">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10"/>
							<line x1="12" y1="8" x2="12" y2="12"/>
							<line x1="12" y1="16" x2="12.01" y2="16"/>
						</svg>
						<p>{error}</p>
						<button class="btn-ghost" onclick={reset}>Réessayer</button>
					</div>
				{/if}

				<button
					class="btn-primary"
					disabled={isLoading || isAnalyzing || !currentFile}
					onclick={analyzePhoto}
				>
					{#if isAnalyzing}
						<div class="spinner-sm"></div>
						Analyse en cours…
					{:else if isLoading}
						<div class="spinner-sm"></div>
						Conversion…
					{:else}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="11" cy="11" r="8"/>
							<line x1="21" y1="21" x2="16.65" y2="16.65"/>
						</svg>
						Analyser
					{/if}
				</button>

				{#if panelOpen}
					<button class="btn-nouvelle" onclick={reset}>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="1 4 1 10 7 10"/>
							<path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
						</svg>
						Nouvelle photo
					</button>
				{/if}
			{/if}
		</main>

		<!-- ── Panneau latéral analyse ── -->
		{#if panelOpen && !batchMode}
			<aside aria-label="Résultat de l'analyse" class="panel">
				{#if isAnalyzing}
					<div role="status" aria-label="Analyse en cours" aria-busy="true" class="panel-loading">
						<div class="spinner"></div>
						<p class="step-label">{currentStep ?? 'Initialisation…'}</p>
					</div>
				{:else if analysisError}
					<div role="alert" class="panel-error">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10"/>
							<line x1="12" y1="8" x2="12" y2="12"/>
							<line x1="12" y1="16" x2="12.01" y2="16"/>
						</svg>
						<p>{analysisError}</p>
					</div>
				{:else if analysisResult}
					<div class="result">
						<div class="result-header">
							<div class="result-meta">
								<h2 class="result-sujet">{analysisResult.sujet}</h2>
								<p class="result-type">{analysisResult.type_photo}</p>
							</div>
							<div class="score-badge">
								<span class="score-value">{analysisResult.score}</span>
								<span class="score-denom">/10</span>
							</div>
						</div>

						<div class="result-section">
							<h3>Lumière</h3>
							<p>{analysisResult.lumiere}</p>
						</div>

						<div class="result-section">
							<h3>Composition</h3>
							<p>{analysisResult.composition}</p>
						</div>

						<div class="result-section">
							<h3>Axes d'amélioration</h3>
							<ul class="ameliorations">
								{#each analysisResult.ameliorations as conseil}
									<li>{conseil}</li>
								{/each}
							</ul>
						</div>

						{#if analysisResult.retouche}
							<div class="retouche-block">
								<h3 class="retouche-title">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
									</svg>
									Direction de retouche
								</h3>
								<div class="retouche-grid">
									<div class="retouche-item">
										<span class="retouche-label">Style</span>
										<p>{analysisResult.retouche.style}</p>
									</div>
									<div class="retouche-item">
										<span class="retouche-label">Colorimétrie</span>
										<p>{analysisResult.retouche.colorimetrie}</p>
									</div>
									<div class="retouche-item">
										<span class="retouche-label">Exposition</span>
										<p>{analysisResult.retouche.exposition}</p>
									</div>
									<div class="retouche-item">
										<span class="retouche-label">Finition</span>
										<p>{analysisResult.retouche.finition}</p>
									</div>
								</div>
							</div>
						{/if}

						<div class="download-actions">
							<button class="btn-download" onclick={exportToPDF}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
									<polyline points="14 2 14 8 20 8"/>
									<line x1="16" y1="13" x2="8" y2="13"/>
									<line x1="16" y1="17" x2="8" y2="17"/>
									<polyline points="10 9 9 9 8 9"/>
								</svg>
								Exporter en PDF
							</button>
							<button class="btn-download" onclick={downloadAnalysis}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
									<polyline points="7 10 12 15 17 10"/>
									<line x1="12" y1="15" x2="12" y2="3"/>
								</svg>
								Télécharger l'analyse
							</button>
						</div>
					</div>
				{/if}
			</aside>
		{:else if batchMode && panelOpen}
			<aside aria-label="Classement du lot" class="panel">
				{#if batchDone}
					<div class="batch-results-header">
						<h2 class="batch-results-title">Résultats du lot</h2>
						<div class="batch-header-actions">
							<button class="btn-download" onclick={downloadBatchPDF}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
									<polyline points="14 2 14 8 20 8"/>
									<line x1="16" y1="13" x2="8" y2="13"/>
									<line x1="16" y1="17" x2="8" y2="17"/>
									<polyline points="10 9 9 9 8 9"/>
								</svg>
								Exporter en PDF
							</button>
							<button class="btn-download" onclick={downloadBatchReport}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
									<polyline points="7 10 12 15 17 10"/>
									<line x1="12" y1="15" x2="12" y2="3"/>
								</svg>
								Télécharger le rapport
							</button>
						</div>
					</div>
				{:else}
					<div role="status" aria-label="Analyse en cours" aria-busy="true" class="panel-loading">
						<div class="spinner"></div>
						<p class="step-label">Analyse en cours…</p>
					</div>
				{/if}
				<div class="batch-results-list">
					{#each batchItems as item, rank (item.id)}
						{#if item.status === 'done' || item.status === 'error'}
							<article class="batch-result-card" class:has-error={item.status === 'error'}>
								<div class="batch-result-header">
									<span class="batch-rank">#{rank + 1}</span>
									<span class="batch-result-filename">{item.file.name}</span>
									{#if item.result}
										<div class="score-badge">
											<span class="score-value">{item.result.score}</span>
											<span class="score-denom">/10</span>
										</div>
									{:else}
										<span class="batch-error-badge">Erreur</span>
									{/if}
								</div>
								{#if item.result}
									<p class="batch-result-sujet">{item.result.sujet}</p>
									<p class="batch-result-type">{item.result.type_photo}</p>
								{:else if item.errorMsg}
									<p class="batch-result-error">{item.errorMsg}</p>
								{/if}
							</article>
						{/if}
					{/each}
				</div>
			</aside>
		{/if}
	</div>

	{#if historyOpen}
		<section aria-label="Historique des analyses" class="history-panel">
			{#if historyEntries.length === 0}
				<p class="history-empty">Analysez votre première photo pour la retrouver ici</p>
			{:else}
				<div class="history-grid">
					{#each historyEntries as entry (entry.id)}
						<article class="history-card">
							<button class="history-card-main" onclick={() => restoreFromHistory(entry)}>
								<img src={entry.thumbnail} alt="" class="history-thumb" />
								<div class="history-info">
									<p class="history-filename">{entry.filename}</p>
									<p class="history-type">{entry.result.type_photo}</p>
									<div class="history-footer">
										<span class="history-score">{entry.result.score}/10</span>
										<span class="history-date">{formatDate(entry.date)}</span>
									</div>
								</div>
							</button>
							<button
								class="btn-delete"
								aria-label="Supprimer cette analyse"
								onclick={() => removeEntry(entry.id)}
							>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<polyline points="3 6 5 6 21 6"/>
									<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
									<path d="M10 11v6M14 11v6"/>
									<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
								</svg>
							</button>
						</article>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	{#if showToast}
		<div aria-live="polite" aria-atomic="true" class="toast">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
				<polyline points="20 6 9 17 4 12"/>
			</svg>
			Photo prête à être analysée
		</div>
	{/if}
</div>

<style>
	:global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
	:global(body) {
		background: #0c0d10;
		color: #e2e4e9;
		font-family: 'Inter', system-ui, sans-serif;
		min-height: 100vh;
	}

	/* ── Layout ── */
	.page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem 1.5rem 4rem;
	}

	.workspace {
		display: flex;
		gap: 1.5rem;
		width: 100%;
		max-width: 600px;
		transition: max-width 0.35s ease;
	}

	.page.panel-open .workspace {
		max-width: 1100px;
	}

	.upload-col {
		flex: 0 0 540px;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	/* ── Header ── */
	.header {
		width: 100%;
		max-width: 1100px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.5rem 0 2.5rem;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1.1rem;
		font-weight: 600;
		color: #f0f1f3;
		letter-spacing: -0.01em;
		text-decoration: none;
		cursor: pointer;
	}

	.logo svg { color: #6e7bff; }

	/* ── Dropzone ── */
	.dropzone {
		position: relative;
		width: 100%;
		min-height: 340px;
		border-radius: 16px;
		border: 1.5px dashed #2a2d3a;
		background: #13141a;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
		overflow: hidden;
	}

	.dropzone:hover, .dropzone.drag-over {
		border-color: #6e7bff;
		background: #15172a;
		box-shadow: 0 0 0 4px rgba(110, 123, 255, 0.08);
	}

	.dropzone.has-preview { border-style: solid; border-color: #2a2d3a; cursor: default; min-height: 400px; }
	.dropzone.loading     { cursor: wait; }

	.drop-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem;
		cursor: pointer;
		width: 100%;
		text-align: center;
	}

	.drop-icon { color: #3d4260; margin-bottom: 0.5rem; transition: color 0.2s; }
	.dropzone:hover .drop-icon, .dropzone.drag-over .drop-icon { color: #6e7bff; }

	.drop-title { font-size: 1rem; font-weight: 500; color: #c4c8d8; }
	.drop-sub   { font-size: 0.85rem; color: #5a5f72; }
	.browse-link { color: #6e7bff; text-decoration: underline; text-underline-offset: 2px; }

	.formats { display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: center; margin-top: 0.5rem; }

	.badge {
		font-size: 0.72rem;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		padding: 0.2rem 0.55rem;
		border-radius: 6px;
		background: #1e2030;
		color: #6e7bff;
		border: 1px solid #2a2d3a;
	}

	.file-input { display: none; }

	.preview-img { width: 100%; height: 100%; min-height: 400px; object-fit: cover; display: block; }

	.preview-overlay {
		position: absolute;
		bottom: 0; left: 0; right: 0;
		padding: 0.75rem 1rem;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
	}

	.file-name { font-size: 0.8rem; color: #c4c8d8; font-family: 'JetBrains Mono', monospace; }

	/* ── Spinners ── */
	.status-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		color: #5a5f72;
		font-size: 0.9rem;
	}

	.spinner {
		width: 36px; height: 36px;
		border: 2px solid #2a2d3a;
		border-top-color: #6e7bff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.spinner-sm {
		width: 16px; height: 16px;
		border: 2px solid rgba(255,255,255,0.2);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	/* ── Alert upload ── */
	.alert {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		border-radius: 10px;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.25);
		color: #f87171;
		font-size: 0.875rem;
	}
	.alert svg { flex-shrink: 0; }
	.alert p   { flex: 1; }

	/* ── Buttons ── */
	.btn-primary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.875rem;
		border-radius: 10px;
		border: none;
		background: #6e7bff;
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s, opacity 0.2s, transform 0.1s;
		letter-spacing: -0.01em;
	}

	.btn-primary:hover:not(:disabled) { background: #5c6aee; transform: translateY(-1px); }
	.btn-primary:active:not(:disabled) { transform: translateY(0); }
	.btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

	.btn-ghost {
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		border: 1px solid rgba(239, 68, 68, 0.3);
		background: transparent;
		color: #f87171;
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.2s;
	}
	.btn-ghost:hover { background: rgba(239, 68, 68, 0.1); }

	/* ── Panneau latéral ── */
	.panel {
		flex: 1;
		min-width: 320px;
		background: #13141a;
		border: 1px solid #2a2d3a;
		border-radius: 16px;
		overflow-y: auto;
		max-height: calc(100vh - 10rem);
		animation: slide-in 0.3s ease;
	}

	@keyframes slide-in {
		from { opacity: 0; transform: translateX(16px); }
		to   { opacity: 1; transform: translateX(0); }
	}

	.panel-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
		height: 100%;
		min-height: 300px;
		color: #5a5f72;
	}

	.step-label {
		font-size: 0.9rem;
		color: #6e7bff;
		font-weight: 500;
	}

	.panel-error {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1.5rem;
		color: #f87171;
		font-size: 0.875rem;
	}
	.panel-error svg { flex-shrink: 0; margin-top: 1px; }

	/* ── Résultat ── */
	.result { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }

	.result-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid #1e2030;
	}

	.result-sujet { font-size: 1rem; font-weight: 600; color: #f0f1f3; line-height: 1.4; }
	.result-type  { font-size: 0.8rem; color: #6e7bff; margin-top: 0.3rem; }

	.score-badge {
		flex-shrink: 0;
		display: flex;
		align-items: baseline;
		gap: 1px;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 10px;
		padding: 0.4rem 0.75rem;
	}

	.score-value { font-size: 1.4rem; font-weight: 700; color: #6e7bff; line-height: 1; }
	.score-denom { font-size: 0.75rem; color: #5a5f72; }

	.result-section { display: flex; flex-direction: column; gap: 0.5rem; }

	.result-section h3 {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #5a5f72;
	}

	.result-section p { font-size: 0.875rem; color: #c4c8d8; line-height: 1.6; }

	.ameliorations {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
	}

	.ameliorations li {
		font-size: 0.875rem;
		color: #c4c8d8;
		line-height: 1.5;
		padding-left: 1rem;
		position: relative;
	}

	.ameliorations li::before {
		content: '→';
		position: absolute;
		left: 0;
		color: #6e7bff;
		font-size: 0.8rem;
	}

	/* ── Bloc retouche ── */
	.retouche-block {
		background: #0e0f14;
		border: 1px solid #2a2d3a;
		border-radius: 12px;
		padding: 1.1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.retouche-title {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #a78bfa;
	}

	.retouche-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.retouche-item { display: flex; flex-direction: column; gap: 0.2rem; }

	.retouche-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #5a5f72;
	}

	.retouche-item p {
		font-size: 0.85rem;
		color: #c4c8d8;
		line-height: 1.55;
	}

	/* ── Bouton historique ── */
	.btn-history {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.85rem;
		border-radius: 8px;
		border: 1px solid #2a2d3a;
		background: transparent;
		color: #8b92a8;
		font-size: 0.825rem;
		cursor: pointer;
		transition: border-color 0.2s, color 0.2s;
	}

	.btn-history:hover { border-color: #6e7bff; color: #6e7bff; }

	.badge-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 9px;
		background: #6e7bff;
		color: #fff;
		font-size: 0.68rem;
		font-weight: 700;
	}

	/* ── Panneau historique ── */
	.history-panel {
		width: 100%;
		max-width: 1100px;
		margin-top: 2rem;
		padding-top: 1.5rem;
		border-top: 1px solid #2a2d3a;
		animation: slide-in 0.25s ease;
	}

	.history-empty {
		color: #5a5f72;
		font-size: 0.875rem;
		text-align: center;
		padding: 2.5rem 1rem;
	}

	.history-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 1rem;
	}

	.history-card {
		position: relative;
		border-radius: 12px;
		border: 1px solid #2a2d3a;
		background: #13141a;
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.history-card:hover { border-color: #6e7bff; }

	.history-card-main {
		width: 100%;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		color: inherit;
		display: block;
	}

	.history-thumb {
		width: 100%;
		height: 96px;
		object-fit: cover;
		display: block;
	}

	.history-info {
		padding: 0.6rem 0.75rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.history-filename {
		font-size: 0.75rem;
		font-family: 'JetBrains Mono', monospace;
		color: #c4c8d8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.history-type { font-size: 0.7rem; color: #6e7bff; }

	.history-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 0.3rem;
	}

	.history-score { font-size: 0.78rem; font-weight: 600; color: #f0f1f3; }
	.history-date  { font-size: 0.67rem; color: #5a5f72; }

	.btn-delete {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: none;
		background: rgba(0, 0, 0, 0.55);
		color: #8b92a8;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s, color 0.15s, background 0.15s;
	}

	.history-card:hover .btn-delete { opacity: 1; }
	.btn-delete:hover { color: #f87171; background: rgba(239, 68, 68, 0.18); }

	/* ── Bouton nouvelle photo ── */
	.btn-nouvelle {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: 1px solid #2a2d3a;
		background: transparent;
		color: #8b92a8;
		font-size: 0.875rem;
		cursor: pointer;
		transition: border-color 0.2s, color 0.2s, background 0.2s;
	}

	.btn-nouvelle:hover {
		border-color: #6e7bff;
		color: #6e7bff;
		background: rgba(110, 123, 255, 0.06);
	}

	/* ── Toast ── */
	.toast {
		position: fixed;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 1.25rem;
		border-radius: 10px;
		background: #0d1f10;
		border: 1px solid rgba(74, 222, 128, 0.3);
		color: #4ade80;
		font-size: 0.875rem;
		font-weight: 500;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
		white-space: nowrap;
		animation: toast-in 0.25s ease;
		z-index: 100;
	}

	@keyframes toast-in {
		from { opacity: 0; transform: translateX(-50%) translateY(8px); }
		to   { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	/* ── Actions téléchargement ── */
	.download-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* ── Bouton téléchargement ── */
	.btn-download {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.7rem;
		border-radius: 8px;
		border: 1px solid #2a2d3a;
		background: transparent;
		color: #8b92a8;
		font-size: 0.85rem;
		cursor: pointer;
		transition: border-color 0.2s, color 0.2s, background 0.2s;
	}

	.btn-download:hover {
		border-color: #6e7bff;
		color: #6e7bff;
		background: rgba(110, 123, 255, 0.06);
	}

	/* ── Lot (batch) ── */
	.batch-queue {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.batch-queue-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.batch-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #c4c8d8;
	}

	.batch-progress {
		font-size: 0.8rem;
		font-weight: 600;
		color: #6e7bff;
		white-space: nowrap;
	}

	.batch-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
		background: #13141a;
		border: 1px solid #2a2d3a;
		border-radius: 12px;
		padding: 0.75rem;
		max-height: 340px;
		overflow-y: auto;
	}

	.batch-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.45rem 0.5rem;
		border-radius: 8px;
		background: #0e0f14;
	}

	.batch-item-name {
		font-size: 0.78rem;
		font-family: 'JetBrains Mono', monospace;
		color: #c4c8d8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.batch-status {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.2rem 0.55rem;
		border-radius: 6px;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.status-pending   { background: #1e2030; color: #5a5f72; }
	.status-processing { background: rgba(110,123,255,0.15); color: #6e7bff; }
	.status-done      { background: rgba(74,222,128,0.12); color: #4ade80; }
	.status-error     { background: rgba(239,68,68,0.12); color: #f87171; }

	/* ── Panneau batch résultats ── */
	.batch-results-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 0.75rem;
		border-bottom: 1px solid #1e2030;
	}

	.batch-header-actions {
		display: flex;
		gap: 0.5rem;
	}

	.batch-results-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #c4c8d8;
	}

	.batch-results-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.5rem 1.5rem;
	}

	.batch-result-card {
		background: #0e0f14;
		border: 1px solid #2a2d3a;
		border-radius: 10px;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		transition: border-color 0.15s;
	}

	.batch-result-card.has-error { border-color: rgba(239,68,68,0.3); }

	.batch-result-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.batch-rank {
		font-size: 0.7rem;
		font-weight: 700;
		color: #5a5f72;
		flex-shrink: 0;
		width: 1.5rem;
	}

	.batch-result-filename {
		font-size: 0.72rem;
		font-family: 'JetBrains Mono', monospace;
		color: #8b92a8;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.batch-error-badge {
		font-size: 0.68rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 5px;
		background: rgba(239,68,68,0.12);
		color: #f87171;
		flex-shrink: 0;
	}

	.batch-result-sujet {
		font-size: 0.82rem;
		font-weight: 500;
		color: #f0f1f3;
		line-height: 1.4;
		padding-left: 2.1rem;
	}

	.batch-result-type {
		font-size: 0.72rem;
		color: #6e7bff;
		padding-left: 2.1rem;
	}

	.batch-result-error {
		font-size: 0.78rem;
		color: #f87171;
		padding-left: 2.1rem;
	}
</style>
