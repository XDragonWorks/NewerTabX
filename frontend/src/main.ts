import './styles/main.css';
import './components/index';
import './layout/grid-dashboard';

import type { UICardHost } from './components/card-host';
import type { UIGridDashboard } from './layout/grid-dashboard';
import type { UISettingsModal } from './components/ui-settings-modal';
import type { UITrashBin } from './components/ui-trash-bin';
import type { UICustomHeader } from './components/ui-custom-header';
import type { CardLayoutItem } from './layout/grid-packer';
import type { AppUnifiedConfig } from './services/config-service';

import { applyPerformanceConfig } from './utils/performance';
import { applyAppearanceConfig } from './utils/appearance';
import { fetchUnifiedConfig, saveUnifiedConfig } from './services/config-service';
import { showToast } from './components/ui-toast';
import { applyWallpaper } from './services/wallpaper-service';
import { initializeSettingsRegistry } from './services/settings-registry';
import {
    loadCustomCardModules,
    mountRegisteredCard,
} from './services/card-registry';
import { createCardSDK } from './sdk/card-sdk';

async function initApp(): Promise<void> {
    const appContainer = document.querySelector('#app');
    if (appContainer === null) return;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
            console.info('[App] Service Worker registered successfully:', reg.scope);
        }).catch((err) => {
            console.warn('[App] Service Worker registration failed:', err);
        });
    }

    let unifiedConfig: AppUnifiedConfig = await fetchUnifiedConfig();
    initializeSettingsRegistry(unifiedConfig.settings);
    await loadCustomCardModules(unifiedConfig);

    applyAppearanceConfig(unifiedConfig.appearance);
    applyPerformanceConfig(unifiedConfig.performance);
    window.cardSDK = createCardSDK('system');

    appContainer.innerHTML = `
    <main class="app-shell">
      <ui-trash-bin id="main-trash-bin"></ui-trash-bin>
      <ui-custom-header id="main-custom-header"></ui-custom-header>
      <ui-grid-dashboard id="main-grid-dashboard"></ui-grid-dashboard>
      <ui-settings-modal id="global-settings-modal"></ui-settings-modal>
      <ui-deploy-modal id="card-deploy-modal"></ui-deploy-modal>
    </main>
  `;

    const dashboard = document.querySelector('#main-grid-dashboard') as UIGridDashboard | null;
    const customHeader = document.querySelector('#main-custom-header') as UICustomHeader | null;
    const settingsModal = document.querySelector('#global-settings-modal') as UISettingsModal | null;
    const trashBin = document.querySelector('#main-trash-bin') as UITrashBin | null;

    if (customHeader !== null) {
        customHeader.setHeaderConfig(unifiedConfig.header);
    }

    if (dashboard !== null) {
        const applyEditMode = (enabled: boolean) => {
            dashboard.setAttribute('edit-mode', enabled ? 'true' : 'false');
            if (customHeader !== null) customHeader.setAttribute('edit-mode', enabled ? 'true' : 'false');
        };
        applyEditMode(unifiedConfig.editMode);

        dashboard.addEventListener('card-instance-added', event => {
            const customEvent = event as CustomEvent<{ item: CardLayoutItem; host: UICardHost }>;
            const item = customEvent.detail.item;
            const type = typeof item.type === 'string' ? item.type : '';
            mountRegisteredCard(customEvent.detail.host, type);
        });

        dashboard.addEventListener('cards-reorder', event => {
            const customEvent = event as CustomEvent<{ cards: CardLayoutItem[] }>;
            unifiedConfig.cards = customEvent.detail.cards.map(card => ({ ...card }));
        });

        dashboard.addEventListener('card-drag-start', () => trashBin?.show());
        dashboard.addEventListener('card-drag-end', () => trashBin?.hide());
        dashboard.setCards(unifiedConfig.cards);

        document.addEventListener('card-delete-drop', event => {
            const customEvent = event as CustomEvent<{ cardId: string }>;
            if (customEvent.detail.cardId !== '') dashboard.removeCard(customEvent.detail.cardId);
        });

        window.addEventListener('config-saved', event => {
            const customEvent = event as CustomEvent<{ config: AppUnifiedConfig }>;
            unifiedConfig = customEvent.detail.config;
            applyEditMode(unifiedConfig.editMode);
            if (customHeader !== null) {
                customHeader.setHeaderConfig(unifiedConfig.header);
            }
        });
    }

    if (customHeader !== null) {
        customHeader.addEventListener('exit-edit-mode', async () => {
            unifiedConfig.editMode = false;
            customHeader.setAttribute('edit-mode', 'false');
            if (dashboard !== null) {
                dashboard.setAttribute('edit-mode', 'false');
                unifiedConfig.cards = dashboard.getCards();
            }
            const saved = await saveUnifiedConfig(unifiedConfig, true);
            showToast({
                message: saved ? '布局保存成功' : '布局保存失败，请检查后端连接',
                type: saved ? 'success' : 'error',
            });
        });

        customHeader.addEventListener('open-settings', () => {
            if (settingsModal !== null) void settingsModal.open();
        });
    }

    revealApp();

    setTimeout(() => {
        applyWallpaper(unifiedConfig.wallpaper);
    }, 0);
}

function revealApp(): void {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.documentElement.classList.add('app-ready');
        });
    });
}

void initApp().then(() => {
    revealApp();
}).catch(error => {
    console.error('[App] Application initialization failed:', error);
    showToast({ message: '应用初始化失败，请查看控制台错误信息', type: 'error' });
    revealApp();
});
