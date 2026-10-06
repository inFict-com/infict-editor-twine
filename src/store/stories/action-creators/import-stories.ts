import {Thunk} from 'react-hook-thunk-reducer';
import {
	CreateStoryAction,
	StoriesState,
	Story,
	UpdateStoryAction
} from '../stories.types';
import {storyFileName} from '../../../electron/shared';
import {
	BUNDLED_EXTENDED_FORMAT,
	isForkExtendedBuild
} from '../../../config/fork-build-config';

/** Remap legacy Snowcone patch versions to the single format shipped in this build. */
function normalizeBundledExtendedStoryFormat<T extends {storyFormat?: string; storyFormatVersion?: string}>(
	story: T
): T {
	if (
		!isForkExtendedBuild() ||
		story.storyFormat !== BUNDLED_EXTENDED_FORMAT.name ||
		typeof story.storyFormatVersion !== 'string'
	) {
		return story;
	}
	if (story.storyFormatVersion === BUNDLED_EXTENDED_FORMAT.version) {
		return story;
	}
	return {
		...story,
		storyFormatVersion: BUNDLED_EXTENDED_FORMAT.version
	};
}

/**
 * Imports stories, overwriting any stories with the same name.
 */
export function importStories(
	toImport: Story[],
	existingStories: Story[]
): Thunk<StoriesState, CreateStoryAction | UpdateStoryAction> {
	toImport.forEach(importStory => {
		if (
			toImport.some(
				otherStory =>
					otherStory !== importStory &&
					storyFileName(otherStory) === storyFileName(importStory)
			)
		) {
			throw new Error(
				`Stories to import cannot have the same name: "${importStory.name}"`
			);
		}
	});

	return dispatch => {
		toImport.forEach(importStory => {
			const normalizedStory = normalizeBundledExtendedStoryFormat(importStory);
			if (normalizedStory !== importStory) {
				console.info(
					`[importStories] Normalized ${importStory.storyFormat} ${importStory.storyFormatVersion} → ${normalizedStory.storyFormatVersion} (bundled)`
				);
			}
			// Remove the temp ID that was assigned to the new story.

			const props: Partial<Story> = {...normalizedStory};

			delete props.id;

			const existingStory = existingStories.find(
				s => storyFileName(s) === storyFileName(importStory)
			);

			// Do an update so that if something goes awry, we won't have deleted the
			// story. We need to update passage props so that their parent story ID is
			// set properly.

			if (existingStory) {
				if (props.passages) {
					props.passages = props.passages.map(passage => ({
						...passage,
						story: existingStory.id
					}));
				}

				dispatch({props, type: 'updateStory', storyId: existingStory.id});
			} else {
				dispatch({props, type: 'createStory'});
			}
		});
	};
}
