export type CardSettingType = 'text' | 'number' | 'boolean' | 'select' | 'component';

export interface CardSettingOption {
  value: string;
  label: string;
}

export interface CardSettingDefinition {
  id: string;
  label: string;
  description?: string;
  type: CardSettingType;
  defaultValue: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: CardSettingOption[];
  componentTag?: string;
  requiresRefresh?: boolean;
}

export interface RegisteredCardSetting extends CardSettingDefinition {
  ownerCardId: string;
  serialize?: (element: HTMLElement) => unknown;
  deserialize?: (element: HTMLElement, value: unknown) => void;
}

const SETTING_ID_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/;
const definitions = new Map<string, RegisteredCardSetting>();
let settingValues: Record<string, unknown> = {};

function cloneValues(values: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(values)) as Record<string, unknown>;
}

export function initializeSettingsRegistry(values: Record<string, unknown>): void {
  settingValues = cloneValues(values);
  definitions.forEach(definition => {
    if (!Object.prototype.hasOwnProperty.call(settingValues, definition.id)) {
      settingValues[definition.id] = definition.defaultValue;
    }
  });
}

export function registerCardSetting(
  ownerCardId: string,
  definition: CardSettingDefinition,
  handlers?: Pick<RegisteredCardSetting, 'serialize' | 'deserialize'>,
): void {
  if (SETTING_ID_PATTERN.test(definition.id) === false) {
    throw new Error(`Invalid setting id "${definition.id}". Use dotted ids such as "card.weather.city".`);
  }
  if (definition.type === 'select' && (!definition.options || definition.options.length === 0)) {
    throw new Error(`Select setting "${definition.id}" must define at least one option.`);
  }
  if (definition.type === 'component' && !definition.componentTag) {
    throw new Error(`Component setting "${definition.id}" must define componentTag.`);
  }

  definitions.set(definition.id, {
    ...definition,
    ownerCardId,
    serialize: handlers ? handlers.serialize : undefined,
    deserialize: handlers ? handlers.deserialize : undefined,
  });

  if (!Object.prototype.hasOwnProperty.call(settingValues, definition.id)) {
    settingValues[definition.id] = definition.defaultValue;
  }

  window.dispatchEvent(new CustomEvent('setting-registered', { detail: { id: definition.id } }));
}

export function listRegisteredSettings(): RegisteredCardSetting[] {
  return Array.from(definitions.values()).sort((first, second) => first.id.localeCompare(second.id));
}

export function getSettingValue<T>(id: string, expectedDefault?: T): T {
  if (Object.prototype.hasOwnProperty.call(settingValues, id)) {
    return settingValues[id] as T;
  }
  if (expectedDefault !== undefined) return expectedDefault;
  throw new Error(`Setting "${id}" has not been registered or initialized.`);
}

export function getSettingsValues(): Record<string, unknown> {
  return cloneValues(settingValues);
}

export function commitSettingsValues(values: Record<string, unknown>): void {
  const previous = settingValues;
  settingValues = cloneValues(values);
  const changedIds = new Set([...Object.keys(previous), ...Object.keys(settingValues)]);
  changedIds.forEach(id => {
    if (JSON.stringify(previous[id]) !== JSON.stringify(settingValues[id])) {
      window.dispatchEvent(new CustomEvent('setting-changed', {
        detail: { id, value: settingValues[id] },
      }));
    }
  });
}

export function settingRequiresRefresh(id: string): boolean {
  return definitions.get(id)?.requiresRefresh === true;
}
