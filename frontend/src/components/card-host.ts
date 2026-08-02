import { createCardSDK, CardSDK } from '../sdk/card-sdk';

export interface CardModule {
  name?: string;
  /** 内置图标名称,或内联 SVG 字符串 */
  icon?: string;
  description?: string;
  mount: (container: ShadowRoot, sdk: CardSDK) => void;
  unmount?: (container: ShadowRoot) => void;
}

export class UICardHost extends HTMLElement {
  private shadow: ShadowRoot;
  private sdk: CardSDK | null = null;
  private currentModule: CardModule | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    const instanceId = this.getAttribute('card-id') || `card-${Math.random().toString(36).substring(2, 9)}`;
    const cardType = this.getAttribute('card-type') || 'system';
    this.sdk = createCardSDK(instanceId, cardType);
    this.initShadowDom();
  }

  disconnectedCallback() {
    if (this.currentModule && this.currentModule.unmount) {
      try {
        this.currentModule.unmount(this.shadow);
      } catch (e) {
        console.warn('Error unmounting card module:', e);
      }
    }
  }

  static get observedAttributes() {
    return ['card-id', 'title'];
  }

  attributeChangedCallback() {
    // 观察属性变更
  }

  private initShadowDom() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          font-family: inherit;
          background: transparent;
        }

        .card-container {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          background: transparent;
        }

        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }

        ::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.18);
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.35);
        }

        :host-context([data-theme="dark"]) ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.22);
        }

        :host-context([data-theme="dark"]) ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.45);
        }
      </style>
      <div class="card-container"></div>
    `;
  }

  public getContainer(): HTMLDivElement | null {
    return this.shadow.querySelector('.card-container');
  }

  public getShadow(): ShadowRoot {
    return this.shadow;
  }

  public getSDK(): CardSDK | null {
    return this.sdk;
  }

  public mountCardModule(cardModule: CardModule) {
    if (this.currentModule && this.currentModule.unmount) {
      try {
        this.currentModule.unmount(this.shadow);
      } catch (e) {
        console.warn('Error unmounting previous card module:', e);
      }
    }

    this.currentModule = cardModule;
    if (this.sdk !== null) {
      try {
        cardModule.mount(this.shadow, this.sdk);
        console.log(`[UICardHost] Successfully mounted card module in Shadow DOM.`);
      } catch (e) {
        console.warn('[UICardHost] Failed to mount card module:', e);
      }
    } else {
      console.warn('[UICardHost] SDK is null during card mount.');
    }
  }
}

if (!customElements.get('ui-card-host')) {
  customElements.define('ui-card-host', UICardHost);
}
