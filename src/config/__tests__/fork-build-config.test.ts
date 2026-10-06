import {
	BUNDLED_EXTENDED_FORMAT,
	isForkExtendedBuild,
	UPSTREAM_DEFAULT_STORY_FORMAT
} from '../fork-build-config';

describe('isForkExtendedBuild', () => {
	const origFork = process.env.VITE_TWINE_FORK_EXTENDED;
	const origLegacy = process.env.VITE_INFICT_TWINE;

	afterEach(() => {
		if (origFork === undefined) delete process.env.VITE_TWINE_FORK_EXTENDED;
		else process.env.VITE_TWINE_FORK_EXTENDED = origFork;
		if (origLegacy === undefined) delete process.env.VITE_INFICT_TWINE;
		else process.env.VITE_INFICT_TWINE = origLegacy;
	});

	it('is true when both env vars are unset', () => {
		delete process.env.VITE_TWINE_FORK_EXTENDED;
		delete process.env.VITE_INFICT_TWINE;
		expect(isForkExtendedBuild()).toBe(true);
	});

	it('is false when VITE_TWINE_FORK_EXTENDED is the string false', () => {
		process.env.VITE_TWINE_FORK_EXTENDED = 'false';
		delete process.env.VITE_INFICT_TWINE;
		expect(isForkExtendedBuild()).toBe(false);
	});

	it('is false when legacy VITE_INFICT_TWINE is the string false', () => {
		delete process.env.VITE_TWINE_FORK_EXTENDED;
		process.env.VITE_INFICT_TWINE = 'false';
		expect(isForkExtendedBuild()).toBe(false);
	});
});

describe('default story format constants', () => {
	it('exports expected bundled extended and upstream ids', () => {
		expect(BUNDLED_EXTENDED_FORMAT).toEqual({
			name: 'Snowcone',
			version: '1.0.28'
		});
		expect(UPSTREAM_DEFAULT_STORY_FORMAT).toEqual({
			name: 'Harlowe',
			version: '3.3.9'
		});
	});
});
