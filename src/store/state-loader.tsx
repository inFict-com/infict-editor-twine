import * as React from 'react';
import {LoadingCurtain} from '../components/loading-curtain';
import {usePersistence} from './persistence/use-persistence';
import {usePrefsContext} from './prefs';
import {
	// exportStoryToRemoteTwee, // TODO: Incomplete feature - commented out
	// importStoryFromRemoteTwee, // TODO: Incomplete feature - commented out
	useStoriesContext
} from './stories';
import type {Story} from './stories';
import {useStoryFormatsContext} from './story-formats';
import {useStoriesRepair} from './use-stories-repair';
import {
	getHashSearchParams,
	getRemoteQueryKeys,
	readRemoteConnectionFromSearchParams,
	REMOTE_SESSION_STORAGE_KEY
} from '../config/remote-connection-config';

export const StateLoader: React.FC = ({children}) => {
	const [initing, setIniting] = React.useState(false);
	const [inited, setInited] = React.useState(false);
	const [prefsRepaired, setPrefsRepaired] = React.useState(false);
	const [formatsRepaired, setFormatsRepaired] = React.useState(false);
	const [storiesRepaired, setStoriesRepaired] = React.useState(false);
	const [remoteImportHandled, setRemoteImportHandled] = React.useState(false);
	const {dispatch: prefsDispatch, prefs: prefsState} = usePrefsContext();
	const {dispatch: storiesDispatch} = useStoriesContext();
	const {dispatch: formatsDispatch, formats: formatsState} =
		useStoryFormatsContext();
	const repairStories = useStoriesRepair();
	const {
		prefs,
		stories: storiesPersistence,
		storyFormats
	} = usePersistence();
	const initialStoriesRef = React.useRef<Story[]>([]);

	// Done in steps so that the repair action can see the inited state, and then
	// each repair action can see the results of the preceding ones.
	//
	// Repairs must go:
	// formats -> prefs (so it can repair bad format preferences) -> stories

	React.useEffect(() => {
		async function run() {
			if (!initing) {
				const formatsState = await storyFormats.load();
				const prefsState = await prefs.load();
				const storiesState = await storiesPersistence.load();

				formatsDispatch({type: 'init', state: formatsState});
				prefsDispatch({type: 'init', state: prefsState});
				storiesDispatch({type: 'init', state: storiesState});
				initialStoriesRef.current = storiesState;
				setInited(true);
			}
		}

		run();
		setIniting(true);
	}, [
		formatsDispatch,
		inited,
		initing,
		prefs,
		prefsDispatch,
		storiesPersistence,
		storiesDispatch,
		storyFormats
	]);

	React.useEffect(() => {
		if (inited && !formatsRepaired) {
			formatsDispatch({type: 'repair'});
			setFormatsRepaired(true);
		}
	}, [formatsDispatch, formatsRepaired, inited]);

	React.useEffect(() => {
		if (inited && formatsRepaired && !prefsRepaired) {
			prefsDispatch({type: 'repair', allFormats: formatsState});
			setPrefsRepaired(true);
		}
	}, [formatsRepaired, formatsState, inited, prefsDispatch, prefsRepaired]);

	React.useEffect(() => {
		if (inited && formatsRepaired && prefsRepaired && !storiesRepaired) {
			repairStories();
			setStoriesRepaired(true);
		}
	}, [
		formatsDispatch,
		formatsRepaired,
		formatsState,
		inited,
		prefsDispatch,
		prefsRepaired,
		prefsState.storyFormat.name,
		prefsState.storyFormat.version,
		repairStories,
		storiesPersistence,
		storiesDispatch,
		storiesRepaired
	]);

	React.useEffect(() => {
		if (
			inited &&
			formatsRepaired &&
			prefsRepaired &&
			storiesRepaired &&
			!remoteImportHandled
		) {
			setRemoteImportHandled(true);

			const params = new URLSearchParams(window.location.search);
			const queryKeys = getRemoteQueryKeys();
			const hashParams = getHashSearchParams();
			const {apiEndpoint, storyId, authToken, replaceExisting} =
				readRemoteConnectionFromSearchParams(params, queryKeys, {hashParams});
			(window as any).__twineRemoteExport = undefined;
			(window as any).__twineRemoteConfig = undefined;
			try {
				sessionStorage.removeItem(REMOTE_SESSION_STORAGE_KEY);
			} catch (storageError) {
				console.warn('Unable to clear remote config', storageError);
			}

			if (apiEndpoint && storyId) {
				(async () => {
					let cleanupQueryParams = false;
					let importedStory: Story | undefined;

					try {
						// TODO: Incomplete feature - importStoryFromRemoteTwee not implemented
						// importedStory = await (storiesDispatch(
						// 	importStoryFromRemoteTwee(storyId, {
						// 		url: apiEndpoint,
						// 		authToken
						// 	})
						// ) as unknown as Promise<Story>);

						if (importedStory) {
							// Story format is not forced; use config default for new stories
						}

						if (replaceExisting && importedStory) {
							storiesDispatch({type: 'init', state: [importedStory]});
							initialStoriesRef.current = [importedStory];
						}

						(window as typeof window & {
							__twineRemoteExport?: (storyId: string) => Promise<void>;
							__twineRemoteConfig?: {
								apiEndpoint: string;
								authToken?: string;
								remoteStoryId: string;
								localStoryId?: string;
							};
						}).__twineRemoteExport = async (localStoryId: string) => {
							if (!localStoryId) {
								return;
							}

							// TODO: Incomplete feature - exportStoryToRemoteTwee not implemented
							// await storiesDispatch(
							// 	exportStoryToRemoteTwee(localStoryId, {
							// 		url: apiEndpoint,
							// 		authToken
							// 	})
							// );
						};

						(window as any).__twineRemoteConfig = {
							apiEndpoint,
							authToken: authToken ?? undefined,
							remoteStoryId: storyId,
							localStoryId: importedStory?.id
						};

						try {
							sessionStorage.setItem(
								REMOTE_SESSION_STORAGE_KEY,
								JSON.stringify({
									apiEndpoint,
									authToken: authToken ?? undefined,
									remoteStoryId: storyId,
									localStoryId: importedStory?.id
								})
							);
						} catch (storageError) {
							console.warn('Unable to persist remote config', storageError);
						}

						cleanupQueryParams = true;
					} catch (error) {
						console.error('Failed to load remote story', error);
					} finally {
						if (cleanupQueryParams) {
							params.delete(queryKeys.apiBase);
							params.delete(queryKeys.storyId);
							params.delete(queryKeys.authToken);
							params.delete('enforceHttps');
							params.delete(queryKeys.replaceExisting);
							params.delete('storyName');
							params.delete('debug');
							params.delete('timestamp');
							params.delete('skipCache');
							params.delete('forceRefresh');
							params.delete('directEdit');

							const fullHash = window.location.hash.replace(/^#/, '');
							let nextHashSuffix = '';
							if (fullHash.startsWith('/')) {
								const q = fullHash.indexOf('?');
								const pathPart = q === -1 ? fullHash : fullHash.slice(0, q);
								const hp =
									q === -1
										? new URLSearchParams()
										: new URLSearchParams(fullHash.slice(q + 1));
								hp.delete(queryKeys.authToken);
								const qs = hp.toString();
								nextHashSuffix = qs ? `${pathPart}?${qs}` : pathPart;
							} else {
								const hp = new URLSearchParams(fullHash);
								hp.delete(queryKeys.authToken);
								nextHashSuffix = hp.toString();
							}
							const nextHash = nextHashSuffix ? `#${nextHashSuffix}` : '';

							const newQuery = params.toString();
							const nextUrl =
								window.location.origin +
								window.location.pathname +
								(newQuery ? `?${newQuery}` : '') +
								nextHash;
							window.history.replaceState({}, '', nextUrl);
						}
					}
				})();
			}
		}
	}, [
		formatsRepaired,
		inited,
		prefsRepaired,
		storiesDispatch,
		storiesRepaired,
		remoteImportHandled
	]);

	return inited && formatsRepaired && prefsRepaired && storiesRepaired ? (
		<>{children}</>
	) : (
		<LoadingCurtain />
	);
};
