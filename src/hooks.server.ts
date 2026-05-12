import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const password = process.env.SITE_PASSWORD;

	if (password) {
		const auth = event.request.headers.get('authorization') ?? '';
		const expected = `Basic ${btoa(`admin:${password}`)}`;

		if (auth !== expected) {
			return new Response('Accès protégé', {
				status: 401,
				headers: { 'WWW-Authenticate': 'Basic realm="PhotoAssist"' }
			});
		}
	}

	return resolve(event);
};
