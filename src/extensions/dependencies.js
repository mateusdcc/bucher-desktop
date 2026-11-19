/**
 * Declarative dependency manifests for extensions.
 *
 * Every extension declares the web packages it ships with and the native
 * Tauri capabilities it needs. The registry validates manifests at
 * registration, the Extension Manager displays them, and the capability
 * bridge health-checks native declarations at runtime.
 *
 * @module extensions/dependencies
 */
import { z } from 'zod';

/**
 * @typedef {Object} WebPackageDependency
 * @property {string} name      npm package name.
 * @property {string} version   Exact version or the semver range installed in package.json.
 * @property {string} purpose   Human-readable explanation shown in the Extension Manager.
 * @property {boolean} [lazyLoad]  True when heavy assets load only at block mount.
 */

/**
 * @typedef {Object} TauriDependency
 * @property {'tauri-plugin' | 'rust-crate' | 'ipc-command'} type
 * @property {string} name
 * @property {string[]} [requiredPermissions]  Tauri v2 capability identifiers, when relevant.
 * @property {'disable-on-web' | 'degrade-gracefully'} fallbackBehavior
 * @property {string} purpose
 */

/**
 * @typedef {Object} ExtensionDependencyManifest
 * @property {WebPackageDependency[]} webPackages
 * @property {TauriDependency[]} [tauriDependencies]
 */

export const webPackageSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(60),
  purpose: z.string().min(1).max(400),
  lazyLoad: z.boolean().optional(),
});

export const tauriDependencySchema = z.object({
  type: z.enum(['tauri-plugin', 'rust-crate', 'ipc-command']),
  name: z.string().min(1).max(120),
  requiredPermissions: z.array(z.string().min(1)).max(20).optional(),
  fallbackBehavior: z.enum(['disable-on-web', 'degrade-gracefully']),
  purpose: z.string().min(1).max(400),
});

export const dependencyManifestSchema = z.object({
  webPackages: z.array(webPackageSchema).max(40),
  tauriDependencies: z.array(tauriDependencySchema).max(20).optional(),
});

/**
 * @param {unknown} manifest
 * @returns {string | null} a contract violation, or null when valid
 */
export function manifestProblem(manifest) {
  if (!manifest || typeof manifest !== 'object') return 'dependencies manifest is required.';
  const result = dependencyManifestSchema.safeParse(manifest);
  if (result.success) return null;
  return result.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}
