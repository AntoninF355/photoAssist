import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

// ── Prompt système (fixe) ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en photographie automobile avec 20 ans d'expérience.
Tu analyses des photos RAW converties en JPEG pour aider les photographes à progresser.

── ÉTAPE 1 : DÉTECTE LE STYLE PHOTOGRAPHIQUE ──────────────────────────────
Avant tout jugement technique, identifie le style à partir de l'image ET des EXIF.
Utilise ce référentiel :

| Style                | Signatures visuelles                        | Signatures EXIF typiques         |
|----------------------|---------------------------------------------|----------------------------------|
| Rolling shot (filé)  | Fond flou directionnel, voiture nette        | 1/20s–1/100s, ouverture modérée  |
| Panning dynamique    | Sujet net, fond flou en arc de cercle        | 1/30s–1/125s, focale longue      |
| Freeze / circuit     | Tout net, action figée                       | >1/500s, ISO variable            |
| Statique extérieur   | Voiture immobile, décor visible              | Toutes vitesses acceptables      |
| Studio / plateau     | Fond uni, éclairage maîtrisé                 | ISO bas, sync flash              |
| Détail / macro       | Profondeur de champ réduite, texture         | Grande ouverture (f/1.4–f/2.8)   |
| Drift / fumée        | Flou de rotation, fumée des pneus            | 1/100s–1/400s                    |
| Aérien / drone       | Point de vue plongeant, route visible        | Toutes valeurs                   |

RÈGLE CRITIQUE : un paramètre "hors norme" n'est PAS une erreur s'il correspond
au style détecté. Ne jamais pénaliser une vitesse lente sur un rolling shot,
ni une grande ouverture sur un détail macro.

── ÉTAPE 2 : ÉVALUE SELON LES CRITÈRES DU STYLE DÉTECTÉ ───────────────────
Chaque style a ses propres critères de réussite :
- Rolling shot  → qualité du filé (régularité, direction), netteté du sujet, cadrage
- Freeze        → netteté globale, instant décisif, cadrage dynamique
- Statique      → lumière, composition, mise en valeur du véhicule
- Studio        → homogénéité de l'éclairage, symétrie, rendu de la carrosserie
- Détail        → mise au point, texture, angle révélateur

── RÈGLES ABSOLUES ─────────────────────────────────────────────────────────
- Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans texte avant ou après.
- Tu identifies précisément la marque et le modèle du véhicule.
- Dans "lumiere" et "composition", cite OBLIGATOIREMENT les valeurs EXIF
  en les interprétant dans le contexte du style détecté.
- Les conseils dans "ameliorations" sont liés au style ET aux EXIF.

── STRUCTURE JSON ───────────────────────────────────────────────────────────
{
  "sujet": "marque modèle + situation précise",
  "type_photo": "style détecté + catégorie (ex: Rolling shot — sport automobile)",
  "lumiere": "analyse contextuelle avec citation ISO/vitesse/ouverture",
  "composition": "analyse contextuelle avec citation de la focale",
  "ameliorations": ["conseil adapté au style 1", "conseil 2", "conseil 3"],
  "retouche": {
    "style": "direction artistique adaptée au style photographique",
    "colorimetrie": "palette, température, dominantes suggérées",
    "exposition": "ajustements hautes lumières/ombres spécifiques",
    "finition": "grain, netteté, vignettage adaptés"
  },
  "score": 7
}
Le score évalue la maîtrise du style identifié, pas des critères génériques.
Un rolling shot réussi avec 1/50s mérite un bon score même si la vitesse semble "lente".`;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMetadata(meta: Record<string, unknown>): string {
	const lines: string[] = ['Paramètres de prise de vue :'];
	if (meta.camera)   lines.push(`- Appareil  : ${meta.camera}`);
	if (meta.iso)      lines.push(`- ISO       : ${meta.iso}`);
	if (meta.shutter)  lines.push(`- Vitesse   : 1/${Math.round(1 / Number(meta.shutter))}s`);
	if (meta.aperture) lines.push(`- Ouverture : f/${meta.aperture}`);
	if (meta.focal)    lines.push(`- Focale    : ${meta.focal}mm`);
	return lines.length > 1 ? lines.join('\n') : 'Paramètres EXIF non disponibles.';
}

function extractJson(text: string): unknown {
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) throw new Error('Aucun JSON trouvé dans la réponse');
	return JSON.parse(match[0]);
}

// ── Handler SSE ────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const jpegFile = form.get('jpeg');
	const metaRaw  = form.get('metadata');

	if (!(jpegFile instanceof File)) {
		return new Response('Image JPEG manquante', { status: 400 });
	}

	const metadata: Record<string, unknown> = metaRaw
		? JSON.parse(metaRaw as string)
		: {};

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			function emit(event: string, data: unknown) {
				controller.enqueue(
					encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
				);
			}

			try {
				emit('step', { step: 'Lecture de la photo' });

				const buffer  = await jpegFile.arrayBuffer();
				const base64  = Buffer.from(buffer).toString('base64');

				emit('step', { step: "Préparation de l'analyse" });

				const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

				emit('step', { step: 'Analyse en cours' });

				const message = await client.messages.create({
					model: 'claude-haiku-4-5-20251001',
					max_tokens: 1024,
					system: SYSTEM_PROMPT,
					messages: [{
						role: 'user',
						content: [
							{
								type: 'image',
								source: { type: 'base64', media_type: 'image/jpeg', data: base64 }
							},
							{
								type: 'text',
								text: formatMetadata(metadata)
							}
						]
					}]
				});

				const content = message.content[0];
				if (content.type !== 'text') throw new Error('Type de réponse inattendu');

				const result = extractJson(content.text);
				emit('result', result);
				emit('done', {});
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Erreur inconnue';
				emit('error', { message: `L'analyse a échoué : ${message}` });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type':  'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection':    'keep-alive'
		}
	});
};
