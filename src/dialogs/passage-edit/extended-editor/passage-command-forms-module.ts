import {
	WINDOW_LEGACY_INFICT_DIALOG_FORMS,
	WINDOW_LEGACY_TWINE_DIALOG_FORMS,
	WINDOW_PASSAGE_COMMAND_FORMS_MODULE
} from '../../../config/snowcone-passage-command-editor';

export type PassageCommandFormsModule = typeof import('@twine-fork/dialog-forms');

/** @deprecated Use `PassageCommandFormsModule`. */
export type DialogFormsWindowModule = PassageCommandFormsModule;

function isPassageCommandFormsModule(
	value: unknown
): value is PassageCommandFormsModule {
	if (value === null || typeof value !== 'object') {
		return false;
	}
	return (
		typeof (value as {DialogFormFactory?: unknown}).DialogFormFactory !== 'undefined'
	);
}

function fromWindow(): PassageCommandFormsModule | undefined {
	if (typeof window === 'undefined') {
		return undefined;
	}
	const w = window as unknown as Record<string, unknown>;
	const candidate =
		w[WINDOW_PASSAGE_COMMAND_FORMS_MODULE] ??
		w[WINDOW_LEGACY_TWINE_DIALOG_FORMS] ??
		w[WINDOW_LEGACY_INFICT_DIALOG_FORMS];
	if (isPassageCommandFormsModule(candidate)) {
		return candidate;
	}
	return undefined;
}

/**
 * Snowcone passage-command-forms API: `window.__twinePassageCommandForms` (primary),
 * legacy `__twineDialogForms` / `__infictDialogForms`. Story-format `format.js` hydrate
 * sets these; Twine’s dev build may bundle `@twine-fork/dialog-forms` via Vite; Jest seeds
 * globals in `setupTests.ts`.
 */
export function getPassageCommandFormsModule(): PassageCommandFormsModule {
	const m = fromWindow();
	if (m) {
		return m;
	}
	throw new Error(
		'[Twine] Passage command editor: Snowcone dialog-forms module is not on window. ' +
			`Expected ${WINDOW_PASSAGE_COMMAND_FORMS_MODULE} or legacy ${WINDOW_LEGACY_TWINE_DIALOG_FORMS}. ` +
			'Load the extended story format hydrate bundle (or run tests with setupTests).'
	);
}

/** @deprecated Use `getPassageCommandFormsModule`. */
export function getDialogFormsModule(): PassageCommandFormsModule {
	return getPassageCommandFormsModule();
}

/** @deprecated Use `getPassageCommandFormsModule`. */
export function getInfictDialogForms(): PassageCommandFormsModule {
	return getPassageCommandFormsModule();
}
