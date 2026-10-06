import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogEditor} from '../../components/container/dialog-card';
import {CodeArea} from '../../components/control/code-area';
import {usePrefsContext} from '../../store/prefs';
import {useCodeMirrorPassageHints} from '../../store/use-codemirror-passage-hints';
import {useFormatCodeMirrorMode} from '../../store/use-format-codemirror-mode';
import {codeMirrorOptionsFromPrefs} from '../../util/codemirror-options';
import type {CodeMirrorChipManager, DialogFormsAPI} from '@twine-fork/dialog-forms';
import {getPassageCommandFormsModule} from './extended-editor/passage-command-forms-module';
import {TwineCodeMirrorAdapter} from './extended-editor/TwineCodeMirrorAdapter';
import {restoreJsonFromChips, type ChipMapping} from './extended-editor/chip-renderer';
import {
	isPassageCommandFormLockActive,
	isStoryformatDialogOpen,
	STORYFORMAT_CONTENT_CHANGED_EVENT,
	STORYFORMAT_TEXT_CLICKED_EVENT
} from './extended-editor/storyformat-bridge';
import {
	CM_PASSAGE_DIALOG_ADAPTER_KEY,
	setPassageCommandFormAdapter
} from '../../util/embed-window-bridge';
import {
	getHashSearchParams,
	getRemoteQueryKeys
} from '../../config/remote-connection-config';
import type {PassageTextProps} from './passage-text-types';
import './passage-text.css';

function embedAuthTokenFromUrl(urlParams: URLSearchParams): string | null {
	const {authToken: key} = getRemoteQueryKeys();
	return urlParams.get(key) || getHashSearchParams().get(key);
}

/** True when the editor string looks like compact chip placeholders, not embedded JSON. */
function passageLooksLikeChipPlaceholders(text: string): boolean {
	return (
		text.length > 0 &&
		!text.includes('"type"') &&
		/\[\w+(?:\.[\w.]*)?\]/.test(text)
	);
}

function passageHasEmbeddedStoryJson(text: string): boolean {
	return Boolean(text && text.includes('"type"') && text.includes('{'));
}

export const PassageTextExtended: React.FC<PassageTextProps> = props => {
	const {
		disabled,
		onChange,
		onEditorChange,
		passage,
		story,
		storyFormat,
		storyFormatExtensionsDisabled,
		viewMode: viewModeProp,
		onViewModeChange: onViewModeChangeProp
	} = props;

	const {
		DialogFormFactory,
		initialize: initializePassageCommandForms,
		parseJsonResponse,
		parseRequestFormat,
		StoryContextClient,
		getViewMode,
		saveViewMode,
		CodeMirrorChipManager
	} = getPassageCommandFormsModule();

	const [localText, setLocalText] = React.useState(passage.text);
	const {prefs} = usePrefsContext();
	const autocompletePassageNames = useCodeMirrorPassageHints(story);
	const mode =
		useFormatCodeMirrorMode(storyFormat.name, storyFormat.version) ?? 'text';
	const codeAreaContainerRef = React.useRef<HTMLDivElement>(null);
	const passageCommandFormsApiRef = React.useRef<DialogFormsAPI | null>(null);
	const passageCommandFormAdapterRef = React.useRef<TwineCodeMirrorAdapter | null>(null);
	const remoteSaveTimeoutRef = React.useRef<number>();
	const [passageCommandFormsReady, setPassageCommandFormsReady] = React.useState(false);
	const {t} = useTranslation();
	
	// Chip rendering state
	const [chipMappings, setChipMappings] = React.useState<ChipMapping[]>([]);
	const [rawContent, setRawContent] = React.useState(passage.text); // Store original content with JSON
	const rawContentRef = React.useRef<string>(passage.text); // Ref to access rawContent in closures
	const chipMappingsRef = React.useRef<ChipMapping[]>([]);
	const actualEditorRef = React.useRef<CodeMirror.Editor | null>(null);
	const chipManagerRef = React.useRef<CodeMirrorChipManager | null>(null);
	const onChangeText = React.useRef<string>();
	const onChangeTimeout = React.useRef<number>();
	const isApplyingViewModeChange = React.useRef(false);
	const isInitialMount = React.useRef(true);

	// View mode state management
	const editorId = React.useMemo(
		() => `passage-edit-${passage.id}`,
		[passage.id]
	);
	const [internalViewMode, setInternalViewMode] = React.useState<'chip' | 'raw'>('chip');
	const viewMode = viewModeProp ?? internalViewMode;
	const onViewModeChange = onViewModeChangeProp ?? setInternalViewMode;
	const viewModeRef = React.useRef<'chip' | 'raw'>(viewMode);
	const hasInitializedViewModeRef = React.useRef(false);
	
	// Keep viewModeRef in sync
	React.useEffect(() => {
		viewModeRef.current = viewMode;
	}, [viewMode]);

	// Story config / NPC lists (must be declared before adapter _dialogFormContext effect)
	const twineStoryContextClient = React.useMemo(() => {
		return new StoryContextClient({
			configLoader: {
				async getStoryConfig(storyId: string) {
					console.log('[Twine StoryContextClient] getStoryConfig called with storyId:', storyId);

					const urlParams = new URLSearchParams(window.location.search);
					const win = window as any;
					const apiEndpoint =
						urlParams.get('apiEndpoint') ||
						win.apiEndpoint ||
						win.__twineEmbed?.apiEndpoint ||
						win.__infictTwine?.apiEndpoint;

					const controllerStoryId = win.currentStoryId || win.__twineEmbed?.currentStoryId || storyId;
					console.log('[Twine StoryContextClient] Using storyId:', controllerStoryId, 'apiEndpoint:', apiEndpoint);

					if (apiEndpoint && controllerStoryId) {
						try {
							const authToken =
								embedAuthTokenFromUrl(urlParams) ||
								win.apiAuthToken ||
								win.__twineEmbed?.apiAuthToken ||
								win.__infictTwine?.apiAuthToken;

							if (!authToken) {
								console.warn('[Twine StoryContextClient] No auth token available - skipping API config fetch');
							} else {
								const headers = new Headers();
								headers.set('Authorization', `Bearer ${authToken}`);

								const baseUrl = apiEndpoint.replace(/\/api\/twine$/, '');
								const configUrl = `${baseUrl}/api/stories/${controllerStoryId}/config`;

								const response = await fetch(configUrl, {
									headers,
									mode: 'cors'
								});

								if (response.ok) {
									const config = await response.json();
									return config;
								} else {
									console.warn(`[Twine StoryContextClient] Config fetch failed with status ${response.status}`);
								}
							}
						} catch (error) {
							console.warn('[Twine StoryContextClient] Failed to fetch config from API:', error);
						}
					}

					// Local fallbacks: storyId may be Twine id or Controller UUID (embedded)
					const winSid = (window as any).currentStoryId;
					const isConfigForThisStory =
						storyId === story.id ||
						(typeof winSid === 'string' && storyId === winSid);
					if (isConfigForThisStory) {
						const configPassage = story.passages.find(
							p =>
								p.name === 'StoryConfig' ||
								p.name === 'Config' ||
								p.tags.includes('config')
						);

						if (configPassage) {
							try {
								const config = JSON.parse(configPassage.text);
								return config;
							} catch (e) {
								console.warn('[Twine StoryContextClient] Failed to parse config passage:', e);
							}
						}

						if (story.script) {
							try {
								const configMatch = story.script.match(/config\s*=\s*({[\s\S]*?});/);
								if (configMatch) {
									const src = configMatch[1];
									try {
										return JSON.parse(src) as Record<string, unknown>;
									} catch {
										// Story script may use a JS object literal (not strict JSON); avoid `eval` for bundlers.
										return new Function(`return (${src})`)() as Record<
											string,
											unknown
										>;
									}
								}
							} catch (e) {
								console.warn('[Twine StoryContextClient] Failed to parse config from script:', e);
							}
						}

						return null;
					}
					return null;
				}
			}
		});
	}, [story]);

	// Update adapter context whenever story or passage changes (toolbar commands merge this in DialogFormFactory)
	React.useEffect(() => {
		let cancelled = false;

		const run = async () => {
			console.log('[PassageText] useEffect to update adapter context:', {
				hasAdapter: !!passageCommandFormAdapterRef.current,
				hasStory: !!story,
				hasPassage: !!passage,
				storyId: story?.id,
				storyName: story?.name,
				passagesLength: story?.passages?.length,
				firstFewPassages: story?.passages?.slice(0, 3).map(p => p.name)
			});
			if (!passageCommandFormAdapterRef.current || !story || !passage) return;

			const urlParams = new URLSearchParams(window.location.search);
			const win = window as any;
			const authToken =
				embedAuthTokenFromUrl(urlParams) ||
				win.apiAuthToken ||
				win.__twineEmbed?.apiAuthToken ||
				win.__infictTwine?.apiAuthToken;
			const apiEndpoint =
				urlParams.get('apiEndpoint') ||
				win.apiEndpoint ||
				win.__twineEmbed?.apiEndpoint ||
				win.__infictTwine?.apiEndpoint;
			const apiBase = (apiEndpoint || '').replace(/\/api\/twine$/, '');
			let isAdmin = false;
			if (authToken && apiBase) {
				try {
					const res = await fetch(`${apiBase}/api/auth/me`, {
						headers: {Authorization: `Bearer ${authToken}`},
						mode: 'cors'
					});
					if (res.ok) {
						const me = await res.json();
						isAdmin = Boolean(me?.isAdmin);
					}
				} catch (e) {
					console.warn('[PassageText] /api/auth/me failed, admin UI disabled:', e);
				}
			}

			if (cancelled) return;

			const controllerStoryId = win.currentStoryId || story.id;
			const contextToSet = {
				storyId: controllerStoryId,
				storyName: story.name,
				passageId: passage.id,
				passageName: passage.name,
				storyContextClient: twineStoryContextClient,
				passages: story.passages ? story.passages.map(p => p.name) : [],
				isAdmin
			};
			console.log('[PassageText] Setting adapter._dialogFormContext:', contextToSet);
			(passageCommandFormAdapterRef.current as any)._dialogFormContext = contextToSet;
			console.log(
				'[PassageText] Adapter context set, verifying:',
				(passageCommandFormAdapterRef.current as any)._dialogFormContext
			);
		};

		void run();
		return () => {
			cancelled = true;
		};
	}, [story, passage, twineStoryContextClient]);

	// Load view mode from localStorage on mount
	React.useEffect(() => {
		const savedMode = getViewMode(editorId, 'chip') as 'chip' | 'raw';
		console.log('[Twine] Loading view mode from localStorage:', savedMode, 'for editorId:', editorId, 'current viewMode:', viewMode);
		if (savedMode !== viewMode) {
			console.log('[Twine] Updating view mode from', viewMode, 'to', savedMode);
			onViewModeChange(savedMode);
		}
	}, [editorId]); // Only run on mount
	
	// Save view mode when it changes
	React.useEffect(() => {
		saveViewMode(editorId, viewMode);
	}, [editorId, viewMode]);

	// Chip click handler for CodeMirrorChipManager
	const handleChipClick = React.useCallback((chipData: any, originalJson: string, position?: { from: CodeMirror.Position; to: CodeMirror.Position }) => {
		try {
			// Callback chipData/originalJson can be stale after edits; prefer mapping at doc position.
			let actualChipData = chipData;
			let actualOriginalJson = originalJson;
			let actualPosition = position;
			
			// Resolve from chip manager at the click/cursor range (marker position may lag)
			if (position && position.from && chipManagerRef.current && actualEditorRef.current) {
				console.log('[Twine] Attempting position-based lookup:', {
					hasPosition: !!position,
					hasFrom: !!position.from,
					hasChipManager: !!chipManagerRef.current,
					hasEditor: !!actualEditorRef.current,
					positionFrom: position.from
				});
				
				// Try the passed position first
				let chipAtPosition = chipManagerRef.current.getChipMappingAtPosition(position.from);
				
				// If not found, try the current cursor position (in case the chip moved)
				if (!chipAtPosition) {
					const currentCursor = actualEditorRef.current.getDoc().getCursor();
					console.log('[Twine] Position-based lookup failed, trying cursor position:', currentCursor);
					chipAtPosition = chipManagerRef.current.getChipMappingAtPosition(currentCursor);
				}
				
				console.log('[Twine] Position-based lookup result:', {
					found: !!chipAtPosition,
					hasMapping: !!chipAtPosition?.mapping
				});
				
				if (chipAtPosition && chipAtPosition.mapping) {
					// Use the chip data from the position-based lookup (this is the correct one)
					actualChipData = chipAtPosition.mapping.chipData;
					actualOriginalJson = chipAtPosition.mapping.originalJson;
					actualPosition = {
						from: chipAtPosition.position.from,
						to: chipAtPosition.position.to
					};
					console.log('[Twine] Using position-based lookup for chip data:', {
						type: actualChipData?.type,
						command: actualChipData?.command,
						position: actualPosition
					});
				} else {
					console.log('[Twine] Position-based lookup did not find chip, using provided data');
				}
			}
			
			console.log('[Twine] Chip clicked:', {
				hasPosition: !!actualPosition,
				position: actualPosition,
				jsonPreview: actualOriginalJson?.substring(0, 80)
			});
			
	const formData = JSON.parse(actualOriginalJson);
	const controllerStoryId = (window as any).currentStoryId || story.id;
	const context = {
		storyId: controllerStoryId,
		storyName: story.name,
		passageId: passage.id,
		passageName: passage.name,
		storyContextClient: twineStoryContextClient,
		passages: story.passages.map(p => p.name)
	};
			
			// Determine if it's a request or response
			const isRequest = parseRequestFormat(actualOriginalJson)?.type;
			const formType = isRequest ? 'request' : 'response';
			const formSubtype = (formData.type || '').toLowerCase();
			
			if (formType && formSubtype && passageCommandFormAdapterRef.current) {
				const form = DialogFormFactory.createForm(
					formType as 'request' | 'response',
					formSubtype,
					passageCommandFormAdapterRef.current,
					{context}
				);
				
				// If we have a position, pass it as existingJson so the form replaces instead of inserts
				const dialogOptions: any = {
					title: isRequest 
						? t('dialogs.passageEdit.passageCommandEditor.editRequest', {
								defaultValue: `Edit ${formData.type} Request`,
								requestType: formData.type
							})
						: t('dialogs.passageEdit.passageCommandEditor.editResponse', {
								defaultValue: `Edit ${formData.type}`,
								responseType: formData.type
							}),
					formData: formData
				};
				
				// Pass position if available (for replacing existing JSON)
				// Format: { from, to, json } - DialogFormBase expects this structure
				if (actualPosition) {
					dialogOptions.existingJson = {
						from: actualPosition.from,
						to: actualPosition.to,
						json: actualOriginalJson
					};
				}
				
				form.showDialog(dialogOptions);
			}
		} catch (e) {
			console.error('[Twine] Failed to handle chip click:', e);
		}
	}, [story, passage, twineStoryContextClient, t]);

	// Effects to handle debouncing updates upward. The idea here is that the
	// component maintains a local state so that the CodeMirror instance always is
	// up-to-date with what the user has typed, but the global context may not be.
	// This is because updating global context causes re-rendering in the story
	// map, which can be time-intensive.

	// Only reset chip state when switching passages — same as upstream TwineJS + Snowcone
	// (see dev branch passage-text). Syncing on every passage.text/localText change clears
	// chip mappings while the editor still shows chip placeholders, which corrupts saves
	// (placeholders persisted) and drops leading prose typed before JSON blocks.
	React.useEffect(() => {
		setLocalText(passage.text);
		setRawContent(passage.text);
		rawContentRef.current = passage.text;

		setChipMappings([]);
		chipMappingsRef.current = [];
		chipManagerRef.current?.clearMarkers();
	}, [passage.id]);

	const scheduleRemoteSave = React.useCallback(() => {
		if (remoteSaveTimeoutRef.current) {
			window.clearTimeout(remoteSaveTimeoutRef.current);
		}

		remoteSaveTimeoutRef.current = window.setTimeout(() => {
			const remoteExport = (window as typeof window & {
				__twineRemoteExport?: (storyId: string) => Promise<void>;
			}).__twineRemoteExport;

			if (typeof remoteExport === 'function') {
				void remoteExport(passage.story).catch(error => {
					console.error('Twine auto-save failed', error);
				});
			}
		}, 2000);
	}, [passage.story]);

	const handleLocalChangeText = React.useCallback(
		(text: string) => {
			// Skip state updates if we're applying a view mode change
			// This prevents the onChange from triggering a re-render that would
			// clear the markers we just applied
			if (isApplyingViewModeChange.current) {
				console.log('[Twine] handleLocalChangeText: Skipping during view mode change');
				return;
			}
			
			// Set local state because the CodeMirror instance is controlled, and
			// updates there should be immediate.

			setLocalText(text);

			// Chip view: persist restored JSON, not placeholder tokens
			let textToSave = text;
			if (viewModeRef.current === 'chip' && chipMappingsRef.current.length > 0) {
				textToSave = restoreJsonFromChips(text, chipMappingsRef.current);
				setRawContent(textToSave);
				rawContentRef.current = textToSave;
				console.log('[Twine] handleLocalChangeText: Converted chip view to raw code for save', {
					originalLength: text.length,
					convertedLength: textToSave.length,
					mappingsCount: chipMappingsRef.current.length
				});
			} else if (viewModeRef.current === 'chip' && chipMappingsRef.current.length === 0) {
				// Chip view but no mappings: e.g. props sync cleared mappings, passage file already had
				// placeholder text so initial convert skipped, or race before applyMarkers. Saving `text`
				// would persist [Type.command] tokens and destroy JSON — use last known JSON if we have it.
				if (
					passageLooksLikeChipPlaceholders(text) &&
					passageHasEmbeddedStoryJson(rawContentRef.current)
				) {
					textToSave = rawContentRef.current;
					console.warn(
						'[Twine] Chip view without chip mappings; saving rawContentRef JSON instead of placeholder text'
					);
				} else if (passageHasEmbeddedStoryJson(text)) {
					setRawContent(text);
					rawContentRef.current = text;
					textToSave = text;
				}
			} else if (viewModeRef.current === 'raw') {
				// In raw view, the text is already raw code. Do NOT overwrite rawContent with
				// placeholder text (e.g. if a stale timeout just set the editor to chips);
				// otherwise toggling back to chip would convert placeholders and break chip display.
				// Compact placeholders are [Type] or [Type.command] per ChipRenderer (e.g. [SMS], [Image.saveAllLastMMS]).
				if (!passageLooksLikeChipPlaceholders(text)) {
					setRawContent(text);
					rawContentRef.current = text;
				}
			}

			// If there was a pending update, cancel it.

			if (onChangeTimeout.current) {
				window.clearTimeout(onChangeTimeout.current);
			}

			// Save the text value (raw code, not placeholders) in case we need to reset the timeout in the next
			// effect.

			onChangeText.current = textToSave;

			// Queue a call to onChange.

			onChangeTimeout.current = window.setTimeout(() => {
				// Important to reset this ref so that we don't try to cancel fired
				// timeouts above.

				onChangeTimeout.current = undefined;

				// Finally call the onChange prop with raw code (not placeholders).

				onChange(onChangeText.current!);
			}, 1000);

			scheduleRemoteSave();
		},
		[onChange, onEditorChange, scheduleRemoteSave]
	);

	// If the onChange prop changes while an onChange call is pending, reset the
	// timeout and point it to the correct callback.

	React.useEffect(() => {
		if (onChangeTimeout.current) {
			window.clearTimeout(onChangeTimeout.current);
			onChangeTimeout.current = window.setTimeout(() => {
				// This body must be the same as in the timeout in the previous effect.

				onChangeTimeout.current = undefined;
				onChange(onChangeText.current!);
			}, 1000);
		}
	}, [onChange]);

	const handleMount = React.useCallback(
		(editor: CodeMirror.Editor) => {
			console.log('[Twine] CodeMirror editor mounted for dialog forms');
			actualEditorRef.current = editor;
			onEditorChange(editor);
			if (!passageCommandFormsApiRef.current) {
				// Create chip manager
				chipManagerRef.current = new CodeMirrorChipManager(editor, {
					onChipClick: handleChipClick
				});
				
				const adapter = new TwineCodeMirrorAdapter(editor, handleLocalChangeText);
				passageCommandFormAdapterRef.current = adapter;
				
				// Override adapter methods to handle chip view
				const originalInsertText = adapter.insertText.bind(adapter);
				const originalReplaceText = adapter.replaceText.bind(adapter);
				
				adapter.insertText = function(text: string, position?: CodeMirror.Position) {
					if (viewModeRef.current === 'chip' && chipManagerRef.current) {
						try {
							const currentText = adapter.getText() || '';
							const pos = position || editor.getDoc().getCursor();
							
							// Calculate insertion index
							const lines = currentText.split('\n');
							let charIndex = 0;
							for (let i = 0; i < pos.line && i < lines.length; i++) {
								charIndex += lines[i].length + 1;
							}
							charIndex += pos.ch;
							
							// Restore JSON from placeholders
							const currentMappings = chipMappingsRef.current;
							const textToInsertInto = currentMappings.length > 0 
								? restoreJsonFromChips(currentText, currentMappings)
								: currentText;
							
							// Calculate offset from placeholder expansions
							let offset = 0;
							for (const mapping of currentMappings) {
								const pIndex = currentText.indexOf(mapping.placeholder);
								if (pIndex !== -1 && pIndex + mapping.placeholder.length <= charIndex) {
									offset += mapping.originalJson.length - mapping.placeholder.length;
								}
							}
							const restoredInsertIndex = charIndex + offset;
							
							// Insert into restored text
							const newRawValue = textToInsertInto.substring(0, restoredInsertIndex) + 
											   text + 
											   textToInsertInto.substring(restoredInsertIndex);
							
							// Convert back to chips using chip manager
							if (newRawValue.length <= 100000) {
								const {processedText, mappings} = chipManagerRef.current.convertToChips(newRawValue);
								
								chipMappingsRef.current = mappings;
								setChipMappings(mappings);
								setRawContent(newRawValue);
								rawContentRef.current = newRawValue;
								setLocalText(processedText);
								
								// Calculate new cursor position after insertion
								// We need to find where the inserted text ends up in processedText
								const insertedLength = text.length;
								const newCursorIndex = restoredInsertIndex + insertedLength;
								
								// Convert index back to CodeMirror position in processed text
								// Account for placeholder conversions
								let adjustedIndex = newCursorIndex;
								for (const mapping of mappings) {
									const jsonIndex = newRawValue.indexOf(mapping.originalJson);
									if (jsonIndex !== -1 && jsonIndex < newCursorIndex) {
										// Adjust for this placeholder
										adjustedIndex -= (mapping.originalJson.length - mapping.placeholder.length);
									}
								}
								
								// Convert adjusted index to line/ch
								const textUpToCursor = processedText.substring(0, Math.min(adjustedIndex, processedText.length));
								const cursorLines = textUpToCursor.split('\n');
								const newCursorPos = {
									line: cursorLines.length - 1,
									ch: cursorLines[cursorLines.length - 1].length
								};
								
								// Update editor with new content and cursor position
								const doc = editor.getDoc();
								
								const applyChips = () => {
									// 1. Set text first
									doc.setValue(processedText);
									
									// 2. Apply markers (changes DOM)
									if (chipManagerRef.current) {
										chipManagerRef.current.applyMarkers(processedText, mappings);
									}
									
									// 3. THEN set cursor (after markers are in place)
									try {
										doc.setCursor(newCursorPos);
									} catch (e) {
										console.warn('[Twine] insertText: Could not set cursor position', e);
									}
								};
								
								if (typeof editor.operation === 'function') {
									editor.operation(applyChips);
								} else {
									applyChips();
								}
								
								return { from: newCursorPos, to: newCursorPos };
							}
						} catch (e) {
							console.error('[Twine] Error in insertText override:', e);
						}
					}
					return originalInsertText(text, position);
				};
				
				adapter.replaceText = function(text: string, from?: CodeMirror.Position, to?: CodeMirror.Position) {
					if (viewModeRef.current === 'chip' && chipManagerRef.current && from && to) {
						try {
							const currentText = adapter.getText() || '';
							
							// Use position-based matching to find the exact chip at the position
							let placeholderToReplace: ChipMapping | null = null;
							if (chipManagerRef.current) {
								const chipAtPosition = chipManagerRef.current.getChipMappingAtPosition(from);
								if (chipAtPosition) {
									placeholderToReplace = chipAtPosition.mapping;
									console.log('[Twine] Found chip at position for replacement:', placeholderToReplace.chipData.type, placeholderToReplace.chipData.command);
								}
							}
							
							// Restore JSON from placeholders
							const currentMappings = chipMappingsRef.current;
							let textToReplaceIn = currentMappings.length > 0
								? restoreJsonFromChips(currentText, currentMappings)
								: currentText;
							
							// Replace JSON in restored text using position-based approach
							if (placeholderToReplace && placeholderToReplace.originalJson) {
								// Calculate index for the chip start position in chip text
								const lines = currentText.split('\n');
								let chipFromIndex = 0;
								for (let i = 0; i < from.line && i < lines.length; i++) {
									chipFromIndex += lines[i].length + 1;
								}
								chipFromIndex += from.ch;
								
								// Get text before the chip to calculate raw position
								const beforeText = currentText.substring(0, chipFromIndex);
								
								// Restore before text to get exact raw start position
								const restoredBefore = restoreJsonFromChips(beforeText, currentMappings);
								const rawStartPos = restoredBefore.length;
								
								// Replace at exact position to avoid issues with duplicate JSON
								const oldJson = placeholderToReplace.originalJson;
								const rawEndPos = rawStartPos + oldJson.length;
								
								// Verify the JSON at this position matches (safety check)
								const jsonAtPosition = textToReplaceIn.substring(rawStartPos, rawEndPos);
								if (jsonAtPosition === oldJson) {
									// Exact match - replace at exact position
									textToReplaceIn = textToReplaceIn.substring(0, rawStartPos) + 
													 text + 
													 textToReplaceIn.substring(rawEndPos);
									console.log('[Twine] Replaced JSON using exact position-based method');
								} else {
									// Fallback: use indexOf but log warning
									console.warn('[Twine] JSON at position does not match, using indexOf fallback (may have issues with duplicates)');
									const jsonIndex = textToReplaceIn.indexOf(oldJson);
									if (jsonIndex !== -1) {
										textToReplaceIn = textToReplaceIn.substring(0, jsonIndex) + 
														 text + 
														 textToReplaceIn.substring(jsonIndex + oldJson.length);
									} else {
										// Last resort: replace at position
										const lines = textToReplaceIn.split('\n');
										const fromLine = lines[from.line] || '';
										const toLine = lines[to.line] || '';
										lines[from.line] = fromLine.substring(0, from.ch) + text + toLine.substring(to.ch);
										if (from.line !== to.line) {
											lines.splice(from.line + 1, to.line - from.line);
										}
										textToReplaceIn = lines.join('\n');
									}
								}
							} else {
								// No placeholder in range, replace at position
								const lines = textToReplaceIn.split('\n');
								const fromLine = lines[from.line] || '';
								const toLine = lines[to.line] || '';
								lines[from.line] = fromLine.substring(0, from.ch) + text + toLine.substring(to.ch);
								if (from.line !== to.line) {
									lines.splice(from.line + 1, to.line - from.line);
								}
								textToReplaceIn = lines.join('\n');
							}
							
							// Convert back to chips using chip manager
							if (textToReplaceIn.length <= 100000) {
								// Clear existing markers before reconverting to avoid duplicates
								if (chipManagerRef.current) {
									chipManagerRef.current.clearMarkers();
								}
								
								const {processedText, mappings} = chipManagerRef.current.convertToChips(textToReplaceIn);
								
								chipMappingsRef.current = mappings;
								setChipMappings(mappings);
								setRawContent(textToReplaceIn);
								rawContentRef.current = textToReplaceIn;
								setLocalText(processedText);
								
								// Update editor first, then apply markers
								const doc = editor.getDoc();
								
								const applyChips = () => {
									doc.setValue(processedText);
									if (chipManagerRef.current) {
										chipManagerRef.current.applyMarkers(processedText, mappings);
									}
								};
								
								if (typeof editor.operation === 'function') {
									editor.operation(applyChips);
								} else {
									applyChips();
								}
								
								return { from, to };
							}
						} catch (e) {
							console.error('[Twine] Error in replaceText override:', e);
						}
					} else if (viewModeRef.current === 'raw') {
						// Raw view mode - just replace the text directly
						const result = originalReplaceText(text, from, to);
						
						// Ensure onChange is called
						setTimeout(() => {
							try {
								const currentText = adapter.getText() || '';
								setRawContent(currentText);
								onChangeText.current = currentText;
								if (onChangeTimeout.current) {
									window.clearTimeout(onChangeTimeout.current);
									onChangeTimeout.current = undefined;
								}
								onChange(currentText);
							} catch (e) {
								console.error('[Twine] replaceText: Error in raw view onChange callback', e);
							}
						}, 100);
						
						return result;
					}
					return originalReplaceText(text, from, to);
				};
				
				// Initialize dialog forms without context here; context will be
				// provided on each selector / edit call so forms can see story/passage.
				// Enable scanning so raw JSON blocks are clickable
				passageCommandFormsApiRef.current = initializePassageCommandForms({
					editorAdapter: adapter,
					enableScanning: true
				});
				setPassageCommandFormAdapter(adapter);
				setPassageCommandFormsReady(true);
			}

			const adaptor = passageCommandFormAdapterRef.current;
			if (adaptor) {
				(editor as CodeMirror.Editor & Record<string, unknown>)[
					CM_PASSAGE_DIALOG_ADAPTER_KEY
				] = adaptor;
			}

			// Initialize raw content
			const initialValue = editor.getValue();
			setRawContent(initialValue);
			rawContentRef.current = initialValue;
			
			// Context will be set by the useEffect hook when adapter is ready
			
			// Note: We do NOT add an automatic change handler here
			// Chips are only converted at these times:
			// 1. Initial mount (see below)
			// 2. View mode switch to 'chip' (handled in view mode effect)
			// 3. When Dialog Forms inserts/replaces JSON (handled in adapter overrides)
			// This prevents cursor jumping and typing interference
			
			// If in chip view, convert to chips after editor is ready.
			// Use viewModeRef.current (not closure viewMode) so we respect localStorage-restored
			// view mode: if user had Raw View and reopens passage, we must not convert to chips.
			setTimeout(() => {
				const currentViewMode = viewModeRef.current;
				if (currentViewMode !== 'chip') {
					console.log('[Twine] Skipping initial chip conversion: view mode is', currentViewMode);
				}
				if (currentViewMode === 'chip' && chipManagerRef.current) {
					const currentValue = editor.getValue();
					const valueToCheck = initialValue || currentValue;
					
					console.log('[Twine] Initial chip conversion check:', {
						viewModeRef: currentViewMode,
						hasChipManager: !!chipManagerRef.current,
						initialValueLength: initialValue?.length || 0,
						currentValueLength: currentValue?.length || 0,
						valueToCheckLength: valueToCheck?.length || 0,
						hasJson: valueToCheck?.includes('"type"') && valueToCheck?.includes('{')
					});
					
					if (valueToCheck && valueToCheck.length > 0 && valueToCheck.length <= 100000) {
						const hasJson = valueToCheck.includes('"type"') && valueToCheck.includes('{');
						if (hasJson) {
							console.log('[Twine] Converting initial content to chips');
							try {
								const {processedText, mappings} = chipManagerRef.current.convertToChips(valueToCheck);
								console.log('[Twine] Initial conversion result:', {
									processedTextLength: processedText.length,
									mappingsCount: mappings.length,
									processedText: processedText.substring(0, 100)
								});
								
								chipMappingsRef.current = mappings;
								setChipMappings(mappings);
								setRawContent(valueToCheck);
								setLocalText(processedText);
								const doc = editor.getDoc();
								
								const applyChips = () => {
									doc.setValue(processedText);
									console.log('[Twine] Applying initial markers');
									if (chipManagerRef.current) {
										chipManagerRef.current.applyMarkers(processedText, mappings);
										console.log('[Twine] Initial markers applied');
									}
								};
								
								if (typeof editor.operation === 'function') {
									editor.operation(applyChips);
								} else {
									applyChips();
								}
							} catch (e) {
								console.error('[Twine] Error in initial chip conversion:', e);
							}
						}
					}
				}
			}, 300);

			// The potential combination of loading a mode and the dialog entrance
			// animation seems to mess up CodeMirror's cursor rendering. The delay below
			// is intended to run after the animation completes.

		window.setTimeout(() => {
			// Refresh must precede focus: the dialog entrance animation (200ms CSS
			// transition on .dialog-transform-setter) and chip widget insertion both
			// alter layout after CodeMirror first renders, leaving its internal
			// coordinate map stale.  Without refresh() clicks land on the wrong line.
			editor.refresh();
			editor.focus();
		}, 400);
		},
		[onEditorChange, handleLocalChangeText, viewMode, handleChipClick]
	);

	// Emulate the above behavior re: focus if we aren't using CodeMirror.

	React.useEffect(() => {
		if (!prefs.useCodeMirror && codeAreaContainerRef.current) {
			const area = codeAreaContainerRef.current.querySelector('textarea');

			if (!area) {
				return;
			}

			area.focus();
			area.setSelectionRange(area.value.length, area.value.length);
		}
	}, []);

	React.useEffect(
		() => () => {
			if (remoteSaveTimeoutRef.current) {
				window.clearTimeout(remoteSaveTimeoutRef.current);
			}
			if (onChangeTimeout.current) {
				window.clearTimeout(onChangeTimeout.current);
				onChangeTimeout.current = undefined;
				if (onChangeText.current !== undefined) {
					onChange(onChangeText.current);
				}
			}
		},
		[onChange]
	);
	
	// Sync chipMappingsRef with chipMappings state
	React.useEffect(() => {
		chipMappingsRef.current = chipMappings;
	}, [chipMappings]);
	
	// Sync rawContentRef with rawContent state
	React.useEffect(() => {
		rawContentRef.current = rawContent;
	}, [rawContent]);
	
	// View mode switching effect
	React.useEffect(() => {
		if (!actualEditorRef.current || !chipManagerRef.current) {
			console.log('[Twine] View mode effect skipped:', {
				hasEditor: !!actualEditorRef.current,
				hasChipManager: !!chipManagerRef.current
			});
			return;
		}
		
		// Skip only the very first time this effect runs (handleMount will handle initial conversion)
		// After that, always process view mode changes
		if (!hasInitializedViewModeRef.current) {
			console.log('[Twine] Skipping viewMode effect on initial mount - handleMount will apply markers');
			hasInitializedViewModeRef.current = true;
			return;
		}
		
		console.log('[Twine] View mode effect triggered:', {viewMode});
		
		const editor = actualEditorRef.current;
		const doc = editor.getDoc();
		
		if (viewMode === 'chip') {
			// Switch to chip view
			// Use rawContentRef.current instead of rawContent state
			const textToConvert = rawContentRef.current;
			
			console.log('[Twine] Converting to chip view:', {
				textToConvertLength: textToConvert?.length || 0,
				hasJson: textToConvert?.includes('"type"')
			});
			
			if (textToConvert && textToConvert.includes('"type"') && textToConvert.length <= 100000) {
				try {
					const {processedText, mappings} = chipManagerRef.current.convertToChips(textToConvert);
					console.log('[Twine] View mode conversion result:', {
						mappingsCount: mappings.length,
						processedTextLength: processedText.length,
						processedTextPreview: processedText.substring(0, 100)
					});
					
				chipMappingsRef.current = mappings;
				setChipMappings(mappings);
				
				const applyChips = () => {
						console.log('[Twine] applyChips running:', {
							hasChipManager: !!chipManagerRef.current,
							hasEditor: !!editor,
							hasOperation: typeof editor.operation === 'function',
							processedTextLength: processedText.length,
							mappingsCount: mappings.length
						});
						doc.setValue(processedText);
						if (chipManagerRef.current) {
							console.log('[Twine] About to call applyMarkers');
							chipManagerRef.current.applyMarkers(processedText, mappings);
							console.log('[Twine] applyMarkers completed');
						} else {
							console.error('[Twine] chipManagerRef.current is null!');
						}
					};
					
				console.log('[Twine] About to call applyChips via editor.operation');
				isApplyingViewModeChange.current = true;
				
				// Set up a one-time 'update' handler to re-apply markers after setValue clears them
				const handleUpdate = () => {
					console.log('[Twine] Editor updated, checking markers');
					const currentMarks = editor.getAllMarks();
					const chipMarks = currentMarks.filter(m => {
						const widget = (m as any).replacedWith;
						return widget && widget.className && widget.className.includes('cm-chip-widget');
					});
					
					console.log('[Twine] Current chip markers:', chipMarks.length, 'Expected:', mappings.length);
					
					// If markers were cleared, re-apply them
					if (chipMarks.length === 0 && mappings.length > 0) {
						console.log('[Twine] Markers were cleared, re-applying...');
						if (chipManagerRef.current) {
							chipManagerRef.current.applyMarkers(processedText, mappings);
						}
					}
					
					editor.off('update', handleUpdate);
				};
				
				if (typeof editor.operation === 'function') {
					editor.operation(applyChips);
				} else {
					applyChips();
				}
				
				// Update localText to keep React state in sync
				setLocalText(processedText);
				if (isInitialMount.current) {
					isInitialMount.current = false;
				}
				
				// Listen for the next update event to catch when setValue clears markers
				editor.on('update', handleUpdate);
				
				isApplyingViewModeChange.current = false;
				console.log('[Twine] applyChips call completed');
				} catch (e) {
					console.error('[Twine] Error in view mode conversion:', e);
				}
			}
		} else {
			// Switch to raw view
			chipManagerRef.current.clearMarkers();
			
			// Use rawContentRef.current instead of rawContent state
			const textToShow = rawContentRef.current || doc.getValue();
			
			setLocalText(textToShow);
			doc.setValue(textToShow);
			setChipMappings([]);
			chipMappingsRef.current = [];
		}
	}, [viewMode]); // ONLY depend on viewMode, not rawContent
	
	// Note: We no longer have an effect that automatically re-applies chip markers
	// on every localText change. Chips are managed through:
	// 1. Initial mount (in handleMount)
	// 2. View mode switching (in viewMode effect above)
	// 3. Dialog Forms insertText/replaceText (in adapter overrides)
	// This prevents cursor jumping and setValue calls during normal editing
	
	// Chip clicks are handled by CodeMirrorChipManager via onChipClick callback
	// No need for separate DOM-based click handler

	React.useEffect(() => {
		if (!passageCommandFormsReady || !passageCommandFormAdapterRef.current) {
			return;
		}

		const handleTextClick = (event: Event) => {
			// Mark that we've seen this event to prevent duplicate processing
			// The story format handler runs in capture phase and should handle it first
			if ((event as any)._storyformatHandled) {
				console.log('[Twine] handleTextClick: Event already handled by story format, ignoring');
				return;
			}
			
			// Early exit if dialog already exists or lock is active
			// This prevents duplicate dialogs when both story format and TwineJS handlers receive the event
			if (isStoryformatDialogOpen()) {
				console.log('[Twine] handleTextClick: Dialog already exists, ignoring');
				event.stopImmediatePropagation();
				event.preventDefault();
				return;
			}
			
			// Check the global lock from story format dialog forms
			// The story format handler sets this synchronously in capture phase, so if it's set, we should bail
			if (isPassageCommandFormLockActive()) {
				console.log('[Twine] handleTextClick: Dialog lock is active, ignoring');
				event.stopImmediatePropagation();
				event.preventDefault();
				return;
			}
			
			// If event was already prevented (by story format handler), don't process
			if (event.defaultPrevented) {
				console.log('[Twine] handleTextClick: Event was already prevented, ignoring');
				return;
			}
			
			const detail = (event as CustomEvent).detail as
				| {
						text?: string;
						from?: CodeMirror.Position;
						to?: CodeMirror.Position;
				  }
				| undefined;

			if (!detail || !detail.text) {
				return;
			}

			const {text, from, to} = detail;
			// Format: { from, to, json } - DialogFormBase expects this structure
			const existingJson =
				from && to
					? {
							from,
							to,
							json: text
					  }
					: undefined;

			const requestData = parseRequestFormat(text);
			if (requestData?.type) {
				// Double-check no dialog was created between checks
				if (isStoryformatDialogOpen()) {
					console.log('[Twine] handleTextClick: Dialog appeared before form creation, ignoring');
					return;
				}
				
				// Check lock again
			if (isPassageCommandFormLockActive()) {
				console.log('[Twine] handleTextClick: Lock became active before form creation, ignoring');
				return;
			}
			
		// Use Controller story ID if available, otherwise use Twine internal ID
		const controllerStoryId = (window as any).currentStoryId || story.id;
		console.log('[PassageText] Story passages for REQUEST form:', {
			hasPassages: !!story.passages,
			passagesLength: story.passages?.length,
			passageNames: story.passages?.map(p => p.name)
		});
		const context = {
			storyId: controllerStoryId,
			storyName: story.name,
			passageId: passage.id,
			passageName: passage.name,
			storyContextClient: twineStoryContextClient,
			passages: story.passages ? story.passages.map(p => p.name) : []
		};
			const form = DialogFormFactory.createForm(
				'request',
				requestData.type.toLowerCase(),
				passageCommandFormAdapterRef.current,
				{context}
			);
				
				// Check if form creation was blocked
				if (!form) {
					console.log('[Twine] handleTextClick: Form creation was blocked');
					return;
				}
				
				form.showDialog({
					title: t('dialogs.passageEdit.passageCommandEditor.editRequest', {
						defaultValue: `Edit ${requestData.type} Request`,
						requestType: requestData.type
					}),
					existingJson: existingJson,
					formData: requestData
				});
				return;
			}

			const responseData = parseJsonResponse(text);
			if (responseData?.type) {
				// Double-check no dialog was created between checks
				if (isStoryformatDialogOpen()) {
					console.log('[Twine] handleTextClick: Dialog appeared before form creation, ignoring');
					return;
				}
				
				// Check lock again
				if (isPassageCommandFormLockActive()) {
					console.log('[Twine] handleTextClick: Lock became active before form creation, ignoring');
					return;
				}
	
	// Use Controller story ID if available, otherwise use Twine internal ID
	const controllerStoryId = (window as any).currentStoryId || story.id;
	const context = {
		storyId: controllerStoryId,
		storyName: story.name,
		passageId: passage.id,
		passageName: passage.name,
		storyContextClient: twineStoryContextClient,
		passages: story.passages.map(p => p.name)
	};
			const form = DialogFormFactory.createForm(
				'response',
				responseData.type.toLowerCase(),
				passageCommandFormAdapterRef.current,
				{context}
				);
				
				// Check if form creation was blocked
				if (!form) {
					console.log('[Twine] handleTextClick: Form creation was blocked');
					return;
				}
				
				form.showDialog({
					title: t('dialogs.passageEdit.passageCommandEditor.editResponse', {
						defaultValue: `Edit ${responseData.type}`,
						responseType: responseData.type
					}),
					existingJson: existingJson,
					formData: responseData
				});
			}
		};

		// Use capture phase to check lock early, but run after story format handler
		// Story format handler uses capture phase and sets lock, so we check lock and bail if set
		document.addEventListener(STORYFORMAT_TEXT_CLICKED_EVENT, handleTextClick, false);

		return () => {
			document.removeEventListener(STORYFORMAT_TEXT_CLICKED_EVENT, handleTextClick, false);
		};
	}, [passageCommandFormsReady, t]);

	React.useEffect(() => {
		return () => {
			const ed = actualEditorRef.current;
			if (ed) {
				delete (ed as CodeMirror.Editor & Record<string, unknown>)[
					CM_PASSAGE_DIALOG_ADAPTER_KEY
				];
			}
			setPassageCommandFormAdapter(null);
		};
	}, []);

	React.useEffect(() => {
		const handlePassageCommandFormsContentChange = () => {
			if (!passageCommandFormAdapterRef.current) {
				return;
			}
			try {
				const updatedText =
					typeof passageCommandFormAdapterRef.current.getText === 'function'
						? passageCommandFormAdapterRef.current.getText()
						: null;

				if (typeof updatedText === 'string') {
					handleLocalChangeText(updatedText);
				}
			} catch (error) {
				console.warn('[Twine] Failed to sync dialog form change', error);
			}
		};

		document.addEventListener(
			STORYFORMAT_CONTENT_CHANGED_EVENT,
			handlePassageCommandFormsContentChange
		);
		return () => {
			document.removeEventListener(
				STORYFORMAT_CONTENT_CHANGED_EVENT,
				handlePassageCommandFormsContentChange
			);
		};
	}, [handleLocalChangeText]);

	const options = React.useMemo(
		() => ({
			...codeMirrorOptionsFromPrefs(prefs),
			mode: storyFormatExtensionsDisabled ? 'text' : mode,
			lineWrapping: true,
			placeholder: t('dialogs.passageEdit.passageTextPlaceholder'),
			prefixTrigger: {
				callback: autocompletePassageNames,
				prefixes: ['[[', '->']
			},
			// This value prevents the area from being focused.
			readOnly: disabled ? 'nocursor' : false
		}),
		[
			autocompletePassageNames,
			disabled,
			mode,
			prefs,
			storyFormatExtensionsDisabled,
			t
		]
	);

	return (
		<DialogEditor ref={codeAreaContainerRef}>
			<CodeArea
				editorDidMount={handleMount}
				fontFamily={prefs.passageEditorFontFamily}
				fontScale={prefs.passageEditorFontScale}
				id={`passage-dialog-passage-text-code-area-${passage.id}`}
				label={t('dialogs.passageEdit.passageTextEditorLabel')}
				labelHidden
				onChangeEditor={onEditorChange}
				onChangeText={handleLocalChangeText}
				options={options}
				useCodeMirror={prefs.useCodeMirror}
				value={localText}
			/>
		</DialogEditor>
	);
};