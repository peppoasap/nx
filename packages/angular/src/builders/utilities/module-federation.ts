import { ProjectConfiguration } from 'nx/src/config/workspace-json-project-json';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { Remotes } from '@nx/devkit';

export function getDynamicRemotes(
  project: ProjectConfiguration,
  context: import('@angular-devkit/architect').BuilderContext,
  workspaceProjects: Record<string, ProjectConfiguration>,
  remotesToSkip: Set<string>,
  pathToManifestFile = join(
    context.workspaceRoot,
    project.sourceRoot,
    'assets/module-federation.manifest.json'
  )
): string[] {
  // check for dynamic remotes
  // we should only check for dynamic based on what we generate
  // and fallback to empty array

  if (!existsSync(pathToManifestFile)) {
    return [];
  }

  const moduleFederationManifestJson = readFileSync(
    pathToManifestFile,
    'utf-8'
  );

  if (!moduleFederationManifestJson) {
    return [];
  }

  // This should have shape of
  // {
  //   "remoteName": "remoteLocation",
  // }
  const parsedManifest = JSON.parse(moduleFederationManifestJson);
  if (
    !Object.keys(parsedManifest).every(
      (key) =>
        typeof key === 'string' && typeof parsedManifest[key] === 'string'
    )
  ) {
    return [];
  }

  const dynamicRemotes = Object.entries(parsedManifest)
    .map(([remoteName]) => remoteName)
    .filter((r) => !remotesToSkip.has(r));
  const invalidDynamicRemotes = dynamicRemotes.filter(
    (remote) => !workspaceProjects[remote]
  );
  if (invalidDynamicRemotes.length) {
    throw new Error(
      invalidDynamicRemotes.length === 1
        ? `Invalid dynamic remote configured in "${pathToManifestFile}": ${invalidDynamicRemotes[0]}.`
        : `Invalid dynamic remotes configured in "${pathToManifestFile}": ${invalidDynamicRemotes.join(
            ', '
          )}.`
    );
  }

  return dynamicRemotes;
}

export function getStaticRemotes(
  project: ProjectConfiguration,
  context: import('@angular-devkit/architect').BuilderContext,
  workspaceProjects: Record<string, ProjectConfiguration>,
  remotesToSkip: Set<string>,
  pathToModuleFederationConfigFile = join(
    context.workspaceRoot,
    project.sourceRoot,
    'module-federation.config.js'
  )
): string[] {
  let mfeConfig: { remotes: Remotes };
  try {
    mfeConfig = resolveModuleFederationConfigFile(
      pathToModuleFederationConfigFile
    );
  } catch {
    throw new Error(
      `Could not load ${pathToModuleFederationConfigFile}. Was this project generated with "@nrwl/angular:host"?`
    );
  }

  const remotesConfig =
    Array.isArray(mfeConfig.remotes) && mfeConfig.remotes.length > 0
      ? mfeConfig.remotes
      : [];
  const staticRemotes = remotesConfig
    .map((remoteDefinition) =>
      Array.isArray(remoteDefinition) ? remoteDefinition[0] : remoteDefinition
    )
    .filter((r) => !remotesToSkip.has(r));

  const invalidStaticRemotes = staticRemotes.filter(
    (remote) => !workspaceProjects[remote]
  );
  if (invalidStaticRemotes.length) {
    throw new Error(
      invalidStaticRemotes.length === 1
        ? `Invalid static remote configured in "${pathToModuleFederationConfigFile}": ${invalidStaticRemotes[0]}.`
        : `Invalid static remotes configured in "${pathToModuleFederationConfigFile}": ${invalidStaticRemotes.join(
            ', '
          )}.`
    );
  }

  return staticRemotes;
}

export function validateDevRemotes(
  options: { devRemotes?: string[] },
  workspaceProjects: Record<string, ProjectConfiguration>
): void {
  const invalidDevRemotes = options.devRemotes?.filter(
    (remote) => !workspaceProjects[remote]
  );

  if (invalidDevRemotes.length) {
    throw new Error(
      invalidDevRemotes.length === 1
        ? `Invalid dev remote provided: ${invalidDevRemotes[0]}.`
        : `Invalid dev remotes provided: ${invalidDevRemotes.join(', ')}.`
    );
  }
}

export function resolveModuleFederationConfigFile(path: string): {
  remotes: Remotes;
} {
  tsNodeRegister(path);
  const mfeConfigFile = require(path);
  console.log('mfeConfigFile', mfeConfigFile);
  return mfeConfigFile.default ?? mfeConfigFile;
}

export function tsNodeRegister(file: string = '', tsConfig?: string) {
  if (!file?.endsWith('.ts')) return;

  // Avoid double-registering which can lead to issues type-checking already transformed files.
  if (isRegistered()) return;

  // Register TS compiler lazily
  require('ts-node').register({
    project: tsConfig,
    compilerOptions: {
      module: 'CommonJS',
      types: ['node'],
    },
  });

  // Register paths in tsConfig
  const tsconfigPaths = require('tsconfig-paths');
  const { absoluteBaseUrl: baseUrl, paths } =
    tsconfigPaths.loadConfig(tsConfig);
  if (baseUrl && paths) {
    tsconfigPaths.register({ baseUrl, paths });
  }
}

export function isRegistered() {
  return (
    require.extensions['.ts'] != undefined ||
    require.extensions['.tsx'] != undefined
  );
}
