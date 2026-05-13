export function requireAuth(request: Request): Response | null {
	const password = process.env.SITE_PASSWORD;
	if (!password) return null;

	const auth = request.headers.get('authorization') ?? '';
	const expected = `Basic ${btoa(`admin:${password}`)}`;

	if (auth !== expected) {
		return new Response('Accès protégé', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Basic realm="PhotoAssist"' }
		});
	}

	return null;
}
