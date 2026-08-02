import { getIconSvg } from '../utils/icons';
import { escapeHtml, escapeHtmlAttribute } from '../utils/html';
import { applyPerformanceConfig, PerformanceConfig } from '../utils/performance';
import { applyAppearanceConfig, normalizeAccentColor } from '../utils/appearance';
import {
    AppUnifiedConfig,
    BootstrapConfig,
    DEFAULT_BOOTSTRAP_CONFIG,
    DEFAULT_HEADER_SCRIPT,
    HeaderPreset,
    HeaderOpenTarget,
    HeaderSuggestAction,
    fetchUnifiedConfig,
    getApiHeaders,
    buildApiUrl,
    getBootstrapConfig,
    saveBootstrapConfig,
    saveUnifiedConfig,
    syncBootstrapTheme,
} from '../services/config-service';
import {
    EnvironmentRegistry,
    createEmptyEnvironmentRegistry,
    fetchEnvironmentRegistry,
    saveEnvironmentRegistry,
} from '../services/environment-service';
import {
    commitSettingsValues,
    listRegisteredSettings,
    settingRequiresRefresh,
    CardSettingOption,
    RegisteredCardSetting,
} from '../services/settings-registry';
import {
    CardMetadata,
    deleteStoredCardBundle,
    ensureCardsLoaded,
    fetchCardIdList,
    getCardMetadata,
    unregisterCardModule,
} from '../services/card-registry';
import {
    DEFAULT_WALLPAPER_SCRIPT,
    applyWallpaper,
    previewWallpaper,
    updateWallpaperStyle,
    uploadWallpaperFile,
} from '../services/wallpaper-service';
import { CARD_AI_PROMPT_TEMPLATE } from './ui-prompt-modal';
import { showToast } from './ui-toast';
import type { UIDrawer } from './ui-drawer';
import type { UIModal } from './ui-modal';
import type { UIInput } from './ui-input';
import type { UISelect } from './ui-select';
import type { UIToggle } from './ui-toggle';
import type { UICodeEditor } from './ui-code-editor';
import type { UIDeployModal } from './ui-deploy-modal';
import type { UICustomHeader } from './ui-custom-header';
import type { UIGridDashboard } from '../layout/grid-dashboard';
import type { CardLayoutItem } from '../layout/grid-packer';

type SettingsTab = 'header' | 'cards' | 'card-settings' | 'environment' | 'appearance' | 'performance' | 'network';

const ENVIRONMENT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const ACCENT_PALETTE = ['#0078d4', '#4f6bed', '#8764b8', '#c239b3', '#d13438', '#ca5010', '#107c10', '#008272'];

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export class UISettingsModal extends HTMLElement {
    private shadow: ShadowRoot;
    private drawer: UIDrawer | null = null;
    private activeTab: SettingsTab = 'header';
    private initialConfig: AppUnifiedConfig | null = null;
    private draftConfig: AppUnifiedConfig | null = null;
    private initialBootstrap: BootstrapConfig = { ...DEFAULT_BOOTSTRAP_CONFIG };
    private draftBootstrap: BootstrapConfig = { ...DEFAULT_BOOTSTRAP_CONFIG };
    private initialEnvironment: EnvironmentRegistry = createEmptyEnvironmentRegistry();
    private draftEnvironment: EnvironmentRegistry = createEmptyEnvironmentRegistry();
    private environmentLoaded = false;
    private environmentDirty = false;
    private pendingDeletedDefinitions = new Set<string>();
    private availableCards: CardMetadata[] | null = null;
    private availableCardsLoading = false;
    private readonly handleCardDeployed = (event: Event): void => {
        if (this.initialConfig === null || this.draftConfig === null) return;
        const customEvent = event as CustomEvent<{
            cardId: string;
            instance: CardLayoutItem;
        }>;
        const { cardId, instance } = customEvent.detail;
        const metadata = getCardMetadata(cardId);
        if (metadata !== undefined && this.availableCards !== null
            && !this.availableCards.some(card => card.id === cardId)) {
            this.availableCards.push(metadata);
        }
        if (!this.initialConfig.cards.some(card => card.id === instance.id)) {
            this.initialConfig.cards.push({ ...instance });
        }
        if (!this.draftConfig.cards.some(card => card.id === instance.id)) {
            this.draftConfig.cards.push({ ...instance });
        }
        if (this.activeTab === 'cards') this.updateTabContent();
    };

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: 'open' });
    }

    connectedCallback(): void {
        window.addEventListener('card-deployed', this.handleCardDeployed);
        void this.loadState().then(() => this.render());
    }

    disconnectedCallback(): void {
        window.removeEventListener('card-deployed', this.handleCardDeployed);
    }

    public async open(): Promise<void> {
        await this.loadState();
        this.render();
        this.drawer?.open();
        requestAnimationFrame(() => this.updateIndicatorPosition(false));
    }

    public close(): void {
        this.drawer?.close();
    }

    private async loadState(): Promise<void> {
        this.initialBootstrap = getBootstrapConfig();
        this.draftBootstrap = { ...this.initialBootstrap };
        this.initialConfig = await fetchUnifiedConfig(this.initialBootstrap);
        this.draftConfig = deepClone(this.initialConfig);
        try {
            this.initialEnvironment = await fetchEnvironmentRegistry(this.initialBootstrap);
            this.environmentLoaded = true;
        } catch (error) {
            console.error('[Settings] Environment registry could not be loaded:', error);
            this.initialEnvironment = createEmptyEnvironmentRegistry();
            this.environmentLoaded = false;
            showToast({ message: '环境变量注册表加载失败', type: 'warning' });
        }
        this.draftEnvironment = deepClone(this.initialEnvironment);
        this.environmentDirty = false;
        this.pendingDeletedDefinitions.clear();
    }

    private isDirty(): boolean {
        if (this.initialConfig === null || this.draftConfig === null) return false;
        return JSON.stringify(this.initialConfig) !== JSON.stringify(this.draftConfig)
            || JSON.stringify(this.initialBootstrap) !== JSON.stringify(this.draftBootstrap)
            || JSON.stringify(this.initialEnvironment) !== JSON.stringify(this.draftEnvironment);
    }

    private render(): void {
        if (this.draftConfig === null) {
            this.shadow.innerHTML = '<p>设置正在加载...</p>';
            return;
        }

        this.shadow.innerHTML = `
      <style>
        :host { display: block; }
        .settings-layout { display: flex; height: calc(100vh - 48px); margin: -22px; box-sizing: border-box; }
        .sidebar-tabs {
          position: relative; width: 198px; flex-shrink: 0; display: flex; flex-direction: column;
          gap: 5px; padding: 16px 8px; /* border-right: 1px solid var(--color-card-border); */ box-sizing: border-box;
        }
        .tab-indicator {
          position: absolute; left: 4px; top: 0; width: 3px; height: 24px; border-radius: 2px;
          background: var(--color-accent-primary); pointer-events: none;
          transition: transform var(--duration-normal) var(--ease-fluent-standard), height var(--duration-normal) var(--ease-fluent-standard);
        }
        .tab-btn {
          display: flex; align-items: center; gap: 11px; padding: 9px 12px; border: none;
          border-radius: var(--radius-sm); background: transparent; color: var(--color-text-primary);
          font: inherit; font-size: 13.5px; cursor: pointer; text-align: left;
          transition: background-color var(--duration-fast) var(--ease-fluent-standard), color var(--duration-fast) var(--ease-fluent-standard);
        }
        .tab-btn:hover { background: color-mix(in srgb, var(--color-accent-primary) 8%, transparent); }
        .tab-btn.active { color: var(--color-accent-primary); background: color-mix(in srgb, var(--color-accent-primary) 10%, transparent); }
        .tab-icon { width: 18px; height: 18px; display: inline-flex; flex-shrink: 0; }
        .tab-icon svg { width: 100%; height: 100%; }
        .content-view { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 24px 28px; box-sizing: border-box; }
        .tab-body-list { display: flex; flex-direction: column; gap: 20px; overflow-y: auto; overflow-x: hidden; padding: 4px 36px 16px 10px; margin-right: -28px; box-sizing: border-box; }
        .tab-body-list::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .tab-body-list::-webkit-scrollbar-track {
          background: transparent;
        }

        .tab-body-list::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
          border-radius: 4px;
          transition: background-color var(--duration-fast) var(--ease-fluent-standard);
        }

        .tab-body-list::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.3);
        }

        :host-context([data-theme="dark"]) .tab-body-list::-webkit-scrollbar-thumb,
        :host([data-theme="dark"]) .tab-body-list::-webkit-scrollbar-thumb,
        [data-theme="dark"] .tab-body-list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
        }

        :host-context([data-theme="dark"]) .tab-body-list::-webkit-scrollbar-thumb:hover,
        :host([data-theme="dark"]) .tab-body-list::-webkit-scrollbar-thumb:hover,
        [data-theme="dark"] .tab-body-list::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .setting-item { display: flex; flex-direction: column; gap: 8px; }
        .setting-label { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
        .setting-desc { font-size: 12px; line-height: 1.55; color: var(--color-text-secondary); }
        .setting-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .panel-list { display: flex; flex-direction: column; gap: 10px; }
        .panel-card {
          display: flex; gap: 12px; justify-content: space-between; align-items: center; padding: 12px 14px;
          height: 64px; box-sizing: border-box;
          border: 1px solid var(--color-card-border); border-radius: var(--radius-sm);
          background: color-mix(in srgb, var(--color-card-bg) 86%, transparent);
        }
        .panel-card-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
        .panel-card-title { font-size: 13.5px; font-weight: 600; overflow-wrap: anywhere; }
        .panel-card-detail { position: relative; height: 1em; cursor: pointer; }
        .panel-card-detail.no-desc { height: 0; }
        .panel-card-detail-body {
          position: absolute; top: 0; left: 0; right: 0; z-index: 20;
          display: flex; flex-direction: column; gap: 4px;
          padding: 6px 8px; margin: -6px -8px; margin-top: -10px;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          background: transparent;
          transition: background-color var(--duration-normal) var(--ease-fluent-standard),
                      border-color var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard);
        }
        .panel-card-detail.detail-float .panel-card-detail-body {
          background: var(--color-surface-acrylic);
          -webkit-backdrop-filter: blur(var(--blur-acrylic)) saturate(140%);
          backdrop-filter: blur(var(--blur-acrylic)) saturate(140%);
          border-color: var(--color-card-border);
          box-shadow: var(--shadow-fluent-modal);
        }
        .panel-card-desc {
          display: block; font-size: 12px; color: var(--color-text-secondary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-height: 1.5em;
          transition: max-height var(--duration-normal) var(--ease-fluent-standard), white-space 0s;
        }
        .panel-card-detail.detail-float .panel-card-desc {
          white-space: normal; overflow-wrap: anywhere; max-height: 12em;
        }
        .panel-card-id {
          display: block; font-size: 11px; color: var(--color-text-secondary);
          font-family: var(--font-mono, "Segoe UI Mono", Consolas, monospace);
          max-height: 0; opacity: 0; overflow: hidden; overflow-wrap: anywhere;
          transition: max-height var(--duration-normal) var(--ease-fluent-standard),
                      opacity var(--duration-normal) var(--ease-fluent-standard);
        }
        .panel-card-detail.detail-float .panel-card-id { max-height: 1.5em; opacity: 1; }
        .panel-card-icon { width: 28px; height: 28px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--color-accent-primary); }
        .panel-card-icon svg { width: 22px; height: 22px; }
        .panel-card-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
        .badge { display: inline-flex; width: fit-content; padding: 2px 7px; border-radius: 999px; font-size: 10.5px; color: var(--color-accent-primary); background: color-mix(in srgb, var(--color-accent-primary) 12%, transparent); }
        .env-grid { display: grid; grid-template-columns: minmax(130px, 0.7fr) minmax(180px, 1.3fr); gap: 10px 14px; align-items: center; }

        .card-settings-container { display: flex; flex-direction: column; gap: 24px; width: 100%; box-sizing: border-box; }
        .card-setting-group { display: flex; flex-direction: column; gap: 14px; }
        .card-setting-group-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--color-text-primary);
          margin-left: -10px;
          margin-top: 10px;
          margin-bottom: 4px;
        }
        .card-setting-group-items { display: flex; flex-direction: column; gap: 18px; }
        .setting-desc-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
        }
        .setting-value-text {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
          font-family: var(--font-mono, "Segoe UI Mono", Consolas, monospace);
          margin-left: auto;
          flex-shrink: 0;
        }

        /* Fluent Design 2 浑然一体极简 Canvas List */
        .fluent-setting-page { display: flex; flex-direction: column; gap: 12px; width: 100%; box-sizing: border-box; }
        .fluent-page-header { display: flex; flex-direction: column; gap: 2px; }
        .fluent-page-title {
          font-family: "Segoe UI Variable Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 15px; font-weight: 600; color: var(--color-text-primary); letter-spacing: -0.2px;
        }
        .fluent-page-subtitle { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; }
        .fluent-list-group {
          display: flex; flex-direction: column;
          width: 100%;
        }
        .fluent-grid-head {
          display: grid;
          grid-template-columns: minmax(160px, 1.2fr) minmax(200px, 2fr) 60px;
          gap: 16px; align-items: center; padding: 6px 8px;
          font-size: 12px; font-weight: 600; color: var(--color-text-secondary);
          user-select: none;
        }
        .fluent-grid-row {
          display: grid;
          grid-template-columns: minmax(160px, 1.2fr) minmax(200px, 2fr) 60px;
          gap: 16px; align-items: center; padding: 6px 8px;
          border-radius: var(--radius-sm, 4px);
          background: transparent;
          transition: background-color var(--duration-fast, 0.15s) var(--ease-fluent-standard);
        }
        .fluent-grid-row:hover {
          background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
        }
        .fluent-key-text {
          font-family: var(--font-mono, "Segoe UI Mono", "Cascadia Code", Consolas, monospace);
          font-size: 13px; font-weight: 600;
          color: var(--color-text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .fluent-source-text {
          font-size: 12px; color: var(--color-text-secondary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .fluent-col { min-width: 0; display: flex; align-items: center; }
        .fluent-col-right { justify-content: flex-end; }
        .fluent-col ui-input { width: 100%; }
        .empty-state .empty-icon { display: flex; justify-content: center; align-items: center; width: 40px; height: 40px; margin: 0 auto 8px; border-radius: 50%; background: color-mix(in srgb, var(--color-accent-primary) 10%, transparent); color: var(--color-accent-primary); }
        .empty-state .empty-icon svg { width: 20px; height: 20px; }

        .palette { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding: 6px 2px; }
        .palette-button {
          position: relative; width: 32px; height: 32px; padding: 0; border-radius: 50%; border: 2px solid transparent;
          cursor: pointer; box-shadow: 0 0 0 1px var(--color-card-border);
          transition: transform var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard),
                      border-color var(--duration-normal) var(--ease-fluent-standard);
          outline: none; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background: transparent;
        }
        .palette-button:hover { transform: scale(1.08); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22); z-index: 2; }
        .palette-button:active { transform: scale(0.92); }
        .palette-button.active {
          transform: scale(1.08);
          box-shadow: 0 0 0 2.5px var(--color-card-bg),
                      0 0 0 5px var(--color-accent-primary),
                      0 4px 12px rgba(0, 0, 0, 0.18);
          z-index: 1;
        }
        .swatch-check {
          display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #ffffff;
          opacity: 0; transform: scale(0.3) rotate(-15deg);
          transition: transform var(--duration-normal) var(--ease-fluent-standard),
                      opacity var(--duration-normal) var(--ease-fluent-standard);
          pointer-events: none;
        }
        .swatch-check svg { width: 14px; height: 14px; stroke: #ffffff; stroke-width: 2.8px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45)); }
        .palette-button.active .swatch-check,
        .native-color-wrapper.active .swatch-check { opacity: 1; transform: scale(1) rotate(0deg); }
        .native-color-wrapper {
          position: relative; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
          border-radius: 50%; cursor: pointer; box-shadow: 0 0 0 1px var(--color-card-border);
          transition: transform var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard);
          overflow: hidden; flex-shrink: 0;
          background: conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
        }
        .native-color-wrapper:hover { transform: scale(1.08); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22); z-index: 2; }
        .native-color-wrapper:active { transform: scale(0.92); }
        .native-color-wrapper.active {
          transform: scale(1.08);
          box-shadow: 0 0 0 2.5px var(--color-card-bg),
                      0 0 0 5px var(--color-accent-primary),
                      0 4px 12px rgba(0, 0, 0, 0.18);
          z-index: 1;
        }
        .native-color { position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; border: none; cursor: pointer; opacity: 0; }
        .empty-state { padding: 24px; text-align: center; color: var(--color-text-secondary); border: 1px dashed var(--color-card-border); border-radius: var(--radius-sm); }
        .drawer-footer-actions { display: flex; gap: 12px; justify-content: flex-end; padding-top: 18px; margin-top: auto; /* border-top: 1px solid var(--color-card-border); */ }
        input[type="file"] { display: none; }
        @media (max-width: 720px) {
          .sidebar-tabs { width: 160px; }
          .env-add-grid { grid-template-columns: 1fr; }
          .env-table-header { display: none; }
          .env-table-row { grid-template-columns: 1fr; gap: 8px; padding: 12px; }
          .env-action-cell { justify-content: flex-start; }
          .panel-card { flex-direction: column; }
          .panel-card-actions { justify-content: flex-start; }
        }
      </style>

      <ui-drawer id="inner-settings-drawer" title="全局偏好与系统设置" placement="right" width="min(840px, 96vw)">
        <div class="settings-layout">
          <nav class="sidebar-tabs" aria-label="设置分类">
            <div class="tab-indicator"></div>
            ${this.renderTabButton('header', 'layout', '页首 Header')}
            ${this.renderTabButton('cards', 'grid', '卡片与插件')}
            ${this.renderTabButton('card-settings', 'sliders', '卡片设置')}
            ${this.renderTabButton('environment', 'key', '环境变量')}
            ${this.renderTabButton('appearance', 'palette', '外观与壁纸')}
            ${this.renderTabButton('performance', 'zap', '性能与渲染')}
            ${this.renderTabButton('network', 'globe', '连接与后端')}
          </nav>
          <section class="content-view">
            <div class="tab-body-list">${this.getTabHtml(this.activeTab)}</div>
            <div class="drawer-footer-actions">
              <ui-button id="btn-settings-cancel">取消</ui-button>
              <ui-button variant="primary" id="btn-settings-save" icon="save">保存设置</ui-button>
            </div>
          </section>
        </div>
      </ui-drawer>
    `;

        this.drawer = this.shadow.querySelector('#inner-settings-drawer') as UIDrawer | null;
        this.drawer?.addEventListener('attempt-close', event => {
            if (this.isDirty()) {
                event.preventDefault();
                this.showUnsavedModal();
            }
        });
        this.shadow.querySelectorAll('.tab-btn').forEach(button => {
            button.addEventListener('click', () => {
                const requestedTab = button.getAttribute('data-tab') as SettingsTab | null;
                if (requestedTab === null || requestedTab === this.activeTab) return;
                this.activeTab = requestedTab;
                this.updateTabContent();
                this.shadow.querySelectorAll('.tab-btn').forEach(tabButton => tabButton.classList.toggle('active', tabButton === button));
                this.updateIndicatorPosition(true);
            });
        });
        this.shadow.querySelector('#btn-settings-cancel')?.addEventListener('click', () => {
            if (this.isDirty()) {
                this.showUnsavedModal();
            } else {
                this.revertPreview();
                this.close();
            }
        });
        this.shadow.querySelector('#btn-settings-save')?.addEventListener('click', () => void this.saveCurrentSettings());
        this.bindTabEvents();
        requestAnimationFrame(() => this.updateIndicatorPosition(false));
    }

    private renderTabButton(tab: SettingsTab, icon: Parameters<typeof getIconSvg>[0], label: string): string {
        return `
      <button class="tab-btn ${this.activeTab === tab ? 'active' : ''}" data-tab="${tab}">
        <span class="tab-icon">${getIconSvg(icon)}</span><span>${label}</span>
      </button>
    `;
    }

    private updateIndicatorPosition(animate: boolean): void {
        const activeButton = this.shadow.querySelector(`.tab-btn[data-tab="${this.activeTab}"]`) as HTMLElement | null;
        const indicator = this.shadow.querySelector('.tab-indicator') as HTMLElement | null;
        const sidebar = this.shadow.querySelector('.sidebar-tabs') as HTMLElement | null;
        if (activeButton === null || indicator === null || sidebar === null) return;
        const buttonRect = activeButton.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        indicator.style.transition = animate
            ? 'transform var(--duration-normal) var(--ease-fluent-standard), height var(--duration-normal) var(--ease-fluent-standard)'
            : 'none';
        indicator.style.transform = `translate(8px, ${buttonRect.top - sidebarRect.top + 7}px)`;
        indicator.style.height = `${Math.max(18, buttonRect.height - 14)}px`;
    }

    private updateTabContent(): void {
        const body = this.shadow.querySelector('.tab-body-list');
        if (body === null) return;
        body.innerHTML = this.getTabHtml(this.activeTab);
        this.bindTabEvents();
    }

    private getTabHtml(tab: SettingsTab): string {
        if (this.draftConfig === null) return '';
        if (tab === 'header') return this.getHeaderTabHtml();
        if (tab === 'cards') return this.getCardsTabHtml();
        if (tab === 'card-settings') return this.getCardSettingsTabHtml();
        if (tab === 'environment') return this.getEnvironmentTabHtml();
        if (tab === 'appearance') return this.getAppearanceTabHtml();
        if (tab === 'performance') return this.getPerformanceTabHtml();
        return this.getNetworkTabHtml();
    }

    private getHeaderTabHtml(): string {
        if (this.draftConfig === null) return '';
        const header = this.draftConfig.header;
        return `
      <div class="fluent-setting-page">
        <div class="fluent-page-header">
          <div class="fluent-page-title">页首 Header 设置</div>
          <div class="fluent-page-subtitle">自定义主界面顶部 Header 的显示模式、默认搜索引擎及脚本扩展。</div>
        </div>

        <div class="setting-item">
          <label class="setting-label">Header 内容预设</label>
          <span class="setting-desc">类似于背景图设置，你可以为 Header 选择不同预设（时间、快捷搜索框、时间+搜索框、自定义脚本或隐藏）。</span>
          <ui-select id="select-header-preset">
            <option value="clock">时间与日期</option>
            <option value="search">快捷搜索框</option>
            <option value="clock_search">时间 + 快捷搜索框</option>
            <option value="script">自定义脚本</option>
            <option value="none">隐藏 Header 内容</option>
          </ui-select>
        </div>

        ${(header.preset === 'search' || header.preset === 'clock_search') ? `
          <div class="setting-item">
            <label class="setting-label">默认搜索引擎</label>
            <ui-select id="select-header-engine">
              <option value="bing">Bing 必应</option>
              <option value="google">Google 谷歌</option>
              <option value="baidu">Baidu 百度</option>
              <option value="duckduckgo">DuckDuckGo</option>
            </ui-select>
          </div>
          <div class="setting-item">
            <label class="setting-label">搜索结果打开方式</label>
            <span class="setting-desc">指定搜索目标页面是在新标签页打开还是在当前页面直接打开。</span>
            <ui-select id="select-header-target">
              <option value="_blank">新标签页打开</option>
              <option value="_self">当前页面打开</option>
            </ui-select>
          </div>
          <div class="setting-item">
            <label class="setting-label">点击搜索建议项时的行为</label>
            <span class="setting-desc">设置点击下拉建议列表中的关键词是直接跳转搜索，还是仅填充至搜索框。</span>
            <ui-select id="select-header-suggest-action">
              <option value="search">直接搜索该内容</option>
              <option value="fill">仅填充到搜索框</option>
            </ui-select>
          </div>
        ` : ''}

        ${header.preset === 'script' ? `
          <div class="setting-item">
            <label class="setting-label">Header 自定义脚本</label>
            <span class="setting-desc">使用 JavaScript 对 container (HTMLElement) 进行自定义渲染与逻辑绑定，支持返回清理函数 cleanup()。</span>
            <ui-code-editor id="header-script-editor" height="240px"></ui-code-editor>
          </div>
        ` : ''}
      </div>
    `;
    }

    private renderCardIcon(icon: string): string {
        // icon 可能是内置图标名称,也可能是已通过安全校验的内联 SVG
        const svg = icon.trimStart().startsWith('<svg') ? icon : getIconSvg(icon as Parameters<typeof getIconSvg>[0]);
        return `<span class="panel-card-icon">${svg}</span>`;
    }

    private async loadAvailableCards(): Promise<void> {
        if (this.availableCardsLoading) return;
        this.availableCardsLoading = true;
        try {
            const cardIds = await fetchCardIdList(this.draftBootstrap);
            await ensureCardsLoaded(cardIds, this.draftBootstrap);
            this.availableCards = cardIds
                .map(id => getCardMetadata(id))
                .filter((metadata): metadata is CardMetadata => metadata !== undefined);
        } catch (error) {
            console.error('[Settings] Card list could not be loaded:', error);
            this.availableCards = [];
            showToast({ message: '卡片列表加载失败，请检查后端连接', type: 'warning' });
        } finally {
            this.availableCardsLoading = false;
        }
        if (this.activeTab === 'cards') this.updateTabContent();
    }

    private getCardsTabHtml(): string {
        if (this.draftConfig === null) return '';
        if (this.availableCards === null) {
            void this.loadAvailableCards();
        }
        const cards = this.availableCards;
        return `
      <div class="setting-item">
        <label class="setting-label">布局编辑模式</label>
        <span class="setting-desc">点击下方按钮将关闭设置并直接在主界面拖拽卡片、调整大小或移至顶部删除。完成编辑后点击主界面右上角打勾按钮保存。</span>
        <div class="setting-row">
          <ui-button id="btn-enter-edit-mode" variant="primary" icon="layout">进入编辑布局模式</ui-button>
        </div>
      </div>
      <div class="setting-item">
        <label class="setting-label">卡片库</label>
        <div class="setting-row">
          <ui-button id="btn-deploy-card" variant="primary" icon="plus">部署卡片</ui-button>
          <ui-button id="btn-copy-card-prompt" icon="copy">复制 AI Prompt</ui-button>
        </div>
        <div class="panel-list">
          ${cards === null ? '<div class="empty-state">正在加载卡片列表...</div>' : ''}
          ${cards !== null && cards.length === 0 ? '<div class="empty-state">还没有卡片。点击“部署卡片”添加你的第一个卡片。</div>' : ''}
          ${(cards || []).map(card => `
            <article class="panel-card">
              ${this.renderCardIcon(card.icon)}
              <div class="panel-card-main">
                <span class="panel-card-title">${escapeHtml(card.name)}</span>
                <div class="panel-card-detail${card.description === '' ? ' no-desc' : ''}">
                  <div class="panel-card-detail-body">
                    ${card.description !== '' ? `<span class="panel-card-desc">${escapeHtml(card.description)}</span>` : ''}
                    <span class="panel-card-id">ID: ${escapeHtml(card.id)}</span>
                  </div>
                </div>
              </div>
              <div class="panel-card-actions">
                <ui-button class="btn-add-card-instance" data-definition-id="${escapeHtmlAttribute(card.id)}" icon="plus">添加实例</ui-button>
                <ui-button class="btn-delete-card-definition" data-definition-id="${escapeHtmlAttribute(card.id)}" variant="danger" icon="trash">删除卡片</ui-button>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    `;
    }

    private getCardSettingsTabHtml(): string {
        if (this.draftConfig === null) return '';
        const draftConfig = this.draftConfig;
        const registered = listRegisteredSettings();
        if (registered.length === 0) {
            return '<div class="empty-state">当前没有卡片注册全局设置。</div>';
        }

        const groups = new Map<string, { title: string; settings: RegisteredCardSetting[] }>();
        registered.forEach(setting => {
            const ownerId = setting.ownerCardId;
            let group = groups.get(ownerId);
            if (group === undefined) {
                const metadata = getCardMetadata(ownerId);
                const title = metadata !== undefined ? metadata.name : ownerId;
                group = { title, settings: [] };
                groups.set(ownerId, group);
            }
            group.settings.push(setting);
        });

        const groupsHtml = Array.from(groups.values()).map(group => {
            const settingsHtml = group.settings.map(setting => {
                const descriptionSpan = (setting.description !== undefined && setting.description !== '')
                    ? `<span class="setting-desc">${escapeHtml(setting.description)}</span>`
                    : '<span></span>';
                const value = Object.prototype.hasOwnProperty.call(draftConfig.settings, setting.id)
                    ? draftConfig.settings[setting.id]
                    : setting.defaultValue;

                let control = '';
                let valueText = '';
                const unitStr = (setting.unit !== undefined && setting.unit !== null) ? setting.unit : '';

                if (setting.type === 'text') {
                    control = `<ui-input class="registered-setting-control" data-setting-id="${escapeHtmlAttribute(setting.id)}"></ui-input>`;
                } else if (setting.type === 'number') {
                    const numericValue = typeof value === 'number' ? value : Number(setting.defaultValue);
                    const minVal = setting.min !== undefined ? setting.min : 0;
                    const maxVal = setting.max !== undefined ? setting.max : 100;
                    const stepVal = setting.step !== undefined ? setting.step : 1;
                    const finalVal = Number.isFinite(numericValue) ? numericValue : 0;
                    valueText = `<span class="setting-value-text" data-value-text-id="${escapeHtmlAttribute(setting.id)}" data-unit="${escapeHtmlAttribute(unitStr)}">${finalVal}${escapeHtml(unitStr)}</span>`;
                    control = `<ui-slider class="registered-setting-control" data-setting-id="${escapeHtmlAttribute(setting.id)}" min="${minVal}" max="${maxVal}" step="${stepVal}" value="${finalVal}" unit="${escapeHtmlAttribute(unitStr)}"></ui-slider>`;
                } else if (setting.type === 'boolean') {
                    control = `<ui-toggle class="registered-setting-control" data-setting-id="${escapeHtmlAttribute(setting.id)}" ${value === true ? 'checked' : ''}></ui-toggle>`;
                } else if (setting.type === 'select') {
                    const optionsList = setting.options !== undefined ? setting.options : [];
                    control = `
              <ui-select class="registered-setting-control" data-setting-id="${escapeHtmlAttribute(setting.id)}">
                ${optionsList.map((option: CardSettingOption) => `<option value="${escapeHtmlAttribute(option.value)}">${escapeHtml(option.label)}</option>`).join('')}
              </ui-select>
            `;
                } else {
                    control = `<div class="registered-setting-component" data-setting-id="${escapeHtmlAttribute(setting.id)}"></div>`;
                }

                return `
            <div class="setting-item">
              <label class="setting-label">${escapeHtml(setting.label)}</label>
              <div class="setting-desc-row">
                ${descriptionSpan}
                ${valueText}
              </div>
              ${control}
            </div>
          `;
            }).join('');

            return `
          <div class="card-setting-group">
            <div class="card-setting-group-title">${escapeHtml(group.title)}</div>
            <div class="card-setting-group-items">
              ${settingsHtml}
            </div>
          </div>
        `;
        }).join('');

        return `<div class="card-settings-container">${groupsHtml}</div>`;
    }

    private getEnvironmentTabHtml(): string {
        const entries = Object.entries(this.draftEnvironment.variables).sort(([first], [second]) => first.localeCompare(second));
        return `
      <div class="fluent-setting-page">
        ${this.environmentLoaded ? '' : '<div class="empty-state">注册表暂时无法读取。未修改环境变量时，保存其他设置不会覆盖后端注册表。</div>'}
        <div class="fluent-page-header">
          <div class="fluent-page-title">环境变量注册表</div>
          <div class="fluent-page-subtitle">管理本地系统及卡片组件的 API 密钥与环境变量。修改后保存生效。</div>
        </div>

        <div class="fluent-list-group">
          <div class="fluent-grid-head">
            <div>变量名</div>
            <div>变量值</div>
            <div style="text-align: right;">操作</div>
          </div>
          <div class="fluent-grid-body">
            ${entries.map(([key]) => `
              <div class="fluent-grid-row" data-env-key="${escapeHtmlAttribute(key)}">
                <div class="fluent-col">
                  <span class="fluent-key-text" title="${escapeHtmlAttribute(key)}">${escapeHtml(key)}</span>
                </div>
                <div class="fluent-col">
                  <ui-input class="env-value-input" type="password" placeholder="未设置变量值"></ui-input>
                </div>
                <div class="fluent-col fluent-col-right">
                  <ui-button class="btn-delete-env" variant="danger" icon="trash" title="删除环境变量"></ui-button>
                </div>
              </div>
            `).join('')}

            <!-- 底部内联新增行 -->
            <div class="fluent-grid-row fluent-add-row">
              <div class="fluent-col">
                <ui-input id="new-env-key" placeholder="新建变量名 (大写)"></ui-input>
              </div>
              <div class="fluent-col">
                <ui-input id="new-env-value" type="password" placeholder="新建变量值"></ui-input>
              </div>
              <div class="fluent-col fluent-col-right">
                <ui-button id="btn-add-environment" variant="primary" icon="plus" title="添加新变量"></ui-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    }

    private getAppearanceTabHtml(): string {
        if (this.draftConfig === null) return '';
        const appearance = this.draftConfig.appearance;
        const wallpaper = this.draftConfig.wallpaper;
        return `
      <div class="setting-item">
        <label class="setting-label">明暗主题</label>
        <div class="setting-row">
          <ui-button class="theme-button" data-theme-value="system" variant="${this.draftConfig.theme === 'system' ? 'primary' : 'standard'}" icon="settings">跟随系统</ui-button>
          <ui-button class="theme-button" data-theme-value="light" variant="${this.draftConfig.theme === 'light' ? 'primary' : 'standard'}" icon="sun">亮色</ui-button>
          <ui-button class="theme-button" data-theme-value="dark" variant="${this.draftConfig.theme === 'dark' ? 'primary' : 'standard'}" icon="moon">暗色</ui-button>
        </div>
      </div>
      <div class="setting-item">
        <label class="setting-label">主题强调色</label>
        <ui-toggle id="toggle-wallpaper-accent" label="从壁纸采样强调色" ${appearance.useWallpaperAccent ? 'checked' : ''}></ui-toggle>
        <div class="palette">
          ${ACCENT_PALETTE.map(color => `<button class="palette-button ${normalizeAccentColor(appearance.accentColor) === color ? 'active' : ''}" data-color="${color}" style="background:${color}" aria-label="${color}"><span class="swatch-check">${getIconSvg('check')}</span></button>`).join('')}
          <div class="native-color-wrapper ${!ACCENT_PALETTE.includes(normalizeAccentColor(appearance.accentColor)) ? 'active' : ''}">
            <input class="native-color" id="custom-accent-color" type="color" value="${normalizeAccentColor(appearance.accentColor)}" aria-label="自定义强调色" title="自定义强调色" />
            <span class="swatch-check">${getIconSvg('check')}</span>
          </div>
        </div>
      </div>
      <div class="setting-item">
        <ui-slider id="slider-radius" label="全局圆角" min="4" max="24" value="${appearance.radius}" unit="px"></ui-slider>
        <ui-slider id="slider-card-width" label="基础卡片宽度" min="220" max="420" step="10" value="${appearance.cardMinWidth}" unit="px"></ui-slider>
        <ui-slider id="slider-card-height" label="基础卡片高度" min="180" max="380" step="10" value="${appearance.cardRowHeight}" unit="px"></ui-slider>
      </div>
      <div class="setting-item">
        <label class="setting-label">壁纸来源</label>
        <ui-select id="select-wallpaper-source">
          <option value="bing">Bing 每日一图</option>
          <option value="url">图片 URL</option>
          <option value="video">视频 URL</option>
          <option value="upload">上传本地文件</option>
          <option value="script">脚本获取</option>
          <option value="color">纯色</option>
        </ui-select>
      </div>
      ${(wallpaper.source === 'url' || wallpaper.source === 'video') ? `
        <div class="setting-item"><label class="setting-label">壁纸 URL</label><ui-input id="input-wallpaper-url"></ui-input></div>
      ` : ''}
      ${wallpaper.source === 'script' ? `
        <div class="setting-item">
          <label class="setting-label">壁纸获取脚本</label>
          <span class="setting-desc">返回 { type, image, clickUrl, cacheExpire }。脚本属于本地可信代码。</span>
          <ui-code-editor id="wallpaper-script-editor" height="220px"></ui-code-editor>
        </div>
      ` : ''}
      ${wallpaper.source === 'upload' ? `
        <div class="setting-item">
          <input id="wallpaper-file-input" type="file" accept="image/*,video/*" />
          <ui-button id="btn-select-wallpaper-file" icon="image">选择图片或视频</ui-button>
        </div>
      ` : ''}
      <div class="setting-item">
        <ui-slider id="slider-wallpaper-blur" label="壁纸模糊" min="0" max="40" value="${wallpaper.blurRadius}" unit="px"></ui-slider>
        <ui-slider id="slider-wallpaper-mask" label="遮罩强度" min="0" max="80" value="${Math.round(wallpaper.maskOpacity * 100)}" unit="%"></ui-slider>
        <ui-slider id="slider-wallpaper-ttl" label="缓存时长" min="1" max="168" value="${wallpaper.ttlHours}" unit="小时"></ui-slider>
      </div>
    `;
    }

    private getPerformanceTabHtml(): string {
        if (this.draftConfig === null) return '';
        const performance = this.draftConfig.performance;
        return `
      <div class="setting-item">
        <label class="setting-label">性能预设</label>
        <ui-select id="select-performance-preset" value="${performance.preset}">
          <option value="high">高性能</option>
          <option value="medium">平衡</option>
          <option value="low">低性能</option>
          <option value="custom">自定义</option>
        </ui-select>
      </div>
      <div class="setting-item">
        <label class="setting-label">材质</label>
        <ui-select id="select-performance-material" value="${performance.material}">
          <option value="acrylic">亚克力</option>
          <option value="mica">云母</option>
          <option value="opaque">纯色</option>
        </ui-select>
      </div>
      <div class="setting-item">
        <ui-toggle id="toggle-performance-blur" label="卡片背景模糊" ${performance.enableBlur ? 'checked' : ''}></ui-toggle>
        <ui-toggle id="toggle-performance-overlay-blur" label="遮罩背景模糊" ${performance.enableOverlayBlur ? 'checked' : ''}></ui-toggle>
        <ui-toggle id="toggle-performance-shimmer" label="卡片动态高光" ${performance.enableShimmer ? 'checked' : ''}></ui-toggle>
        <ui-toggle id="toggle-performance-flip" label="对话框有源动画" ${performance.enableFlipModal ? 'checked' : ''}></ui-toggle>
        <ui-toggle id="toggle-performance-flip-source" label="对话框组合动画（实验性）" ${performance.enableFlipSourceAnimation ? 'checked' : ''}></ui-toggle>
        <ui-slider id="slider-performance-blur" label="卡片模糊半径" min="0" max="40" value="${performance.blurRadius}" unit="px"></ui-slider>
        <ui-slider id="slider-performance-overlay-blur" label="遮罩模糊半径" min="0" max="20" value="${performance.overlayBlurRadius}" unit="px"></ui-slider>
      </div>
    `;
    }

    private getNetworkTabHtml(): string {
        return `
      <div class="setting-item">
        <label class="setting-label">后端 Base URL</label>
        <ui-input id="input-base-url"></ui-input>
      </div>
      <div class="setting-item">
        <label class="setting-label">数据 API 根路径</label>
        <ui-input id="input-data-root"></ui-input>
      </div>
      <div class="setting-item">
        <label class="setting-label">API Token（可选）</label>
        <ui-input id="input-api-token" type="password"></ui-input>
      </div>
      <div class="setting-item">
        <label class="setting-label">后端控制</label>
      </div>
      <div class="setting-item">
        <ui-toggle id="toggle-backend-autostart" label="开机自启动" disabled></ui-toggle>
      </div>
      <div class="setting-item">
        <div style="display: flex; gap: 12px;">
          <ui-button id="btn-backend-restart" icon="refresh">重启后端</ui-button>
          <ui-button id="btn-backend-shutdown" icon="x">关闭后端</ui-button>
          <ui-button id="btn-backend-update-check" icon="globe">检查更新</ui-button>
        </div>
      </div>
      <div class="setting-item">
        <span class="setting-desc" id="backend-status-desc">正在读取后端状态…</span>
      </div>
    `;
    }

    private revertPreview(): void {
        if (this.initialConfig === null) return;
        syncBootstrapTheme(this.initialConfig.theme);
        applyAppearanceConfig(this.initialConfig.appearance);
        applyPerformanceConfig(this.initialConfig.performance);
        applyWallpaper(this.initialConfig.wallpaper);
        commitSettingsValues(this.initialConfig.settings);

        const dashboard = document.querySelector('#main-grid-dashboard') as UIGridDashboard | null;
        const header = document.querySelector('#main-custom-header') as UICustomHeader | null;
        dashboard?.setCards(this.initialConfig.cards);
        dashboard?.setAttribute('edit-mode', this.initialConfig.editMode ? 'true' : 'false');
        header?.setAttribute('edit-mode', this.initialConfig.editMode ? 'true' : 'false');
        header?.setHeaderConfig(this.initialConfig.header);
    }

    private bindTabEvents(): void {
        if (this.draftConfig === null) return;
        if (this.activeTab === 'header') this.bindHeaderTab();
        else if (this.activeTab === 'cards') this.bindCardsTab();
        else if (this.activeTab === 'card-settings') this.bindCardSettingsTab();
        else if (this.activeTab === 'environment') this.bindEnvironmentTab();
        else if (this.activeTab === 'appearance') this.bindAppearanceTab();
        else if (this.activeTab === 'performance') this.bindPerformanceTab();
        else this.bindNetworkTab();
    }

    private bindHeaderTab(): void {
        if (this.draftConfig === null) return;

        const updateHeaderPreview = () => {
            if (this.draftConfig === null) return;
            const customHeader = document.querySelector('#main-custom-header') as UICustomHeader | null;
            if (customHeader !== null) {
                customHeader.setHeaderConfig(this.draftConfig.header);
            }
        };

        const headerPresetSelect = this.shadow.querySelector('#select-header-preset') as UISelect | null;
        if (headerPresetSelect !== null) {
            headerPresetSelect.value = this.draftConfig.header.preset;
            headerPresetSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.preset = (event as CustomEvent<{ value: HeaderPreset }>).detail.value;
                updateHeaderPreview();
                this.updateTabContent();
            });
        }

        const headerEngineSelect = this.shadow.querySelector('#select-header-engine') as UISelect | null;
        if (headerEngineSelect !== null) {
            headerEngineSelect.value = this.draftConfig.header.searchEngine || 'bing';
            headerEngineSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.searchEngine = (event as CustomEvent<{ value: 'bing' | 'google' | 'baidu' | 'duckduckgo' }>).detail.value;
                updateHeaderPreview();
            });
        }

        const headerTargetSelect = this.shadow.querySelector('#select-header-target') as UISelect | null;
        if (headerTargetSelect !== null) {
            headerTargetSelect.value = this.draftConfig.header.openTarget || '_blank';
            headerTargetSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.openTarget = (event as CustomEvent<{ value: HeaderOpenTarget }>).detail.value as HeaderOpenTarget;
                updateHeaderPreview();
            });
        }

        const headerSuggestActionSelect = this.shadow.querySelector('#select-header-suggest-action') as UISelect | null;
        if (headerSuggestActionSelect !== null) {
            headerSuggestActionSelect.value = this.draftConfig.header.suggestAction || 'search';
            headerSuggestActionSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.suggestAction = (event as CustomEvent<{ value: HeaderSuggestAction }>).detail.value as HeaderSuggestAction;
                updateHeaderPreview();
            });
        }

        const headerScriptEditor = this.shadow.querySelector('#header-script-editor') as UICodeEditor | null;
        if (headerScriptEditor !== null) {
            let initialHeaderScript = DEFAULT_HEADER_SCRIPT;
            if (this.draftConfig.header.scriptCode && this.draftConfig.header.scriptCode.trim() !== '') {
                initialHeaderScript = this.draftConfig.header.scriptCode;
            }
            headerScriptEditor.value = initialHeaderScript;
            headerScriptEditor.addEventListener('input', () => {
                if (this.draftConfig !== null) {
                    this.draftConfig.header.scriptCode = headerScriptEditor.value;
                    updateHeaderPreview();
                }
            });
        }
    }

    private bindCardsTab(): void {
        if (this.draftConfig === null) return;
        this.shadow.querySelector('#btn-enter-edit-mode')?.addEventListener('click', () => {
            if (this.draftConfig === null) return;
            this.draftConfig.editMode = true;
            this.initialConfig = deepClone(this.draftConfig);
            void saveUnifiedConfig(this.draftConfig, true).catch(error => {
                console.warn('[Settings] Edit mode save failed:', error);
            });

            const dashboard = document.querySelector('#main-grid-dashboard') as UIGridDashboard | null;
            const customHeader = document.querySelector('#main-custom-header');
            dashboard?.setAttribute('edit-mode', 'true');
            customHeader?.setAttribute('edit-mode', 'true');

            this.close();
            showToast({ message: '进入布局编辑模式，点击右上角打勾按钮保存', type: 'info' });
        });
        this.shadow.querySelector('#btn-deploy-card')?.addEventListener('click', () => {
            const deployModal = document.querySelector('#card-deploy-modal') as UIDeployModal | null;
            deployModal?.open();
        });
        this.shadow.querySelector('#btn-copy-card-prompt')?.addEventListener('click', () => {
            navigator.clipboard.writeText(CARD_AI_PROMPT_TEMPLATE).then(() => {
                showToast({ message: 'AI Prompt 已复制', type: 'success' });
            }).catch(error => {
                console.error('[Settings] Prompt copy failed:', error);
                showToast({ message: '复制失败', type: 'warning' });
            });
        });
        // 描述区:hover 满 0.5s 展开,移出收回;点击立即展开/收回,
        // 点击收回后抑制 hover 再触发,挪出区域后重置
        this.shadow.querySelectorAll('.panel-card-detail').forEach(detail => {
            let openTimer: number | undefined;
            let suppressHover = false;
            detail.addEventListener('mouseenter', () => {
                window.clearTimeout(openTimer);
                if (suppressHover) return;
                openTimer = window.setTimeout(() => detail.classList.add('detail-float'), 500);
            });
            detail.addEventListener('mouseleave', () => {
                window.clearTimeout(openTimer);
                detail.classList.remove('detail-float');
                suppressHover = false;
            });
            detail.addEventListener('click', () => {
                window.clearTimeout(openTimer);
                if (detail.classList.contains('detail-float')) {
                    detail.classList.remove('detail-float');
                    suppressHover = true;
                } else {
                    detail.classList.add('detail-float');
                    suppressHover = false;
                }
            });
        });
        this.shadow.querySelectorAll('.btn-add-card-instance').forEach(button => {
            button.addEventListener('click', () => {
                if (this.draftConfig === null) return;
                const cardId = button.getAttribute('data-definition-id');
                if (cardId === null) return;
                const metadata = getCardMetadata(cardId);
                const title = metadata !== undefined ? metadata.name : cardId;

                const sourceRect = button.getBoundingClientRect();
                const newCardId = `card-${cardId}-${crypto.randomUUID().slice(0, 8)}`;
                const newCardItem = {
                    id: newCardId,
                    title,
                    w: 2,
                    h: 1,
                    type: cardId,
                    order: this.draftConfig.cards.length + 1,
                };

                this.draftConfig.cards.push(newCardItem);
                this.draftConfig.editMode = true;
                this.initialConfig = deepClone(this.draftConfig);

                void saveUnifiedConfig(this.draftConfig, true).catch(error => {
                    console.warn('[Settings] Card instance save failed:', error);
                });

                const dashboard = document.querySelector('#main-grid-dashboard') as UIGridDashboard | null;
                const customHeader = document.querySelector('#main-custom-header');

                if (dashboard !== null) {
                    dashboard.setCards(this.draftConfig.cards);
                    dashboard.setAttribute('edit-mode', 'true');
                    dashboard.animateNewCardFromSource(newCardId, sourceRect);
                }
                if (customHeader !== null) {
                    customHeader.setAttribute('edit-mode', 'true');
                }

                this.close();
                showToast({ message: `已添加卡片“${title}”并进入编辑模式，完成后点击右上角打勾保存`, type: 'info' });
            });
        });
        this.shadow.querySelectorAll('.btn-delete-card-definition').forEach(button => {
            button.addEventListener('click', () => {
                if (this.draftConfig === null) return;
                const cardId = button.getAttribute('data-definition-id');
                if (cardId === null) return;
                this.draftConfig.cards = this.draftConfig.cards.filter(card => card.type !== cardId);
                this.pendingDeletedDefinitions.add(cardId);
                if (this.availableCards !== null) {
                    this.availableCards = this.availableCards.filter(card => card.id !== cardId);
                }
                const dashboard = document.querySelector('#main-grid-dashboard') as UIGridDashboard | null;
                dashboard?.setCards(this.draftConfig.cards);
                this.updateTabContent();
            });
        });
    }

    private bindCardSettingsTab(): void {
        if (this.draftConfig === null) return;
        const draftConfig = this.draftConfig;
        const registered = listRegisteredSettings();
        registered.forEach(setting => {
            const selector = `[data-setting-id="${CSS.escape(setting.id)}"]`;
            const value = Object.prototype.hasOwnProperty.call(draftConfig.settings, setting.id)
                ? draftConfig.settings[setting.id]
                : setting.defaultValue;
            if (setting.type === 'text') {
                const input = this.shadow.querySelector(selector) as UIInput | null;
                if (input !== null) {
                    input.value = typeof value === 'string' ? value : String(value);
                    input.addEventListener('change', () => {
                        if (this.draftConfig !== null) {
                            this.draftConfig.settings[setting.id] = input.value;
                            commitSettingsValues(this.draftConfig.settings);
                        }
                    });
                    input.addEventListener('input', () => {
                        if (this.draftConfig !== null) {
                            this.draftConfig.settings[setting.id] = input.value;
                            commitSettingsValues(this.draftConfig.settings);
                        }
                    });
                }
            } else if (setting.type === 'number') {
                this.shadow.querySelector(selector)?.addEventListener('change', event => {
                    const newVal = (event as CustomEvent<{ value: number }>).detail.value;
                    if (this.draftConfig !== null) {
                        this.draftConfig.settings[setting.id] = newVal;
                        commitSettingsValues(this.draftConfig.settings);
                    }
                    const valTextNode = this.shadow.querySelector(`[data-value-text-id="${CSS.escape(setting.id)}"]`);
                    if (valTextNode !== null) {
                        const unitAttr = valTextNode.getAttribute('data-unit');
                        const unit = unitAttr !== null ? unitAttr : '';
                        valTextNode.textContent = `${newVal}${unit}`;
                    }
                });
            } else if (setting.type === 'boolean') {
                this.shadow.querySelector(selector)?.addEventListener('change', event => {
                    if (this.draftConfig !== null) {
                        this.draftConfig.settings[setting.id] = (event as CustomEvent<{ checked: boolean }>).detail.checked;
                        commitSettingsValues(this.draftConfig.settings);
                    }
                });
            } else if (setting.type === 'select') {
                const select = this.shadow.querySelector(selector) as UISelect | null;
                if (select !== null) {
                    select.value = typeof value === 'string' ? value : String(value);
                    select.addEventListener('change', event => {
                        if (this.draftConfig !== null) {
                            this.draftConfig.settings[setting.id] = (event as CustomEvent<{ value: string }>).detail.value;
                            commitSettingsValues(this.draftConfig.settings);
                        }
                    });
                }
            } else {
                const container = this.shadow.querySelector(selector);
                if (container !== null && setting.componentTag) {
                    const component = document.createElement(setting.componentTag);
                    container.appendChild(component);
                    setting.deserialize?.(component, value);
                    component.addEventListener('change', event => {
                        if (this.draftConfig === null) return;
                        this.draftConfig.settings[setting.id] = setting.serialize
                            ? setting.serialize(component)
                            : (event as CustomEvent<{ value: unknown }>).detail.value;
                        commitSettingsValues(this.draftConfig.settings);
                    });
                }
            }
        });
    }

    private bindEnvironmentTab(): void {
        this.shadow.querySelectorAll('.fluent-grid-row[data-env-key]').forEach(row => {
            const key = row.getAttribute('data-env-key');
            if (key === null) return;
            const entry = this.draftEnvironment.variables[key];
            if (entry === undefined) return;

            const valueInput = row.querySelector('.env-value-input') as UIInput;
            const deleteBtn = row.querySelector('.btn-delete-env');

            valueInput.value = entry.value;

            valueInput.addEventListener('change', () => {
                entry.value = valueInput.value;
                entry.updatedAt = new Date().toISOString();
                this.environmentDirty = true;
            });

            if (deleteBtn !== null) {
                deleteBtn.addEventListener('click', () => {
                    delete this.draftEnvironment.variables[key];
                    this.environmentDirty = true;
                    this.updateTabContent();
                });
            }
        });

        const btnAdd = this.shadow.querySelector('#btn-add-environment');
        if (btnAdd !== null) {
            btnAdd.addEventListener('click', () => {
                const keyInput = this.shadow.querySelector('#new-env-key') as UIInput;
                const valueInput = this.shadow.querySelector('#new-env-value') as UIInput;

                const key = keyInput.value.trim().toUpperCase();
                if (ENVIRONMENT_KEY_PATTERN.test(key) === false) {
                    showToast({ message: '环境变量 Key 格式不正确（必须为大写字母、数字或下划线）', type: 'warning' });
                    return;
                }
                if (this.draftEnvironment.variables[key] !== undefined) {
                    showToast({ message: '该环境变量已经存在', type: 'warning' });
                    return;
                }
                const now = new Date().toISOString();
                this.draftEnvironment.variables[key] = {
                    value: valueInput.value,
                    description: '',
                    secret: false,
                    requestedBy: ['manual'],
                    createdAt: now,
                    updatedAt: now,
                };
                this.environmentDirty = true;
                this.updateTabContent();
            });
        }
    }

    private bindAppearanceTab(): void {
        if (this.draftConfig === null) return;

        const updateHeaderPreview = () => {
            if (this.draftConfig === null) return;
            const customHeader = document.querySelector('#main-custom-header') as UICustomHeader | null;
            if (customHeader !== null) {
                customHeader.setHeaderConfig(this.draftConfig.header);
            }
        };

        const headerPresetSelect = this.shadow.querySelector('#select-header-preset') as UISelect | null;
        if (headerPresetSelect !== null) {
            headerPresetSelect.value = this.draftConfig.header.preset;
            headerPresetSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.preset = (event as CustomEvent<{ value: HeaderPreset }>).detail.value;
                updateHeaderPreview();
                this.updateTabContent();
            });
        }

        const headerEngineSelect = this.shadow.querySelector('#select-header-engine') as UISelect | null;
        if (headerEngineSelect !== null) {
            headerEngineSelect.value = this.draftConfig.header.searchEngine || 'bing';
            headerEngineSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.searchEngine = (event as CustomEvent<{ value: 'bing' | 'google' | 'baidu' | 'duckduckgo' }>).detail.value;
                updateHeaderPreview();
            });
        }

        const headerTargetSelect = this.shadow.querySelector('#select-header-target') as UISelect | null;
        if (headerTargetSelect !== null) {
            headerTargetSelect.value = this.draftConfig.header.openTarget || '_blank';
            headerTargetSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.openTarget = (event as CustomEvent<{ value: HeaderOpenTarget }>).detail.value as HeaderOpenTarget;
                updateHeaderPreview();
            });
        }

        const headerSuggestActionSelect = this.shadow.querySelector('#select-header-suggest-action') as UISelect | null;
        if (headerSuggestActionSelect !== null) {
            headerSuggestActionSelect.value = this.draftConfig.header.suggestAction || 'search';
            headerSuggestActionSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.header.suggestAction = (event as CustomEvent<{ value: HeaderSuggestAction }>).detail.value as HeaderSuggestAction;
                updateHeaderPreview();
            });
        }

        const headerScriptEditor = this.shadow.querySelector('#header-script-editor') as UICodeEditor | null;
        if (headerScriptEditor !== null) {
            let initialHeaderScript = DEFAULT_HEADER_SCRIPT;
            if (this.draftConfig.header.scriptCode && this.draftConfig.header.scriptCode.trim() !== '') {
                initialHeaderScript = this.draftConfig.header.scriptCode;
            }
            headerScriptEditor.value = initialHeaderScript;
            headerScriptEditor.addEventListener('input', () => {
                if (this.draftConfig !== null) {
                    this.draftConfig.header.scriptCode = headerScriptEditor.value;
                    updateHeaderPreview();
                }
            });
        }

        this.shadow.querySelectorAll('.theme-button').forEach(button => {
            button.addEventListener('click', () => {
                if (this.draftConfig === null) return;
                const theme = button.getAttribute('data-theme-value');
                if (theme === 'system' || theme === 'light' || theme === 'dark') {
                    this.draftConfig.theme = theme;
                    syncBootstrapTheme(theme);
                    this.updateTabContent();
                }
            });
        });
        this.shadow.querySelector('#toggle-wallpaper-accent')?.addEventListener('change', event => {
            if (this.draftConfig !== null) {
                this.draftConfig.appearance.useWallpaperAccent = (event as CustomEvent<{ checked: boolean }>).detail.checked;
                applyAppearanceConfig(this.draftConfig.appearance);
            }
        });
        this.shadow.querySelectorAll('.palette-button').forEach(button => {
            button.addEventListener('click', () => {
                if (this.draftConfig === null) return;
                const color = button.getAttribute('data-color');
                if (color !== null) {
                    this.draftConfig.appearance.accentColor = color;
                    applyAppearanceConfig(this.draftConfig.appearance);
                    this.updatePaletteActiveStates(color);
                }
            });
        });
        const customColor = this.shadow.querySelector('#custom-accent-color') as HTMLInputElement | null;
        customColor?.addEventListener('input', () => {
            if (this.draftConfig !== null) {
                const val = normalizeAccentColor(customColor.value);
                this.draftConfig.appearance.accentColor = val;
                applyAppearanceConfig(this.draftConfig.appearance);
                this.updatePaletteActiveStates(val);
            }
        });
        this.bindNumericDraft('#slider-radius', value => {
            if (this.draftConfig !== null) {
                this.draftConfig.appearance.radius = value;
                applyAppearanceConfig(this.draftConfig.appearance);
            }
        });
        this.bindNumericDraft('#slider-card-width', value => {
            if (this.draftConfig !== null) {
                this.draftConfig.appearance.cardMinWidth = value;
                applyAppearanceConfig(this.draftConfig.appearance);
            }
        });
        this.bindNumericDraft('#slider-card-height', value => {
            if (this.draftConfig !== null) {
                this.draftConfig.appearance.cardRowHeight = value;
                applyAppearanceConfig(this.draftConfig.appearance);
            }
        });

        const sourceSelect = this.shadow.querySelector('#select-wallpaper-source') as UISelect | null;
        if (sourceSelect !== null) {
            sourceSelect.value = this.draftConfig.wallpaper.source;
            sourceSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.wallpaper.source = (event as CustomEvent<{ value: AppUnifiedConfig['wallpaper']['source'] }>).detail.value;
                previewWallpaper(this.draftConfig.wallpaper, { executeScript: true });
                this.updateTabContent();
            });
        }
        const wallpaperUrl = this.shadow.querySelector('#input-wallpaper-url') as UIInput | null;
        if (wallpaperUrl !== null) {
            wallpaperUrl.value = this.draftConfig.wallpaper.url;
            const handleUrlChange = () => {
                if (this.draftConfig !== null) {
                    this.draftConfig.wallpaper.url = wallpaperUrl.value;
                    previewWallpaper(this.draftConfig.wallpaper);
                }
            };
            wallpaperUrl.addEventListener('change', handleUrlChange);
            wallpaperUrl.addEventListener('input', handleUrlChange);
        }
        const scriptEditor = this.shadow.querySelector('#wallpaper-script-editor') as UICodeEditor | null;
        if (scriptEditor !== null) {
            let initialScript = DEFAULT_WALLPAPER_SCRIPT;
            if (this.draftConfig.wallpaper.scriptCode !== undefined && this.draftConfig.wallpaper.scriptCode.trim() !== '') {
                initialScript = this.draftConfig.wallpaper.scriptCode;
            }
            scriptEditor.value = initialScript;
            scriptEditor.addEventListener('input', () => {
                if (this.draftConfig !== null) {
                    this.draftConfig.wallpaper.scriptCode = scriptEditor.value;
                }
            });
        }
        const fileInput = this.shadow.querySelector('#wallpaper-file-input') as HTMLInputElement | null;
        this.shadow.querySelector('#btn-select-wallpaper-file')?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
            if (file === null || this.draftConfig === null) return;
            void uploadWallpaperFile(file).then(uploaded => {
                if (this.draftConfig === null) return;
                this.draftConfig.wallpaper.url = uploaded.url;
                this.draftConfig.wallpaper.source = uploaded.type === 'video' ? 'video' : 'url';
                previewWallpaper(this.draftConfig.wallpaper);
                showToast({ message: '壁纸文件已上传预览，保存后持久生效', type: 'info' });
                this.updateTabContent();
            }).catch(error => {
                console.error('[Settings] Wallpaper upload failed:', error);
                showToast({ message: '壁纸上传失败', type: 'error' });
            });
        });
        this.bindNumericDraft('#slider-wallpaper-blur', value => {
            if (this.draftConfig !== null) {
                this.draftConfig.wallpaper.blurRadius = value;
                updateWallpaperStyle(value, this.draftConfig.wallpaper.maskOpacity);
            }
        });
        this.bindNumericDraft('#slider-wallpaper-mask', value => {
            if (this.draftConfig !== null) {
                const maskOpacity = value / 100;
                this.draftConfig.wallpaper.maskOpacity = maskOpacity;
                updateWallpaperStyle(this.draftConfig.wallpaper.blurRadius, maskOpacity);
            }
        });
        this.bindNumericDraft('#slider-wallpaper-ttl', value => {
            if (this.draftConfig !== null) {
                this.draftConfig.wallpaper.ttlHours = value;
            }
        });
    }

    private updatePaletteActiveStates(color: string): void {
        const normalized = normalizeAccentColor(color);
        let matchedInPalette = false;

        this.shadow.querySelectorAll('.palette-button').forEach(button => {
            const buttonColor = button.getAttribute('data-color');
            if (buttonColor === normalized) {
                button.classList.add('active');
                matchedInPalette = true;
            } else {
                button.classList.remove('active');
            }
        });

        const nativeWrapper = this.shadow.querySelector('.native-color-wrapper');
        if (nativeWrapper !== null) {
            if (!matchedInPalette) {
                nativeWrapper.classList.add('active');
            } else {
                nativeWrapper.classList.remove('active');
            }
        }
    }

    private bindPerformanceTab(): void {
        if (this.draftConfig === null) return;

        const presetSelect = this.shadow.querySelector('#select-performance-preset') as UISelect | null;
        const materialSelect = this.shadow.querySelector('#select-performance-material') as UISelect | null;

        const syncPresetSelect = (): void => {
            if (presetSelect !== null && presetSelect.value !== this.draftConfig!.performance.preset) {
                presetSelect.value = this.draftConfig!.performance.preset;
            }
        };
        const syncMaterialSelect = (): void => {
            if (materialSelect !== null && materialSelect.value !== this.draftConfig!.performance.material) {
                materialSelect.value = this.draftConfig!.performance.material;
            }
        };
        const markCustom = (): void => {
            if (this.draftConfig!.performance.preset !== 'custom') {
                this.draftConfig!.performance.preset = 'custom';
                syncPresetSelect();
            }
        };

        if (presetSelect !== null) {
            presetSelect.value = this.draftConfig.performance.preset;
            presetSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                const preset = (event as CustomEvent<{ value: PerformanceConfig['preset'] }>).detail.value;
                if (preset === 'custom') {
                    this.draftConfig.performance.preset = 'custom';
                    return;
                }
                const mappings: Record<string, PerformanceConfig> = {
                    high: { preset: 'high', material: 'acrylic', enableBlur: true, enableOverlayBlur: true, enableShimmer: true, enableFlipModal: true, enableFlipSourceAnimation: false, blurRadius: 16, overlayBlurRadius: 4 },
                    medium: { preset: 'medium', material: 'mica', enableBlur: true, enableOverlayBlur: true, enableShimmer: false, enableFlipModal: true, enableFlipSourceAnimation: false, blurRadius: 8, overlayBlurRadius: 2 },
                    low: { preset: 'low', material: 'opaque', enableBlur: false, enableOverlayBlur: false, enableShimmer: false, enableFlipModal: false, enableFlipSourceAnimation: false, blurRadius: 0, overlayBlurRadius: 0 }
                };
                const next = mappings[preset];
                if (next) {
                    this.draftConfig.performance = next;
                    applyPerformanceConfig(this.draftConfig.performance);
                    syncMaterialSelect();
                    const blurToggle = this.shadow.querySelector('#toggle-performance-blur') as UIToggle | null;
                    if (blurToggle !== null) blurToggle.checked = next.enableBlur;
                    const overlayBlurToggle = this.shadow.querySelector('#toggle-performance-overlay-blur') as UIToggle | null;
                    if (overlayBlurToggle !== null) overlayBlurToggle.checked = next.enableOverlayBlur;
                    const shimmerToggle = this.shadow.querySelector('#toggle-performance-shimmer') as UIToggle | null;
                    if (shimmerToggle !== null) shimmerToggle.checked = next.enableShimmer;
                    const flipToggle = this.shadow.querySelector('#toggle-performance-flip') as UIToggle | null;
                    if (flipToggle !== null) flipToggle.checked = next.enableFlipModal;
                    const flipSourceToggle = this.shadow.querySelector('#toggle-performance-flip-source') as UIToggle | null;
                    if (flipSourceToggle !== null) flipSourceToggle.checked = next.enableFlipSourceAnimation;
                    const blurSlider = this.shadow.querySelector('#slider-performance-blur');
                    if (blurSlider !== null) blurSlider.setAttribute('value', String(next.blurRadius));
                    const overlayBlurSlider = this.shadow.querySelector('#slider-performance-overlay-blur');
                    if (overlayBlurSlider !== null) overlayBlurSlider.setAttribute('value', String(next.overlayBlurRadius));
                }
            });
        }

        if (materialSelect !== null) {
            materialSelect.value = this.draftConfig.performance.material;
            materialSelect.addEventListener('change', event => {
                if (this.draftConfig === null) return;
                this.draftConfig.performance.material = (event as CustomEvent<{ value: PerformanceConfig['material'] }>).detail.value;
                applyPerformanceConfig(this.draftConfig.performance);
                markCustom();
            });
        }

        this.bindBooleanPerformance('#toggle-performance-blur', 'enableBlur', markCustom);
        this.bindBooleanPerformance('#toggle-performance-overlay-blur', 'enableOverlayBlur', markCustom);
        this.bindBooleanPerformance('#toggle-performance-shimmer', 'enableShimmer', markCustom);
        this.bindBooleanPerformance('#toggle-performance-flip', 'enableFlipModal', markCustom);
        this.bindBooleanPerformance('#toggle-performance-flip-source', 'enableFlipSourceAnimation', markCustom);
        this.bindNumericDraft('#slider-performance-blur', value => {
            if (this.draftConfig !== null) {
                this.draftConfig.performance.blurRadius = value;
                applyPerformanceConfig(this.draftConfig.performance);
                markCustom();
            }
        });
        this.bindNumericDraft('#slider-performance-overlay-blur', value => {
            if (this.draftConfig !== null) {
                this.draftConfig.performance.overlayBlurRadius = value;
                applyPerformanceConfig(this.draftConfig.performance);
                markCustom();
            }
        });
    }

    private bindBooleanPerformance(selector: string, key: 'enableBlur' | 'enableOverlayBlur' | 'enableShimmer' | 'enableFlipModal' | 'enableFlipSourceAnimation', markCustom: () => void): void {
        this.shadow.querySelector(selector)?.addEventListener('change', event => {
            if (this.draftConfig === null) return;
            this.draftConfig.performance[key] = (event as CustomEvent<{ checked: boolean }>).detail.checked;
            applyPerformanceConfig(this.draftConfig.performance);
            markCustom();
        });
    }

    private bindNumericDraft(selector: string, callback: (value: number) => void): void {
        this.shadow.querySelector(selector)?.addEventListener('change', event => {
            callback((event as CustomEvent<{ value: number }>).detail.value);
        });
    }

    private bindNetworkTab(): void {
        const baseUrlInput = this.shadow.querySelector('#input-base-url') as UIInput | null;
        const dataRootInput = this.shadow.querySelector('#input-data-root') as UIInput | null;
        const tokenInput = this.shadow.querySelector('#input-api-token') as UIInput | null;
        if (baseUrlInput !== null) {
            baseUrlInput.value = this.draftBootstrap.baseUrl;
            baseUrlInput.addEventListener('change', () => { this.draftBootstrap.baseUrl = baseUrlInput.value.trim(); });
        }
        if (dataRootInput !== null) {
            dataRootInput.value = this.draftBootstrap.dataRoot;
            dataRootInput.addEventListener('change', () => { this.draftBootstrap.dataRoot = dataRootInput.value.trim(); });
        }
        if (tokenInput !== null) {
            tokenInput.value = this.draftBootstrap.apiToken || '';
            tokenInput.addEventListener('change', () => { this.draftBootstrap.apiToken = tokenInput.value; });
        }
        void this.initBackendControls();
    }

    /** 后端进程控制：状态展示、开机自启动、重启与关闭。与配置草稿无关，立即生效 */
    private async initBackendControls(): Promise<void> {
        interface SystemInfo {
            dataRoot?: string;
            version?: string;
            updateRepoConfigured?: boolean;
            packaged?: boolean;
            autostartSupported?: boolean;
            autostartEnabled?: boolean;
            appToken?: string;
        }

        const desc = this.shadow.querySelector('#backend-status-desc') as HTMLElement | null;
        const autostartToggle = this.shadow.querySelector('#toggle-backend-autostart') as UIToggle | null;
        const restartButton = this.shadow.querySelector('#btn-backend-restart') as HTMLElement | null;
        const shutdownButton = this.shadow.querySelector('#btn-backend-shutdown') as HTMLElement | null;
        const updateCheckButton = this.shadow.querySelector('#btn-backend-update-check') as HTMLElement | null;

        let info: SystemInfo | null = null;
        try {
            const response = await fetch(buildApiUrl('system/info'), { headers: getApiHeaders() });
            if (response.ok) info = await response.json() as SystemInfo;
        } catch (error) {
            console.warn('[Settings] Failed to query backend system info:', error);
        }

        if (info === null || typeof info.appToken !== 'string' || info.appToken === '') {
            if (desc !== null) desc.textContent = '后端不可达';
            return;
        }
        const appToken = info.appToken;

        if (desc !== null) {
            desc.innerHTML = `
            版本: <span style="user-select: text;">${info.version ?? '未知'} (${info.packaged ? '发行版' : '开发版'})</span><br>
            数据目录: <span style="user-select: text;">${info.dataRoot ?? '未知'}</span><br>
            GitHub仓库: <a
                href="https://github.com/XDragonWorks/NewerTabX" target="_blank" rel="noopener"
                style="cursor: pointer; color:inherit; user-select: text; text-decoration: none; transition: color 0.3s;"
                onmouseover="this.style.color='var(--color-accent-primary)'"
                onmouseout="this.style.color='inherit'"
            >
                https://github.com/XDragonWorks/NewerTabX
            </a>`;
        }

        updateCheckButton?.addEventListener('click', () => void (async () => {
            interface UpdateCheckResult {
                currentVersion: string;
                latestVersion: string | null;
                updateAvailable: boolean;
                releaseUrl: string | null;
            }
            try {
                const response = await fetch(buildApiUrl('system/update/check'), {
                    headers: getApiHeaders({ 'X-App-Token': appToken }),
                });
                if (!response.ok) {
                    const detail = await response.text();
                    throw new Error(`HTTP ${response.status}: ${detail}`);
                }
                const result = await response.json() as UpdateCheckResult;
                if (result.updateAvailable && result.latestVersion !== null) {
                    showToast({ message: `发现新版本 ${result.latestVersion}（当前 ${result.currentVersion}）`, type: 'success' });
                    if (result.releaseUrl !== null) window.open(result.releaseUrl, '_blank', 'noopener');
                } else {
                    showToast({ message: `已是最新版本（${result.currentVersion}）`, type: 'info' });
                }
            } catch (error) {
                console.warn('[Settings] Update check failed:', error);
                showToast({ message: '更新检查失败', type: 'warning' });
            }
        })());

        if (autostartToggle !== null && info.autostartSupported === true) {
            autostartToggle.removeAttribute('disabled');
            autostartToggle.checked = info.autostartEnabled === true;
            autostartToggle.addEventListener('change', () => void (async () => {
                const enabled = autostartToggle.checked;
                try {
                    const response = await fetch(buildApiUrl('system/autostart'), {
                        method: 'POST',
                        headers: getApiHeaders({ 'Content-Type': 'application/json', 'X-App-Token': appToken }),
                        body: JSON.stringify({ enabled }),
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    showToast({ message: enabled ? '已开启开机自启动' : '已关闭开机自启动', type: 'success' });
                } catch (error) {
                    console.warn('[Settings] Autostart update failed:', error);
                    autostartToggle.checked = !enabled;
                    showToast({ message: '自启动设置失败', type: 'error' });
                }
            })());
        }

        restartButton?.addEventListener('click', () => void (async () => {
            try {
                const response = await fetch(buildApiUrl('system/restart'), {
                    method: 'POST',
                    headers: getApiHeaders({ 'X-App-Token': appToken }),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                showToast({ message: '后端正在重启，页面将在几秒后自动刷新…', type: 'info' });
                setTimeout(() => window.location.reload(), 6000);
            } catch (error) {
                console.warn('[Settings] Backend restart failed:', error);
                showToast({ message: '后端重启请求失败', type: 'error' });
            }
        })());

        // 关闭后端需要手动重新启动，属不可逆操作：首次点击进入确认态，3 秒内再次点击才执行
        let shutdownArmed = false;
        let shutdownArmTimer = 0;
        shutdownButton?.addEventListener('click', () => void (async () => {
            if (!shutdownArmed) {
                shutdownArmed = true;
                shutdownButton.textContent = '再次点击确认关闭';
                shutdownArmTimer = window.setTimeout(() => {
                    shutdownArmed = false;
                    shutdownButton.textContent = '关闭后端';
                }, 3000);
                return;
            }
            window.clearTimeout(shutdownArmTimer);
            try {
                const response = await fetch(buildApiUrl('system/shutdown'), {
                    method: 'POST',
                    headers: getApiHeaders({ 'X-App-Token': appToken }),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                showToast({ message: '后端已关闭；如需再次使用请重新启动后端程序', type: 'warning' });
                this.close();
            } catch (error) {
                console.warn('[Settings] Backend shutdown failed:', error);
                showToast({ message: '后端关闭请求失败', type: 'error' });
            }
        })());
    }

    private captureCustomComponentSettings(): void {
        if (this.draftConfig === null) return;
        listRegisteredSettings().filter(setting => setting.type === 'component').forEach(setting => {
            if (!setting.serialize) return;
            const container = this.shadow.querySelector(`[data-setting-id="${CSS.escape(setting.id)}"]`);
            const component = container?.firstElementChild;
            if (component instanceof HTMLElement) this.draftConfig!.settings[setting.id] = setting.serialize(component);
        });
    }

    private async saveEnvironmentDraft(bootstrap: BootstrapConfig): Promise<boolean> {
        if (!this.environmentLoaded && !this.environmentDirty) return true;

        if (!this.environmentLoaded) {
            try {
                const latestRegistry = await fetchEnvironmentRegistry(bootstrap);
                this.draftEnvironment = {
                    version: latestRegistry.version,
                    variables: {
                        ...latestRegistry.variables,
                        ...this.draftEnvironment.variables,
                    },
                };
                this.environmentLoaded = true;
            } catch (error) {
                console.error('[Settings] Environment registry retry failed:', error);
                return false;
            }
        }

        return await saveEnvironmentRegistry(this.draftEnvironment, bootstrap);
    }

    private async saveCurrentSettings(): Promise<void> {
        if (this.draftConfig === null || this.initialConfig === null) return;
        this.captureCustomComponentSettings();
        const oldBootstrap = { ...this.initialBootstrap };
        const connectionChanged = JSON.stringify(oldBootstrap) !== JSON.stringify(this.draftBootstrap);
        const environmentChanged = JSON.stringify(this.initialEnvironment) !== JSON.stringify(this.draftEnvironment);
        const refreshSettingChanged = Object.keys(this.draftConfig.settings).some(id =>
            settingRequiresRefresh(id)
            && JSON.stringify(this.initialConfig?.settings[id]) !== JSON.stringify(this.draftConfig?.settings[id]),
        );

        // 连接信息只存 localStorage,不依赖后端可达。先持久化,打破
        // "保存正确的 Base URL 需要 Base URL 已经正确"的死锁。
        saveBootstrapConfig({ ...this.draftBootstrap, theme: this.draftConfig.theme });

        if (connectionChanged) {
            // 连接目标已变:当前草稿可能是旧后端不可达时的回退默认值,
            // 直接推送会覆盖新后端的正常配置。只保存连接信息,刷新后用新地址重新加载。
            this.initialBootstrap = { ...this.draftBootstrap, theme: this.draftConfig.theme };
            showToast({ message: '后端连接信息已保存,刷新页面后生效', type: 'success' });
            this.close();
            this.showRefreshModal();
            return;
        }

        const [configSaved, environmentSaved] = await Promise.all([
            saveUnifiedConfig(this.draftConfig, true, oldBootstrap),
            this.saveEnvironmentDraft(oldBootstrap).catch(error => {
                console.error('[Settings] Environment registry save failed:', error);
                return false;
            }),
        ]);
        if (!configSaved || !environmentSaved) {
            showToast({ message: '设置未能完整保存，请检查后端连接', type: 'error' });
            return;
        }

        await Promise.all(Array.from(this.pendingDeletedDefinitions).map(async definitionId => {
            const deleted = await deleteStoredCardBundle(definitionId, oldBootstrap);
            if (!deleted) console.warn(`[Settings] Card bundle "${definitionId}" could not be deleted.`);
            unregisterCardModule(definitionId);
        }));

        this.draftConfig.settings = deepClone(this.draftConfig.settings);
        saveBootstrapConfig({ ...this.draftBootstrap, theme: this.draftConfig.theme });
        syncBootstrapTheme(this.draftConfig.theme);
        applyAppearanceConfig(this.draftConfig.appearance);
        applyPerformanceConfig(this.draftConfig.performance);
        applyWallpaper(this.draftConfig.wallpaper);
        commitSettingsValues(this.draftConfig.settings);

        const dashboard = document.querySelector('#main-grid-dashboard') as UIGridDashboard | null;
        const header = document.querySelector('#main-custom-header');
        window.dispatchEvent(new CustomEvent('config-saved', { detail: { config: this.draftConfig } }));
        dashboard?.setCards(this.draftConfig.cards);
        dashboard?.setAttribute('edit-mode', this.draftConfig.editMode ? 'true' : 'false');
        header?.setAttribute('edit-mode', this.draftConfig.editMode ? 'true' : 'false');

        this.initialConfig = deepClone(this.draftConfig);
        this.initialBootstrap = { ...this.draftBootstrap, theme: this.draftConfig.theme };
        this.initialEnvironment = deepClone(this.draftEnvironment);
        this.environmentDirty = false;
        this.pendingDeletedDefinitions.clear();
        showToast({ message: '设置已保存', type: 'success' });
        this.close();

        if (connectionChanged || refreshSettingChanged || environmentChanged) this.showRefreshModal();
    }

    private showUnsavedModal(): void {
        let modal = document.querySelector('#settings-unsaved-modal') as UIModal | null;
        if (modal === null) {
            modal = document.createElement('ui-modal') as UIModal;
            modal.id = 'settings-unsaved-modal';
            modal.setAttribute('title', '放弃未保存的修改？');
            modal.setAttribute('width', '440px');
            const message = document.createElement('p');
            message.textContent = '当前设置仍在草稿中，关闭后这些修改不会生效。';
            modal.appendChild(message);
            const footer = document.createElement('div');
            footer.setAttribute('slot', 'footer');
            footer.style.display = 'flex';
            footer.style.gap = '12px';
            footer.style.alignItems = 'center';
            footer.style.justifyContent = 'flex-end';
            footer.innerHTML = '<ui-button id="discard-settings">放弃修改</ui-button><ui-button variant="primary" id="continue-settings">继续编辑</ui-button>';
            modal.appendChild(footer);
            document.body.appendChild(modal);
            footer.querySelector('#discard-settings')?.addEventListener('click', () => {
                this.revertPreview();
                modal?.close();
                this.close();
            });
            footer.querySelector('#continue-settings')?.addEventListener('click', () => modal?.close());
        }
        modal.open();
    }

    private showRefreshModal(): void {
        let modal = document.querySelector('#settings-refresh-modal') as UIModal | null;
        if (modal === null) {
            modal = document.createElement('ui-modal') as UIModal;
            modal.id = 'settings-refresh-modal';
            modal.setAttribute('title', '需要刷新页面');
            modal.setAttribute('width', '440px');
            const message = document.createElement('p');
            message.textContent = '连接路径、环境变量或需要刷新的卡片设置已经改变，是否立即刷新页面？';
            modal.appendChild(message);
            const footer = document.createElement('div');
            footer.setAttribute('slot', 'footer');
            footer.style.display = 'flex';
            footer.style.gap = '12px';
            footer.style.alignItems = 'center';
            footer.style.justifyContent = 'flex-end';
            footer.innerHTML = '<ui-button id="refresh-later">稍后</ui-button><ui-button variant="primary" id="refresh-now" icon="refresh">刷新</ui-button>';
            modal.appendChild(footer);
            document.body.appendChild(modal);
            footer.querySelector('#refresh-later')?.addEventListener('click', () => modal?.close());
            footer.querySelector('#refresh-now')?.addEventListener('click', () => window.location.reload());
        }
        modal.open();
    }
}

if (!customElements.get('ui-settings-modal')) {
    customElements.define('ui-settings-modal', UISettingsModal);
}
