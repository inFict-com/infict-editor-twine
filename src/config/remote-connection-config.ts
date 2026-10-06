/**
 * Generic embedded Twine ↔ HTTP backend contract (query params, sessionStorage, postMessage).
 * Defaults match the inFict Controller embed; hosts can reuse the same keys or override via env.
 */

export const REMOTE_SESSION_STORAGE_KEY = 'twine-remote-config';

/** postMessage: parent → Twine (token refresh result). Legacy + v2 type string. */
export const TOKEN_REFRESH_MESSAGE_TYPES = ['twine-token-refresh', 'twine-token-refresh-v2'] as const;

/** postMessage: Twine → parent (request fresh token). */
export const TOKEN_REQUEST_MESSAGE_TYPE = 'twine-request-token';

export type RemoteConnectionQueryKeys = {
	apiBase: string;
	storyId: string;
	authToken: string;
	replaceExisting: string;
};

const DEFAULT_QUERY_KEYS: RemoteConnectionQueryKeys = {
	apiBase: 'apiEndpoint',
	storyId: 'storyId',
	authToken: 'authToken',
	replaceExisting: 'replaceExisting'
};

function parseQueryKeyMapJson(raw: string | undefined): Partial<RemoteConnectionQueryKeys> | null {
	if (!raw?.trim()) {
		return null;
	}
	try {
		const o = JSON.parse(raw) as Record<string, unknown>;
		const out: Partial<RemoteConnectionQueryKeys> = {};
		for (const k of Object.keys(DEFAULT_QUERY_KEYS) as Array<keyof RemoteConnectionQueryKeys>) {
			const v = o[k];
			if (typeof v === 'string' && v.length > 0) {
				out[k] = v;
			}
		}
		return out;
	} catch {
		return null;
	}
}

export function getRemoteQueryKeys(): RemoteConnectionQueryKeys {
	const raw = readViteEnv('VITE_TWINE_REMOTE_QUERY_KEYS');
	const parsed = parseQueryKeyMapJson(raw);
	return {...DEFAULT_QUERY_KEYS, ...parsed};
}

function readViteEnv(key: string): string | undefined {
	const v = typeof process !== 'undefined' ? process.env[key] : undefined;
	return v === '' ? undefined : v;
}

/** Story resource path template: `{apiBase}/stories/{storyId}` — only `{apiBase}` and `{storyId}` supported. */
export function getRemoteStoryResourceUrl(
	apiBase: string,
	remoteStoryId: string,
	template?: string
): string {
	const t =
		template ||
		readViteEnv('VITE_TWINE_REMOTE_STORY_PATH_TEMPLATE') ||
		'{apiBase}/stories/{storyId}';
	const base = apiBase.replace(/\/$/, '');
	return t.replace(/\{apiBase\}/g, base).replace(/\{storyId\}/g, remoteStoryId);
}

/**
 * Parse embed-related params from `location.hash`.
 * Twine uses `HashRouter`: routes look like `#/stories/...` or `#/?embed=...`.
 * The HTTP client never sends the fragment — safe for JWTs — but the hash must not
 * use a bare `#authToken=...` (that becomes pathname `/authToken=...` and breaks routes).
 */
export function getHashSearchParams(): URLSearchParams {
	if (typeof window === 'undefined') {
		return new URLSearchParams();
	}
	const raw = window.location.hash.replace(/^#/, '');
	if (!raw) {
		return new URLSearchParams();
	}
	// HashRouter: "#/path" or "#/path?k=v" — read only the ?query part.
	if (raw.startsWith('/')) {
		const q = raw.indexOf('?');
		if (q === -1) {
			return new URLSearchParams();
		}
		return new URLSearchParams(raw.slice(q + 1));
	}
	// Legacy mistaken format "#authToken=…" (no leading "/"); still parse for compat.
	return new URLSearchParams(raw);
}

export function readRemoteConnectionFromSearchParams(
	params: URLSearchParams,
	keys: RemoteConnectionQueryKeys,
	options?: {hashParams?: URLSearchParams}
): {
	apiEndpoint: string | null;
	storyId: string | null;
	authToken: string | null;
	replaceExisting: boolean;
} {
	const hash = options?.hashParams;
	const authFromHash = hash?.get(keys.authToken) ?? null;
	return {
		apiEndpoint: params.get(keys.apiBase),
		storyId: params.get(keys.storyId),
		authToken: params.get(keys.authToken) || authFromHash,
		replaceExisting: params.get(keys.replaceExisting) === 'true'
	};
}

export function readRemoteConnectionFromUrl(search: string) {
	return readRemoteConnectionFromSearchParams(
		new URLSearchParams(search),
		getRemoteQueryKeys()
	);
}
