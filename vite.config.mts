import react from '@vitejs/plugin-react-swc';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import checker from 'vite-plugin-checker';
import {nodePolyfills} from 'vite-plugin-node-polyfills';
import {VitePWA} from 'vite-plugin-pwa';
import path from 'path';
import {fileURLToPath} from 'url';
import packageJson from './package.json';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory that mirrors published `@infict/dialog-forms` (local Snowcone build or optional npm install). */
function resolveSnowconeDialogFormsRoot(viteEnv: Record<string, string>): string {
	const fromEnv = viteEnv.VITE_DIALOG_FORMS_ROOT;
	if (fromEnv) {
		return path.resolve(__dirname, fromEnv);
	}
	const fromNodeModules = path.join(__dirname, 'node_modules/@infict/dialog-forms');
	if (fs.existsSync(fromNodeModules)) {
		return fromNodeModules;
	}
	// Sibling checkout: `twinejs` + `snowcone` in the same parent folder.
	return path.resolve(__dirname, '../snowcone/dialog-forms-dist/dialog-forms');
}

/** Resolves `@twine-fork/dialog-forms` / `@infict/dialog-forms` to the same root. */
function resolveSnowconeDialogFormsAliases(viteEnv: Record<string, string>): Record<string, string> {
	const resolved = resolveSnowconeDialogFormsRoot(viteEnv);
	return {
		'@twine-fork/dialog-forms': resolved,
		'@infict/dialog-forms': resolved
	};
}

/** Remove bundled Snowcone format from dist before PWA precache when building upstream-core. */
function stripExtendedFormatFromDistIfUpstream(isUpstreamCore: boolean): Plugin {
	return {
		name: 'strip-extended-format-from-dist-if-upstream',
		apply: 'build',
		closeBundle: {
			order: 'pre',
			sequential: true,
			handler() {
				if (!isUpstreamCore) {
					return;
				}
				const formatsDir = path.join(__dirname, 'dist/web/story-formats');
				if (!fs.existsSync(formatsDir)) {
					return;
				}
				for (const name of fs.readdirSync(formatsDir)) {
					if (name.startsWith('snowcone-')) {
						const p = path.join(formatsDir, name);
						if (fs.statSync(p).isDirectory()) {
							fs.rmSync(p, {recursive: true, force: true});
							console.log(
								`[vite] Omitted from dist: story-formats/${name}/ (fork extended build off)`
							);
						}
					}
				}
			}
		}
	};
}

export default defineConfig(({mode}) => {
	const env = loadEnv(mode, process.cwd(), 'VITE_');
	const viteTwineForkExtended =
		env.VITE_TWINE_FORK_EXTENDED ?? env.VITE_INFICT_TWINE ?? 'true';
	const viteInfictTwineLegacy =
		env.VITE_INFICT_TWINE ?? env.VITE_TWINE_FORK_EXTENDED ?? 'true';
	const upstreamCoreBuild = viteTwineForkExtended === 'false';

	const viteProcessEnvDefine: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		viteProcessEnvDefine[`process.env.${k}`] = JSON.stringify(v);
	}

	const moduleAliasesFromEnv = ((): Record<string, string> => {
		const raw = env.VITE_TWINE_MODULE_ALIASES;
		if (!raw?.trim()) return {};
		try {
			const pairs = JSON.parse(raw) as Record<string, string>;
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(pairs)) {
				if (typeof k === 'string' && typeof v === 'string' && k && v) {
					out[k] = path.resolve(__dirname, v);
				}
			}
			return out;
		} catch {
			console.warn('[vite] Invalid VITE_TWINE_MODULE_ALIASES JSON');
			return {};
		}
	})();

	return {
	base: './',
	resolve: {
		alias: {
			...resolveSnowconeDialogFormsAliases(env),
			...moduleAliasesFromEnv
		}
	},
	build: {
		outDir: 'dist/web',
		target: browserslistToEsbuild(['>0.2%', 'not dead', 'not op_mini all'])
	},
	define: {
		...viteProcessEnvDefine,
		'process.env.VITE_APP_NAME': JSON.stringify(packageJson.name),
		'process.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
		'process.env.VITE_TWINE_FORK_EXTENDED': JSON.stringify(viteTwineForkExtended),
		'process.env.VITE_INFICT_TWINE': JSON.stringify(viteInfictTwineLegacy)
	},
	plugins: [
		checker({
			eslint: {lintCommand: 'eslint src'},
			overlay: {
				initialIsOpen: false
			},
			typescript: true
		}),
		nodePolyfills(
			{include: [], globals: {global: true}}
		),
		react(),
		stripExtendedFormatFromDistIfUpstream(upstreamCoreBuild),
		VitePWA({
			manifest: {
				icons: [
					{
						src: './icons/pwa.png',
						sizes: '1024x1024',
						type: 'image/png'
					},
					{
						src: './icons/pwa-maskable.png',
						purpose: 'maskable',
						sizes: '1024x1024',
						type: 'image/png'
					}
				]
			},
			registerType: 'autoUpdate',
			includeAssets: upstreamCoreBuild
				? ['locales/**', 'pwa/**']
				: ['locales/**', 'pwa/**', 'story-formats/**'],
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
				clientsClaim: true,
				skipWaiting: true
			}
		}),
		{
			name: 'story-formats-handler',
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if (!req.url) {
						next();
						return;
					}

					if (req.url.includes('format.js')) {
						const url = new URL(req.url, 'http://localhost');
						const callback = url.searchParams.get('callback');
						if (!callback) {
							next();
							return;
						}

						if (req.url.includes('1.0.57')) {
							const sugarcubeFormatPath = path.join(
								__dirname,
								'public/story-formats/sugarcube-2.37.3/format.js'
							);

							if (fs.existsSync(sugarcubeFormatPath)) {
								try {
									const content = fs.readFileSync(sugarcubeFormatPath, 'utf-8');
									res.setHeader('Content-Type', 'application/javascript');
									res.end(`${callback}(${content});`);
									return;
								} catch (err) {
									console.error('[Vite Middleware] Error reading format file:', err);
								}
							}
						}

						if (url.pathname.startsWith('/story-formats/') && url.pathname.endsWith('/format.js')) {
							const filePath = path.join(__dirname, 'public', url.pathname);

							if (fs.existsSync(filePath)) {
								try {
									const content = fs.readFileSync(filePath, 'utf-8');
									res.setHeader('Content-Type', 'application/javascript');
									res.end(`${callback}(${content});`);
									return;
								} catch (err) {
									console.error('[Vite Middleware] Error reading format file:', err);
								}
							}
						}

						const minimalFormat = JSON.stringify({
							name: 'Fallback Format',
							version: '1.0.0',
							description: 'A minimal fallback format',
							author: 'TwineJS',
							image: '',
							url: '',
							license: 'MIT',
							proofing: false,
							source: '<html><head><title>{{STORY_NAME}}</title></head><body>{{STORY_DATA}}</body></html>'
						});

						res.setHeader('Content-Type', 'application/javascript');
						res.end(`${callback}(${minimalFormat});`);
						return;
					}

					next();
				});
			}
		}
	],
	server: {
		open: true,
		proxy: {
			'/api/twine': {
				target: 'http://localhost:3000',
				changeOrigin: true,
				secure: false
			}
		},
		fs: {
			allow: ['..']
		}
	},
	publicDir: 'public'
};
});
