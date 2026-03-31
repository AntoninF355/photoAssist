import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

// ── Prompt système (fixe) ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en photographie automobile avec 20 ans d'expérience.
Tu analyses des photos RAW converties en JPEG pour aider les photographes à progresser.

RÈGLES ABSOLUES :
- Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans texte avant ou après.
- Tu identifies précisément la marque et le modèle du véhicule visible sur la photo.
- Dans "lumiere" et "composition", tu cites OBLIGATOIREMENT les valeurs EXIF reçues
  (ex: "Avec un ISO 800 et 1/1000s, le photographe a figé le mouvement mais...").
- Les conseils dans "ameliorations" doivent être concrets et liés aux paramètres EXIF
  (ex: "L'ouverture f/2.8 crée un flou d'arrière-plan efficace, tenter f/4 pour plus de netteté sur l'ensemble du véhicule").

Structure JSON exacte :
{
  "sujet": "marque modèle + situation précise",
  "type_photo": "catégorie (ex: sport automobile action, extérieur statique, studio…)",
  "lumiere": "analyse avec citation des valeurs ISO/vitesse/ouverture",
  "composition": "analyse avec citation de la focale et du cadrage",
  "ameliorations": ["conseil lié aux EXIF 1", "conseil lié aux EXIF 2", "conseil lié aux EXIF 3"],
  "score": 7
}
Le score est un entier entre 1 et 10.`;

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
