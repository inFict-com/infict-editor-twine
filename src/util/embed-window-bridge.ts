/**
 * Namespaced bridge for embed parent ↔ Twine. Legacy `window.currentStoryId`,
 * `window.apiEndpoint`, `window.apiAuthToken` remain for existing integrations.
 *
 * Neutral globals: `__twineEmbed`, `__twineDialogFormAdapter` (passage command editor adapter).
 * Legacy `__infict*` keys are still written for one-release compatibility (Controller / Snowcone format.js).
 */

/**
 * CodeMirror.Editor: back-link to TwineCodeMirrorAdapter for Snowcone
 * `dialogFormAdapterForEditor` (toolbar receives raw editor).
 * Keep in sync with `CM_PASSAGE_DIALOG_ADAPTER_KEY` in Snowcone `dialog-form-adapter-bridge.js`.
 */
export const CM_PASSAGE_DIALOG_ADAPTER_KEY = '__infictDialogFormAdapter' as const;

declare global {
	interface Window {
		__twineEmbed?: {
			currentStoryId?: string;
			apiEndpoint?: string;
			apiAuthToken?: string;
		};
		/** Legacy mirror of `__twineEmbed` (compatibility). */
		__infictTwine?: {
			currentStoryId?: string;
			apiEndpoint?: string;
			apiAuthToken?: string;
		};
		/** CodeMirror adapter for Snowcone passage command editor (dialog-forms). */
		__twineDialogFormAdapter?: unknown;
		__infictTwineDialogFormAdapter?: unknown;
		__TWINE_EMBED_REACT__?: unknown;
		__TWINE_EMBED_REACT_DOM__?: unknown;
		__INFICT_TWINE_REACT__?: unknown;
		__INFICT_TWINE_REACT_DOM__?: unknown;
		/** Snowcone `@infict/dialog-forms` module (passage command editor); primary key. */
		__twinePassageCommandForms?: unknown;
		__twineDialogForms?: unknown;
		__infictDialogForms?: unknown;
	}
}

/** Expose the passage command editor (Snowcone dialog-forms) adapter to `format.js` / embed. */
export function setPassageCommandFormAdapter(adapter: unknown | null): void {
	if (adapter == null) {
		delete window.__twineDialogFormAdapter;
		delete window.__infictTwineDialogFormAdapter;
	} else {
		window.__twineDialogFormAdapter = adapter;
		window.__infictTwineDialogFormAdapter = adapter;
	}
}

/** @deprecated Use `setPassageCommandFormAdapter`. */
export function setTwineDialogFormAdapter(adapter: unknown | null): void {
	setPassageCommandFormAdapter(adapter);
}

/** @deprecated Use `setPassageCommandFormAdapter`. */
export function setInfictTwineDialogFormAdapter(adapter: unknown | null): void {
	setPassageCommandFormAdapter(adapter);
}

export function syncTwineEmbedApiGlobals(partial: {
	currentStoryId?: string;
	apiEndpoint?: string;
	apiAuthToken?: string;
}): void {
	window.__twineEmbed = {
		...window.__twineEmbed,
		...partial
	};
	window.__infictTwine = {
		...window.__infictTwine,
		...partial
	};
	if (partial.currentStoryId !== undefined) {
		window.currentStoryId = partial.currentStoryId;
	}
	if (partial.apiEndpoint !== undefined) {
		(window as unknown as {apiEndpoint?: string}).apiEndpoint = partial.apiEndpoint;
	}
	if (partial.apiAuthToken !== undefined) {
		window.apiAuthToken = partial.apiAuthToken;
	}
}

/** @deprecated Use `syncTwineEmbedApiGlobals`. */
export function syncInfictTwineGlobals(partial: {
	currentStoryId?: string;
	apiEndpoint?: string;
	apiAuthToken?: string;
}): void {
	syncTwineEmbedApiGlobals(partial);
}
