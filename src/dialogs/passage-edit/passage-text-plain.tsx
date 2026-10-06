import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogEditor} from '../../components/container/dialog-card';
import {CodeArea} from '../../components/control/code-area';
import {usePrefsContext} from '../../store/prefs';
import {useCodeMirrorPassageHints} from '../../store/use-codemirror-passage-hints';
import {useFormatCodeMirrorMode} from '../../store/use-format-codemirror-mode';
import {codeMirrorOptionsFromPrefs} from '../../util/codemirror-options';
import type {PassageTextProps} from './passage-text-types';
import './passage-text.css';

/**
 * Standard Twine passage editor (Harlowe, SugarCube, etc.): debounced onChange,
 * format CodeMirror mode, no extended passage command editor (Snowcone chip UI).
 */
export const PassageTextPlain: React.FC<PassageTextProps> = props => {
	const {
		disabled,
		onChange,
		onEditorChange,
		passage,
		story,
		storyFormat,
		storyFormatExtensionsDisabled
	} = props;
	const [localText, setLocalText] = React.useState(passage.text);
	const {prefs} = usePrefsContext();
	const autocompletePassageNames = useCodeMirrorPassageHints(story);
	const mode =
		useFormatCodeMirrorMode(storyFormat.name, storyFormat.version) ?? 'text';
	const codeAreaContainerRef = React.useRef<HTMLDivElement>(null);
	const remoteSaveTimeoutRef = React.useRef<number>();
	const onChangeText = React.useRef<string>();
	const onChangeTimeout = React.useRef<number>();
	const prevPassageIdRef = React.useRef(passage.id);
	const {t} = useTranslation();

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
			setLocalText(text);

			if (onChangeTimeout.current) {
				window.clearTimeout(onChangeTimeout.current);
			}

			onChangeText.current = text;

			onChangeTimeout.current = window.setTimeout(() => {
				onChangeTimeout.current = undefined;
				onChange(onChangeText.current!);
			}, 1000);

			scheduleRemoteSave();
		},
		[onChange, scheduleRemoteSave]
	);

	React.useEffect(() => {
		if (onChangeTimeout.current) {
			window.clearTimeout(onChangeTimeout.current);
			onChangeTimeout.current = window.setTimeout(() => {
				onChangeTimeout.current = undefined;
				onChange(onChangeText.current!);
			}, 1000);
		}
	}, [onChange]);

	React.useEffect(() => {
		const idChanged = prevPassageIdRef.current !== passage.id;
		prevPassageIdRef.current = passage.id;

		const applyPassageTextFromProps = () => {
			setLocalText(passage.text);
		};

		if (idChanged) {
			applyPassageTextFromProps();
			return;
		}

		if (onChangeTimeout.current) {
			return;
		}
		if (passage.text === localText) {
			return;
		}
		applyPassageTextFromProps();
	}, [passage.id, passage.text, localText]);

	React.useEffect(
		() => () => {
			if (remoteSaveTimeoutRef.current) {
				window.clearTimeout(remoteSaveTimeoutRef.current);
			}
		},
		[]
	);

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

	const handleMount = React.useCallback(
		(editor: CodeMirror.Editor) => {
			onEditorChange(editor);
			window.setTimeout(() => {
				// Refresh before focus: the dialog entrance animation (200ms CSS
				// transition on .dialog-transform-setter) leaves CodeMirror's
				// coordinate map stale, causing click-to-cursor misalignment.
				editor.refresh();
				editor.focus();
			}, 400);
		},
		[onEditorChange]
	);

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
