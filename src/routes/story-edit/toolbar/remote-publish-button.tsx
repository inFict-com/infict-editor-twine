import * as React from 'react';
import {ReactNode} from 'react';
import {IconShare} from '@tabler/icons';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {useStoriesContext} from '../../../store/stories';
import {publishStory} from '../../../util/publish';
import {getAppInfo} from '../../../util/app-info';
import {
	getHashSearchParams,
	getRemoteQueryKeys,
	getRemoteStoryResourceUrl,
	readRemoteConnectionFromSearchParams,
	REMOTE_SESSION_STORAGE_KEY,
	TOKEN_REFRESH_MESSAGE_TYPES,
	TOKEN_REQUEST_MESSAGE_TYPE
} from '../../../config/remote-connection-config';
// import {persistenceManager} from '../../../store/persistence/use-persistence'; // TODO: persistenceManager not exported

interface PublishButtonProps {
	storyId: string;
	variant?: 'inline' | 'icon';
	label?: string;
	icon?: ReactNode;
}

interface RemoteConfigSnapshot {
	apiEndpoint: string;
	authToken?: string;
	remoteStoryId: string;
	localStoryId?: string;
}

/** Result from requestFreshToken() */
interface TokenRefreshResult {
	/** The new token, or null if refresh failed. */
	token: string | null;
	/** Why it failed: 'login_required' | 'no_opener' | 'timeout' | 'error' */
	reason?: 'login_required' | 'no_opener' | 'timeout' | 'error';
}

/**
 * Request a fresh auth token from the embed parent (window.opener) via postMessage.
 */
function requestFreshToken(timeoutMs = 8000): Promise<TokenRefreshResult> {
	return new Promise(resolve => {
		const opener = window.opener as Window | null;
		if (!opener) {
			console.warn('[RemotePublishButton] No opener window - cannot request token');
			resolve({ token: null, reason: 'no_opener' });
			return;
		}

		const handler = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			const t = event.data?.type;
			if (
				typeof t !== 'string' ||
				!(TOKEN_REFRESH_MESSAGE_TYPES as readonly string[]).includes(t)
			) {
				return;
			}
			window.removeEventListener('message', handler);
			clearTimeout(timer);
			if (event.data.authToken) {
				console.log('[RemotePublishButton] Received fresh token from embed parent');
				(window as any).apiAuthToken = event.data.authToken;
				try {
					const stored = sessionStorage.getItem(REMOTE_SESSION_STORAGE_KEY);
					if (stored) {
						const config = JSON.parse(stored);
						config.authToken = event.data.authToken;
						sessionStorage.setItem(
							REMOTE_SESSION_STORAGE_KEY,
							JSON.stringify(config)
						);
					}
				} catch {
					/* non-fatal */
				}
				if ((window as any).__twineRemoteConfig) {
					(window as any).__twineRemoteConfig.authToken = event.data.authToken;
				}
				resolve({ token: event.data.authToken });
			} else {
				const reason =
					event.data.reason === 'login_required'
						? ('login_required' as const)
						: ('error' as const);
				console.warn(
					'[RemotePublishButton] Parent returned no token:',
					event.data.error,
					'reason:',
					reason
				);
				resolve({ token: null, reason });
			}
		};

		window.addEventListener('message', handler);
		const timer = setTimeout(() => {
			window.removeEventListener('message', handler);
			console.warn('[RemotePublishButton] Token refresh request timed out');
			resolve({ token: null, reason: 'timeout' });
		}, timeoutMs);

		try {
			opener.postMessage({type: TOKEN_REQUEST_MESSAGE_TYPE}, window.location.origin);
		} catch (e) {
			window.removeEventListener('message', handler);
			clearTimeout(timer);
			console.warn('[RemotePublishButton] Failed to postMessage to opener:', e);
			resolve({ token: null, reason: 'error' });
		}
	});
}

/** User-facing messages based on why token refresh failed. */
const TOKEN_REFRESH_MESSAGES: Record<string, string> = {
	login_required:
		'Your session has fully expired. Switch to the Controller tab and log in, then come back here and click Publish again. Your work is saved in this browser.',
	no_opener:
		'The Controller window is no longer available. Your work is saved in this browser — use "Publish to File" to download a copy, then open the story from the Controller again.',
	timeout:
		'The Controller did not respond. Make sure the Controller tab is still open, then try publishing again. Your work is saved in this browser.',
	error:
		'Could not refresh your session. Switch to the Controller tab and make sure you are logged in, then come back here and click Publish again. Your work is saved in this browser.'
};

/**
 * Publishes the current story to the configured remote HTTP backend (embed mode).
 */
export const RemotePublishButton: React.FC<PublishButtonProps> = ({
	storyId,
	variant = 'inline',
	label,
	icon
}) => {
	const {t} = useTranslation();
	const [publishing, setPublishing] = React.useState(false);
	const [visible, setVisible] = React.useState(false);
	const [status, setStatus] = React.useState<
		| {
				type: 'info' | 'success' | 'error';
				message: string;
		  }
		| null
	>(null);
  const {stories} = useStoriesContext();

	const getRemoteConfigSnapshot = () => {
		const win = window as typeof window & {
			__twineRemoteConfig?: RemoteConfigSnapshot;
		};

		if (win.__twineRemoteConfig) {
			return win.__twineRemoteConfig;
		}

		try {
			const stored = sessionStorage.getItem(REMOTE_SESSION_STORAGE_KEY);
			if (stored) {
				return JSON.parse(stored) as RemoteConfigSnapshot;
			}
		} catch (error) {
			console.warn('[RemotePublishButton] Failed to read remote config snapshot', error);
		}

		return undefined;
	};

  // Check if we should show this button (only when API provider is initialized)
  React.useEffect(() => {
    console.log('[RemotePublishButton] Initializing...');
    
    // Listen for the API initialization event
    const handleApiInitialized = (event: CustomEvent) => {
      console.log('[RemotePublishButton] API initialized event received', event.detail);
      setVisible(true);
      
      // TODO: persistenceManager not exported - commented out
      // Get provider status
      // const provider = persistenceManager.getProvider();
      // if (provider && 'getStatus' in provider) {
      //   const status = (provider as any).getStatus();
      //   console.log('[RemotePublishButton] API provider status:', status);
      // }
    };

    // TODO: persistenceManager not exported - commented out
    // Check if the API is already initialized
    // const provider = persistenceManager.getProvider();
    // if (provider) {
    //   console.log('[RemotePublishButton] Provider type:', provider.constructor.name);
    //   
    //   if ('getStatus' in provider) {
    //     const status = (provider as any).getStatus();
    //     console.log('[RemotePublishButton] API provider status:', status);
    //     setVisible(true);
    //   }
    // }

    // Check URL parameters as a backup method
    const urlParams = new URLSearchParams(window.location.search);
    const qk = getRemoteQueryKeys();
    const remoteFromUrl = readRemoteConnectionFromSearchParams(urlParams, qk, {
      hashParams: getHashSearchParams()
    });
    if (remoteFromUrl.apiEndpoint && remoteFromUrl.storyId) {
      console.log('[RemotePublishButton] Remote API parameters found in URL');
      setVisible(true);
    }

		// Also rely on saved remote config when URL params were stripped already
		if (!visible && getRemoteConfigSnapshot()) {
			console.log('[RemotePublishButton] Remote config snapshot found, forcing button visible');
			setVisible(true);
		}

    // Listen for future initializations
    document.addEventListener('api-provider-initialized', handleApiInitialized as EventListener);

    return () => {
      document.removeEventListener('api-provider-initialized', handleApiInitialized as EventListener);
    };
  }, [visible]);

  // Find the story
  const story = stories.find(s => s.id === storyId);
  if (!story) {
    console.log(`[RemotePublishButton] Story not found: ${storyId}`);
    return null;
  }

  // Dev: show publish even when remote API init is still pending (toggle off for stricter gating)
  const forceVisibleForDebug = true;

  // Don't render if not visible and not in debug mode
  if (!visible && !forceVisibleForDebug) {
    console.log('[RemotePublishButton] Button hidden - API not initialized');
    return null;
  }

	/**
	 * Send the story to the Controller API.
	 * @param tokenOverride - If provided, use this token instead of the stored one.
	 * @returns The fetch Response object.
	 */
  const doPublishRequest = async (tokenOverride?: string) => {
    const params = new URLSearchParams(window.location.search);
		const qk = getRemoteQueryKeys();
		const fromUrl = readRemoteConnectionFromSearchParams(params, qk, {
			hashParams: getHashSearchParams()
		});
		const storedConfig = getRemoteConfigSnapshot();
		const apiEndpoint = fromUrl.apiEndpoint || storedConfig?.apiEndpoint;
		const authToken =
			tokenOverride ||
			fromUrl.authToken ||
			storedConfig?.authToken ||
			(window as any).apiAuthToken;
		const urlStoryId = fromUrl.storyId || storedConfig?.remoteStoryId;
    
    console.log('[DEBUG] Controller Publish Button - doPublishRequest starting');
    console.log('[DEBUG] Story object:', {
      name: story.name,
      id: story.id,
      passages: story.passages.length,
      startPassage: story.startPassage,
      passageWithPosition: story.passages.some(p => p.left !== undefined && p.top !== undefined)
    });

    // Use publishStory() to generate canonical <tw-storydata> HTML.
    // This is the same HTML that Twine's "Publish to File" produces and that
    // the engine's convert-win pipeline (Puppeteer + Twison.convert()) expects.
    // It correctly preserves: startnode, tags, positions, sizes, and escaping.
    const htmlContent = publishStory(story, getAppInfo(), {startOptional: true});

    console.log('[DEBUG] Generated tw-storydata HTML, length:', htmlContent.length);
    console.log('[DEBUG] First 500 chars:', htmlContent.substring(0, 500));

    console.log('[DEBUG] Publishing with params:', {
      apiEndpoint: apiEndpoint ? `${apiEndpoint.substring(0, 20)}...` : null,
      hasAuthToken: !!authToken,
      storyId: urlStoryId || storyId
    });

    if (!apiEndpoint) {
      throw new Error('API endpoint not found in URL parameters or remote snapshot');
    }

    if (!authToken) {
      throw new Error('Authentication token required to publish to controller. Please log in again.');
    }

    // Create headers — send as text/html so the controller knows to use
    // htmlToTwison() instead of the old tweeToJson() regex parser.
    const headers = new Headers();
    headers.set('Content-Type', 'text/html');
    headers.set('Authorization', `Bearer ${authToken}`);

		// Use the storyId from URL/config if available, otherwise use the one from props
		const targetStoryId = urlStoryId || storyId;
		const publishUrl = getRemoteStoryResourceUrl(apiEndpoint, targetStoryId);

    console.log(`[RemotePublishButton] Sending request to ${publishUrl}`);
    return fetch(publishUrl, {
      method: 'POST',
      headers,
      body: htmlContent
    });
  };

	/**
	 * Check whether a failed response is a token-expired 401.
	 */
	const isTokenExpiredResponse = async (response: Response): Promise<boolean> => {
		if (response.status !== 401) return false;
		try {
			const text = await response.clone().text();
			const body = JSON.parse(text) as { code?: string; message?: string };
			return body.code === 'token_expired' ||
				(!!body.message && body.message.toLowerCase().includes('expired'));
		} catch {
			return false;
		}
	};

  const handlePublish = async () => {
    setPublishing(true);
		setStatus({
			type: 'info',
			message: t('dialogs.storyFormatEditor.publishingRemote', 'Publishing to remote…')
		});
    console.log('[DEBUG] Remote publish - handlePublish called');
    try {
			let response = await doPublishRequest();

			if (await isTokenExpiredResponse(response)) {
				console.log('[RemotePublishButton] Token expired — requesting fresh token from parent');
				setStatus({
					type: 'info',
					message: t(
						'dialogs.storyFormatEditor.sessionRefresh',
						'Session expired — requesting fresh token…'
					)
				});

				const refreshResult = await requestFreshToken();

				if (refreshResult.token) {
					console.log('[RemotePublishButton] Got fresh token — retrying publish');
					setStatus({
						type: 'info',
						message: t(
							'dialogs.storyFormatEditor.retryingPublish',
							'Token refreshed — retrying publish…'
						)
					});
					response = await doPublishRequest(refreshResult.token);
				} else {
					const reason = refreshResult.reason || 'error';
					throw new Error(TOKEN_REFRESH_MESSAGES[reason] || TOKEN_REFRESH_MESSAGES.error);
				}
			}

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`API request failed (${response.status}): ${errorText || response.statusText}`);
			}

			setStatus({
				type: 'success',
				message: t('dialogs.storyFormatEditor.publishedRemote', 'Published to remote')
			});
			showNotification(
				t('dialogs.storyFormatEditor.publishSuccessToast', 'Story published to remote backend'),
				'success'
			);
    } catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown error';
			setStatus({type: 'error', message: `Publish failed: ${message}`});
      console.error('Error publishing to remote backend', error);
			showNotification(`Error publishing: ${message}`, 'error');
    } finally {
      setPublishing(false);
    }
  };
  
  /**
   * Show a notification to the user
   */
  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    console.log(`[DEBUG] Controller Publish Button - showNotification: ${message}`);
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.bottom = '20px';
    notification.style.right = '20px';
    notification.style.padding = '10px 20px';
    notification.style.backgroundColor = type === 'success' ? '#4caf50' : '#f44336';
    notification.style.color = 'white';
    notification.style.borderRadius = '4px';
    notification.style.zIndex = '9999';
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.5s';
      setTimeout(() => notification.remove(), 500);
    }, 3000);
  };

	if (variant === 'icon') {
		return (
			<div style={{display: 'flex', flexDirection: 'column', gap: '0.25rem'}}>
				<IconButton
					disabled={publishing}
					icon={icon ?? <IconShare />}
					label={
						label ||
						t('dialogs.storyFormatEditor.publishRemoteShort', 'Publish to remote')
					}
					onClick={handlePublish}
				/>
				{status && (
					<div
						className="controller-publish-status"
						style={{
							fontSize: '0.75rem',
							color:
								status.type === 'success'
									? '#0f8a4b'
									: status.type === 'error'
									? '#c62828'
									: '#444',
							minHeight: '1rem'
						}}
					>
						{status.message}
					</div>
				)}
			</div>
		);
	}

  return (
		<div style={{display: 'flex', flexDirection: 'column', gap: '0.35rem'}}>
			<button
				className="control"
				onClick={handlePublish}
				disabled={publishing}
				title={t(
					'dialogs.storyFormatEditor.publishRemoteTitle',
					'Publish story to the connected remote backend'
				)}
			>
				<span role="img" aria-label="publish">📤</span>
				<span>
					{publishing
						? t('dialogs.storyFormatEditor.publishingEllipsis', 'Publishing…')
						: label ||
						  t('dialogs.storyFormatEditor.publishRemoteShort', 'Publish to remote')}
				</span>
			</button>
			{status && (
				<div
					className="controller-publish-status"
					style={{
						fontSize: '0.85rem',
						color:
							status.type === 'success'
								? '#0f8a4b'
								: status.type === 'error'
								? '#c62828'
								: '#444',
						minHeight: '1rem'
					}}
				>
					{status.message}
				</div>
			)}
		</div>
  );
};
