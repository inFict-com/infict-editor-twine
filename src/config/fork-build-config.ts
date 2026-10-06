/**
 * Fork build defaults: bundled extended story format (Snowcone) vs upstream-style core build.
 *
 * Snowcone passage command editor (`@infict/dialog-forms` API; resolved via Vite): see `snowcone-passage-command-editor.ts` and `vite.config.mts` `resolveSnowconeDialogFormsAliases`.
 *
 * - `VITE_TWINE_FORK_EXTENDED=false` — Harlowe default, no extended format builtin, no remote embed wiring.
 * - Legacy: `VITE_INFICT_TWINE=false` is still honored (same effect).
 *
 * Default Snowcone `format.js` URL is **relative** (same as other builtins), so it loads from the
 * Twine app origin (`/twinejs/story-formats/...` when embedded). Override with `VITE_SNOWCONE_FORMAT_URL`
 * or `VITE_SNOWCONE_FORMAT_BASE_URL` if you need an absolute URL.
 */

/** Matches klembot/twinejs `src/store/prefs/defaults.ts` storyFormat. */
export const UPSTREAM_DEFAULT_STORY_FORMAT = {
	name: 'Harlowe',
	version: '3.3.9'
} as const;

/**
 * Bundled extended format (author-facing name/version; must match loaded `format.js` metadata).
 */
export const BUNDLED_EXTENDED_FORMAT = {
	name: 'Snowcone',
	version: '1.0.28'
} as const;

/** Relative to the Twine web root (e.g. `dist/web/`); matches Harlowe/SugarCube builtin URLs. */
const DEFAULT_EXTENDED_FORMAT_JS_URL = `story-formats/snowcone-${BUNDLED_EXTENDED_FORMAT.version}/format.js`;

/** Vite inlines `process.env.VITE_*` via `vite.config` `define`; Jest reads real `process.env`. */
function readViteEnv(key: string): string | undefined {
	const v = typeof process !== 'undefined' ? process.env[key] : undefined;
	return v === '' ? undefined : v;
}

/** Absolute URL to the bundled extended format’s `format.js` (JSONP). */
export function getBundledExtendedFormatJsUrl(): string {
	const full = readViteEnv('VITE_SNOWCONE_FORMAT_URL');
	if (full) {
		return full;
	}
	const base = readViteEnv('VITE_SNOWCONE_FORMAT_BASE_URL');
	if (base) {
		const b = base.replace(/\/$/, '');
		return `${b}/twinejs/story-formats/snowcone-${BUNDLED_EXTENDED_FORMAT.version}/format.js`;
	}
	return DEFAULT_EXTENDED_FORMAT_JS_URL;
}

export function isForkExtendedBuild(): boolean {
	const fork = process.env.VITE_TWINE_FORK_EXTENDED;
	const legacy = process.env.VITE_INFICT_TWINE;
	if (fork === 'false' || legacy === 'false') {
		return false;
	}
	return true;
}

export type ExtraBuiltinStoryFormat = {
	name: string;
	version: string;
	url: string;
};

/**
 * Optional extra builtins from `VITE_TWINE_EXTRA_BUILTINS` JSON array
 * `[{ "name", "version", "url" }, ...]`. Invalid entries are skipped.
 */
export function parseExtraBuiltinsFromEnv(): ExtraBuiltinStoryFormat[] {
	const raw = readViteEnv('VITE_TWINE_EXTRA_BUILTINS');
	if (!raw?.trim()) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		const out: ExtraBuiltinStoryFormat[] = [];
		for (const row of parsed) {
			if (
				row &&
				typeof row === 'object' &&
				typeof (row as ExtraBuiltinStoryFormat).name === 'string' &&
				typeof (row as ExtraBuiltinStoryFormat).version === 'string' &&
				typeof (row as ExtraBuiltinStoryFormat).url === 'string'
			) {
				out.push(row as ExtraBuiltinStoryFormat);
			}
		}
		return out;
	} catch {
		console.warn('[fork-build-config] Invalid VITE_TWINE_EXTRA_BUILTINS JSON');
		return [];
	}
}
