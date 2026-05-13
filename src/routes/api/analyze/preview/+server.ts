import exifr from 'exifr';
import sharp from 'sharp';
import { requireAuth } from '$lib/auth';
import type { RequestHandler } from './$types';

// ── Extraction du plus grand JPEG embarqué dans le RAW ─────────────────────
// Les fichiers RAW contiennent plusieurs JPEG (thumbnails + preview pleine taille).
// On scanne les octets pour trouver le plus grand.

function extractLargestJpeg(buffer: Buffer): Buffer | null {
	const SOI = Buffer.from([0xff, 0xd8, 0xff]); // Start Of Image
	const EOI = Buffer.from([0xff, 0xd9]);        // End Of Image

	let largest: Buffer | null = null;
	let offset = 0;

	while (offset < buffer.length) {
		const start = buffer.indexOf(SOI, offset);
		if (start === -1) break;

		const end = buffer.indexOf(EOI, start + 3);
		if (end === -1) break;

		const candidate = buffer.subarray(start, end + 2);
		if (!largest || candidate.length > largest.length) {
			largest = Buffer.from(candidate); // copie pour éviter les références
		}

		offset = end + 2;
	}

	return largest;
}

// ── Handler ────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ request }) => {
	const unauthorized = requireAuth(request);
	if (unauthorized) return unauthorized;

	const form = await request.formData();
	const rawFile = form.get('file');

	if (!(rawFile instanceof File)) {
		return new Response('Fichier manquant', { status: 400 });
	}

	try {
		const buffer = Buffer.from(await rawFile.arrayBuffer());

		// 1. Extrait le plus grand JPEG embarqué
		const rawJpeg = extractLargestJpeg(buffer);
		if (!rawJpeg) {
			return new Response('Aucun preview JPEG trouvé dans ce fichier RAW', { status: 422 });
		}

		// 2. Redimensionne à 1920px max — réduit la taille (JSON léger) et
		//    reste sous la limite Claude (8000px) quelle que soit la caméra
		const jpeg = await sharp(rawJpeg)
			.rotate()  // applique la rotation EXIF avant tout traitement
			.resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: 88 })
			.toBuffer();

		// 3. Extrait les métadonnées EXIF depuis le RAW original (plus fiable côté serveur)
		let metadata: Record<string, unknown> = {};
		try {
			const exif = await exifr.parse(buffer, {
				pick: ['Make', 'Model', 'ISO', 'ExposureTime', 'FNumber', 'FocalLength']
			});
			if (exif) {
				metadata = {
					camera:   [exif.Make, exif.Model].filter(Boolean).join(' ') || undefined,
					iso:      exif.ISO,
					shutter:  exif.ExposureTime,
					aperture: exif.FNumber,
					focal:    exif.FocalLength
				};
			}
		} catch {
			// EXIF indisponible, on continue sans
		}

		// 4. Retourne preview (base64) + métadonnées en JSON
		return new Response(
			JSON.stringify({ preview: jpeg.toString('base64'), metadata }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch {
		return new Response('Extraction du preview échouée', { status: 422 });
	}
};
