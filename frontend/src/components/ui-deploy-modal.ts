import { UIModal } from './ui-modal';
import { showToast } from './ui-toast';
import type { UIInput } from './ui-input';
import type { UICheckbox } from './ui-checkbox';
import type { UICodeEditor } from './ui-code-editor';
import type { UIGridDashboard } from '../layout/grid-dashboard';
import type { CardLayoutItem } from '../layout/grid-packer';

import { fetchUnifiedConfig, saveUnifiedConfig } from '../services/config-service';
import {
  deleteStoredCardBundle,
  evaluateCardModule,
  fetchStoredCardBundle,
  registerCardModule,
  saveStoredCardBundle,
} from '../services/card-registry';

const CARD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class UIDeployModal extends HTMLElement {
  private shadow: ShadowRoot;
  private modal: UIModal | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
  }

  public open(source?: HTMLElement | MouseEvent): void {
    this.modal?.open(source);
  }

  public close(): void {
    this.modal?.close();
  }

  private render(): void {
    this.shadow.innerHTML = `
      <style>
        :host { display: block; }
        .deploy-form { display: flex; flex-direction: column; gap: 14px; }
        .form-label { display: block; margin-bottom: 5px; font-size: 12px; color: var(--color-text-secondary); }
        .security-notice {
          padding: 12px 14px;
          border: 1px solid color-mix(in srgb, var(--color-accent-primary) 35%, transparent);
          border-radius: var(--radius-sm);
          background: color-mix(in srgb, var(--color-accent-primary) 8%, transparent);
          font-size: 12px;
          line-height: 1.6;
          color: var(--color-text-secondary);
        }
      </style>

      <ui-modal id="inner-deploy-modal" title="部署自定义卡片" width="640px">
        <div class="deploy-form">
          <div class="security-notice">
            卡片代码可直接执行，请确保安全之后再使用。使用未检查过的卡片可能导致隐私数据泄露。
          </div>

          <div>
            <label class="form-label">卡片定义 ID</label>
            <ui-input id="input-card-id"></ui-input>
            <span class="form-label">仅支持字母、数字、点、下划线和连字符，例如 weather.air-quality。</span>
          </div>

          <div>
            <label class="form-label">Card JavaScript 代码</label>
            <ui-code-editor id="editor-code" height="260px"></ui-code-editor>
          </div>

          <ui-checkbox id="checkbox-trust-code" label="我已检查并信任这段本地代码"></ui-checkbox>
        </div>

        <div slot="footer">
          <ui-button id="btn-cancel-deploy">取消</ui-button>
          <ui-button variant="primary" id="btn-confirm-deploy" icon="code">部署并添加卡片</ui-button>
        </div>
      </ui-modal>
    `;

    this.modal = this.shadow.querySelector('#inner-deploy-modal') as UIModal | null;
    const idInput = this.shadow.querySelector('#input-card-id') as UIInput | null;
    const editor = this.shadow.querySelector('#editor-code') as UICodeEditor | null;
    if (idInput !== null) idInput.value = 'custom-card-01';
    if (editor !== null) {
      editor.setAttribute('placeholder', 'module.exports = {\n  mount: (shadowRoot, sdk) => {\n    // 在这里渲染卡片\n  }\n};');
    }

    this.shadow.querySelector('#btn-cancel-deploy')?.addEventListener('click', () => this.close());
    this.shadow.querySelector('#btn-confirm-deploy')?.addEventListener('click', () => void this.deployCard());
  }

  private async deployCard(): Promise<void> {
    const idInput = this.shadow.querySelector('#input-card-id') as UIInput | null;
    const editor = this.shadow.querySelector('#editor-code') as UICodeEditor | null;
    const trustCheckbox = this.shadow.querySelector('#checkbox-trust-code') as UICheckbox | null;
    const cardId = idInput !== null ? idInput.value.trim() : '';
    const code = editor !== null ? editor.value.trim() : '';

    if (CARD_ID_PATTERN.test(cardId) === false) {
      showToast({ message: '卡片 ID 格式不正确', type: 'warning' });
      return;
    }
    if (code === '') {
      showToast({ message: '请先粘贴 Card JavaScript 代码', type: 'warning' });
      return;
    }
    if (trustCheckbox === null || trustCheckbox.checked === false) {
      showToast({ message: '请确认您已经检查并信任这段代码', type: 'warning' });
      return;
    }

    try {
      const cardModule = evaluateCardModule(code, cardId);
      const config = await fetchUnifiedConfig();
      const previousBundle = await fetchStoredCardBundle(cardId).catch(() => null);

      const bundleSaved = await saveStoredCardBundle({ id: cardId, code, timestamp: Date.now() });
      if (!bundleSaved) throw new Error('卡片代码文件保存失败');

      registerCardModule(cardId, cardModule);
      const title = typeof cardModule.name === 'string' && cardModule.name.trim() !== ''
        ? cardModule.name.trim()
        : `卡片 (${cardId})`;

      const instance: CardLayoutItem = {
        id: `card-${cardId}-${crypto.randomUUID().slice(0, 8)}`,
        title,
        w: 1,
        h: 1,
        type: cardId,
        order: config.cards.length + 1,
      };
      config.cards.push(instance);

      const configSaved = await saveUnifiedConfig(config, true);
      if (!configSaved) {
        if (previousBundle !== null) await saveStoredCardBundle(previousBundle);
        else await deleteStoredCardBundle(cardId);
        throw new Error('卡片配置保存失败');
      }

      window.dispatchEvent(new CustomEvent('card-deployed', {
        detail: { cardId, instance },
      }));
      window.dispatchEvent(new CustomEvent('config-saved', { detail: { config } }));

      const dashboard = document.querySelector('#main-grid-dashboard') as UIGridDashboard | null;
      if (dashboard !== null) dashboard.addCard(instance);

      showToast({ message: `卡片“${cardId}”已部署并添加`, type: 'success' });
      this.close();
    } catch (error) {
      console.error('[DeployModal] Card deployment failed:', error);
      const message = error instanceof Error ? error.message : '未知部署错误';
      showToast({ message: `部署失败：${message}`, type: 'error' });
    }
  }
}

if (!customElements.get('ui-deploy-modal')) {
  customElements.define('ui-deploy-modal', UIDeployModal);
}
