import * as React from 'react';
import {v4 as uuid} from '@lukeed/uuid';
// import { persistenceManager } from '../use-persistence'; // TODO: persistenceManager not exported
// import { ApiProvider } from './api-provider'; // TODO: ApiProvider file doesn't exist
import { /* StoriesState, */ Story } from '../../stories/stories.types';
import { DEFAULT_STORY_FORMAT } from '../../stories/defaults';
import { useStoriesContext } from '../../stories/stories-context';
import { importStories } from '../../stories/action-creators/import-stories';
import { normalizeTag } from '../../../util/tag';
import {syncTwineEmbedApiGlobals} from '../../../util/embed-window-bridge';
import {isForkExtendedBuild} from '../../../config/fork-build-config';
import {
	getHashSearchParams,
	getRemoteQueryKeys,
	getRemoteStoryResourceUrl,
	readRemoteConnectionFromSearchParams,
	REMOTE_SESSION_STORAGE_KEY,
	TOKEN_REFRESH_MESSAGE_TYPES
} from '../../../config/remote-connection-config';

// Add TypeScript declarations for the window extensions
declare global {
  interface Window {
    __ROUTER_HISTORY__?: any;
    __TWINE_ROUTER_HISTORY__?: any;
    ___TWINE_APP_ROUTER_HISTORY___?: any;
    _router?: any;
    _history?: any;
    currentStoryId?: string;
    apiEndpoint?: string;
    apiAuthToken?: string;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ApiProviderOptions {
  apiEndpoint: string;
  storyId: string;
  authToken?: string;
  debug?: boolean;
  replaceExisting?: boolean;
}

/**
 * This component handles initialization of the API provider based on URL parameters.
 * It doesn't render anything visible, just handles the initialization logic.
 */
export const ApiInitializer: React.FC = ({ children }) => {
  const [initialized, setInitialized] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { dispatch, stories } = useStoriesContext();

  React.useEffect(() => {
    // Only run once
    if (initialized) return;

    // Upstream-style core build: no remote embed URL import or window globals.
    if (!isForkExtendedBuild()) {
      setInitialized(true);
      return;
    }

    try {
      const queryKeys = getRemoteQueryKeys();
      const params = new URLSearchParams(window.location.search);
      const hashParams = getHashSearchParams();
      const {apiEndpoint, authToken, storyId} = readRemoteConnectionFromSearchParams(
        params,
        queryKeys,
        {hashParams}
      );
      // const debug = params.get('debug') === 'true'; // Unused since API provider is disabled

      // Check if we have the required parameters
      if (apiEndpoint && storyId) {
        // Check if we've already imported this story in this session
        const importedKey = `twine-api-imported-${storyId}`;
        if (sessionStorage.getItem(importedKey)) {
          console.log('[API] Story already imported in this session, skipping re-fetch');
          // Still sync window globals — dialog forms (StoryContextClient) need
          // apiEndpoint + apiAuthToken on every load; early return previously left them
          // undefined after reload/navigation, causing /api/stories/... 401 on Vite origin.
          syncTwineEmbedApiGlobals({
            apiEndpoint,
            currentStoryId: storyId,
            ...(authToken ? {apiAuthToken: authToken} : {})
          });
          console.log('[Twine embed] Re-synced apiEndpoint for embed session:', apiEndpoint);
          setInitialized(true);
          return;
        }
        
        console.log('API parameters detected in URL, initializing API connection');
        
        // Mark as imported FIRST to prevent any re-processing
        sessionStorage.setItem(importedKey, 'true');
        
        // Store initialization state to avoid re-initialization
        setInitialized(true);
        
        syncTwineEmbedApiGlobals({
          apiEndpoint,
          currentStoryId: storyId,
          ...(authToken ? {apiAuthToken: authToken} : {})
        });
        console.log('[Twine embed] Stored apiEndpoint in window:', apiEndpoint);
        
        // Listen for token-refresh messages from the Controller (window.opener).
        // When the publish button detects a 401 it asks the Controller for a fresh
        // token via postMessage. The Controller calls getAccessTokenSilently() and
        // sends the new token back here.
        const handleTokenMessage = (event: MessageEvent) => {
          // Only accept messages from the same origin (Controller)
          if (event.origin !== window.location.origin) return;
          const msgType = event.data?.type;
          if (
            typeof msgType !== 'string' ||
            !(TOKEN_REFRESH_MESSAGE_TYPES as readonly string[]).includes(msgType)
          ) {
            return;
          }
          const newToken = event.data.authToken;
          if (newToken) {
            console.log('[API] Received refreshed auth token from embed parent');
            syncTwineEmbedApiGlobals({apiAuthToken: newToken});
            try {
              const stored = sessionStorage.getItem(REMOTE_SESSION_STORAGE_KEY);
              if (stored) {
                const config = JSON.parse(stored);
                config.authToken = newToken;
                sessionStorage.setItem(
                  REMOTE_SESSION_STORAGE_KEY,
                  JSON.stringify(config)
                );
              }
            } catch (e) {
              console.warn('[API] Failed to update sessionStorage config with new token', e);
            }
            if ((window as any).__twineRemoteConfig) {
              (window as any).__twineRemoteConfig.authToken = newToken;
            }
          }
        };
        window.addEventListener('message', handleTokenMessage);
        
        console.log('[Twine embed] Set window.currentStoryId to:', storyId);
        
        // TODO: ApiProvider and persistenceManager not available - feature disabled
        // Initialize API provider with URL parameters
        // const provider = new ApiProvider();
        // provider.initialize({
        //   apiEndpoint,
        //   storyId,
        //   authToken: authToken || undefined,
        //   debug,
        //   replaceExisting // Always true now
        // });

        // Register the provider with the persistence manager
        // persistenceManager.setProvider(provider);
        
        // Load story from the API directly
        const storyUrl = getRemoteStoryResourceUrl(apiEndpoint, storyId);
        console.log(`[API] Fetching story from ${storyUrl}`);
        
        if (!authToken) {
          console.error('[API] No auth token provided - authentication is required');
          throw new Error('Authentication token required to load story from controller. Please log in again.');
        }
        
        const headers = new Headers();
        headers.set('Authorization', `Bearer ${authToken}`);
        
        fetch(storyUrl, { headers })
          .then(response => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
          })
          .then((storyObject: Story) => {
            console.log(`[API] Successfully loaded story:`, storyObject.name);
            console.log(`[API] Story has ${storyObject.passages?.length || 0} passages`);
          
          // Set story format if not already set
          if (!storyObject.storyFormat) {
            storyObject.storyFormat = DEFAULT_STORY_FORMAT.name; 
            storyObject.storyFormatVersion = DEFAULT_STORY_FORMAT.version;
            console.log(`[API] Set default story format: ${DEFAULT_STORY_FORMAT.name} ${DEFAULT_STORY_FORMAT.version}`);
          }
          
          // Transform passages from Twison format to TwineJS format
          if (storyObject.passages && Array.isArray(storyObject.passages)) {
            storyObject.passages = storyObject.passages.map((passage: any, index: number) => {
              // Twison uses position.x/y; TwineJS uses left/top. Coerce with Number() — API JSON may use strings.
              // Offset default positions by index so passages without explicit
              // positions don't all stack on top of each other and become invisible.
              const defaultLeft = 100 + (index % 4) * 150;
              const defaultTop = 100 + Math.floor(index / 4) * 150;
              let left = defaultLeft;
              let top = defaultTop;
              
              if (passage.left !== undefined && passage.left !== null) {
                left = Number(passage.left);
              } else if (passage.position && passage.position.x !== undefined) {
                left = Number(passage.position.x);
              }
              
              if (passage.top !== undefined && passage.top !== null) {
                top = Number(passage.top);
              } else if (passage.position && passage.position.y !== undefined) {
                top = Number(passage.position.y);
              }
              
              // TwineJS requires specific fields that Twison doesn't provide
              const transformed: any = {
                // ID: pid → id (must be string)
                id: String(passage.id || passage.pid || uuid()),
                
                // Position (must be numbers)
                left: left,
                top: top,
                
                // Dimensions: TwineJS uses 100x100 squares by default (must be numbers)
                width: Number(passage.width || 100),
                height: Number(passage.height || 100),
                
                // Text content (must be strings)
                name: String(passage.name || 'Untitled Passage'),
                text: String(passage.text || ''),
                tags: Array.isArray(passage.tags)
                ? [...new Set(passage.tags.map(normalizeTag).filter(Boolean))]
                : [],
                
                // State flags (must be booleans)
                highlighted: Boolean(passage.highlighted),
                selected: Boolean(passage.selected),
                
                // Parent story ID (must be string, will be set by importStories)
                story: String(passage.story || storyObject.id)
              };
              
              // Log first passage for debugging
              if (index === 0) {
                console.log('[API] First passage transformation:', {
                  input: { position: passage.position, left: passage.left, top: passage.top },
                  output: { 
                    left: transformed.left, 
                    top: transformed.top,
                    leftType: typeof transformed.left,
                    topType: typeof transformed.top
                  }
                });
              }
              
              return transformed;
            });
            console.log('[API] Transformed', storyObject.passages.length, 'passages from Twison to TwineJS format');
          }
          
          // Transform story metadata from Twison to TwineJS format
          // Twison uses 'startnode' (passage ID), TwineJS uses 'startPassage' (passage ID)
          if ((storyObject as any).startnode && !storyObject.startPassage) {
            storyObject.startPassage = (storyObject as any).startnode;
            console.log('[API] Transformed startnode to startPassage:', storyObject.startPassage);
          }
          
          // Ensure start passage is set (now using id not pid)
          if (!storyObject.startPassage && storyObject.passages && storyObject.passages.length > 0) {
            storyObject.startPassage = storyObject.passages[0].id;
          }
          
          // Use Redux to import the story - TwineJS's save middleware will persist to localStorage
          try {
            console.log('[API] Dispatching importStories action to Redux');
            
            // importStories will:
            // 1. Check if story already exists by name
            // 2. Set passage.story field for all passages
            // 3. Create or update the story
            // 4. TwineJS's persistedReducer middleware will save to localStorage
            dispatch(importStories([storyObject], stories));
            
            console.log('[API] Story imported successfully via Redux');
            console.log('[API] Story will be visible in story list');
          } catch (error) {
            console.error('[API] Error dispatching importStories:', error);
          }
          })
          .catch((error: Error) => {
            console.error('[API] Error loading story:', error);
            setError(error.message);
          });
      }
    } catch (error) {
      console.error('Error initializing API provider:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [initialized]);

  // Render error if there is one
  if (error) {
    return <div style={{ color: 'red' }}>Error: {error}</div>;
  }

  // Render children
  return <>{children}</>;
}; 