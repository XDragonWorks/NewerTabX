import {
  BootstrapConfig,
  buildDataApiUrl,
  getApiHeaders,
  getBootstrapConfig,
} from './config-service';

export interface EnvironmentRegistryEntry {
  value: string;
  description: string;
  secret: boolean;
  requestedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentRegistry {
  version: number;
  variables: Record<string, EnvironmentRegistryEntry>;
}

export interface EnvironmentRegistration {
  key: string;
  defaultValue?: string;
  description?: string;
  secret?: boolean;
  requestedBy: string;
}

export interface EnvironmentRegistrationResult {
  created: boolean;
  key: string;
  entry: EnvironmentRegistryEntry;
}

export function createEmptyEnvironmentRegistry(): EnvironmentRegistry {
  return { version: 1, variables: {} };
}

export async function fetchEnvironmentRegistry(
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<EnvironmentRegistry> {
  const response = await fetch(buildDataApiUrl('environment/registry', bootstrap), {
    headers: getApiHeaders(undefined, bootstrap),
  });
  if (!response.ok) {
    throw new Error(`Environment registry request returned HTTP ${response.status}`);
  }
  const registry = await response.json() as EnvironmentRegistry;
  if (!registry.variables || typeof registry.variables !== 'object') {
    throw new Error('Environment registry payload is invalid');
  }
  return registry;
}

export async function saveEnvironmentRegistry(
  registry: EnvironmentRegistry,
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<boolean> {
  const response = await fetch(buildDataApiUrl('environment/registry', bootstrap), {
    method: 'PUT',
    headers: getApiHeaders({ 'Content-Type': 'application/json' }, bootstrap),
    body: JSON.stringify(registry),
  });
  if (!response.ok) {
    console.warn(`[EnvironmentService] Registry save returned HTTP ${response.status}`);
    return false;
  }
  return true;
}

export async function registerEnvironmentVariable(
  registration: EnvironmentRegistration,
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<EnvironmentRegistrationResult> {
  const response = await fetch(buildDataApiUrl('environment/register', bootstrap), {
    method: 'POST',
    headers: getApiHeaders({ 'Content-Type': 'application/json' }, bootstrap),
    body: JSON.stringify({
      key: registration.key,
      defaultValue: registration.defaultValue !== undefined ? registration.defaultValue : '',
      description: registration.description !== undefined ? registration.description : '',
      secret: registration.secret !== false,
      requestedBy: registration.requestedBy,
    }),
  });
  if (!response.ok) {
    throw new Error(`Environment registration returned HTTP ${response.status}`);
  }
  return await response.json() as EnvironmentRegistrationResult;
}

export async function deleteEnvironmentVariable(
  key: string,
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<boolean> {
  const response = await fetch(buildDataApiUrl(`environment/${encodeURIComponent(key)}`, bootstrap), {
    method: 'DELETE',
    headers: getApiHeaders(undefined, bootstrap),
  });
  return response.ok;
}
