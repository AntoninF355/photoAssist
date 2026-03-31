<script lang="ts">

	// ── Types ──────────────────────────────────────────────────────────────────
	interface Retouche {
		style: string;
		colorimetrie: string;
		exposition: string;
		finition: string;
	}

	interface AnalysisResult {
		sujet: string;
		type_photo: string;
		lumiere: string;
		composition: string;
		ameliorations: string[];
		retouche: Retouche;
		score: number;
	}

	// ── État upload ────────────────────────────────────────────────────────────
	const ACCEPTED = ['ARW', 'CR3', 'DNG', 'NEF', 'RAF'];

	let previewUrl    = $state<string | null>(null);
	let previewBlob   = $state<Blob | null>(null);
	let metadata      = $state<Record<string, unknown>>({});
	let isLoading     = $state(false);
	let error         = $state<string | null>(null);
	let currentFile   = $state<File | null>(null);
	let isDragOver    = $state(false);

	// ── État analyse ───────────────────────────────────────────────────────────
	let panelOpen      = $state(false);
	let isAnalyzing    = $state(false);
	let currentStep    = $state<string | null>(null);
	let analysisResult = $state<AnalysisResult | null>(null);
	let analysisError  = $state<string | null>(null);

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
					if (eventName === 'result') analysisResult = parsed;
					if (eventName === 'error')  { analysisError = parsed.message; isAnalyzing = false; }
					if (eventName === 'done')   { isAnalyzing = false; currentStep = null; }
				}
			}
		} catch {
			analysisError = "Une erreur inattendue s'est produite.";
			isAnalyzing = false;
		}
	}

	// ── Drag & drop ────────────────────────────────────────────────────────────
	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragOver = false;
		const file = e.dataTransfer?.files[0];
		if (file) processFile(file);
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragOver = true;
	}

	function handleInputChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) processFile(file);
	}

	// ── Reset ──────────────────────────────────────────────────────────────────
	function reset() {
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
	}
</script>

<div class="page" class:panel-open={panelOpen}>
	<header class="header">
		<div class="logo">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
				<circle cx="12" cy="13" r="4"/>
			</svg>
			<span>PhotoAssist</span>
		</div>
		<p class="tagline">Analyse IA de vos photos automobiles</p>
	</header>

	<div class="workspace">
		<!-- ── Colonne upload ── -->
		<main class="upload-col">
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
		</main>

		<!-- ── Panneau latéral analyse ── -->
		{#if panelOpen}
			<aside role="complementary" aria-label="Résultat de l'analyse" class="panel">
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
					</div>
				{/if}
			</aside>
		{/if}
	</div>
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
	}

	.logo svg { color: #6e7bff; }

	.tagline { font-size: 0.8rem; color: #5a5f72; }

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
</style>
