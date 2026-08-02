import { getIconSvg, IconName } from '../utils/icons';
import { escapeHtml } from '../utils/html';

export interface ToastOptions {
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

interface ToastItemData extends ToastOptions {
  id: string;
  remaining: number;
  timerId: number | null;
  startTime: number;
  isPausing: boolean;
  stage: 'entering' | 'normal' | 'sliding-out' | 'collapsing';
}

export class UIToast extends HTMLElement {
  private shadow: ShadowRoot;
  private toasts: ToastItemData[] = [];
  private isHoveredAll: boolean = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  public addToast(options: ToastOptions) {
    const id = `toast-${Math.random().toString(36).substring(2, 9)}`;
    const duration = options.duration || 3500;

    const item: ToastItemData = {
      ...options,
      id,
      remaining: duration,
      timerId: null,
      startTime: Date.now(),
      isPausing: false,
      stage: 'entering',
    };

    this.toasts.push(item);
    this.renderToasts();

    const toastElem = this.shadow.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
    if (toastElem) {
      void toastElem.offsetHeight;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        item.stage = 'normal';
        this.updateItemStageDOM(id, 'normal');
      });
    });

    this.startToastTimer(item);
  }

  private startToastTimer(item: ToastItemData) {
    if (this.isHoveredAll) {
      item.isPausing = true;
      return;
    }
    item.isPausing = false;
    item.startTime = Date.now();
    item.timerId = window.setTimeout(() => {
      this.removeToastTwoStage(item.id);
    }, item.remaining);
  }

  private pauseToastTimer(item: ToastItemData) {
    if (item.timerId !== null && !item.isPausing) {
      clearTimeout(item.timerId);
      item.timerId = null;
      const elapsed = Date.now() - item.startTime;
      item.remaining = Math.max(0, item.remaining - elapsed);
      item.isPausing = true;
    }
  }

  private resumeToastTimer(item: ToastItemData) {
    if (item.isPausing && item.remaining > 0) {
      this.startToastTimer(item);
    }
  }

  private removeToastTwoStage(id: string) {
    const item = this.toasts.find(t => t.id === id);
    if (!item) return;

    if (item.timerId !== null) {
      clearTimeout(item.timerId);
      item.timerId = null;
    }

    item.stage = 'sliding-out';
    this.updateItemStageDOM(id, 'sliding-out');

    setTimeout(() => {
      item.stage = 'collapsing';
      this.updateItemStageDOM(id, 'collapsing');

      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
        this.renderToasts();
      }, 220);
    }, 220);
  }

  private onMouseEnterAll() {
    this.isHoveredAll = true;
    this.toasts.forEach(item => this.pauseToastTimer(item));
  }

  private onMouseLeaveAll() {
    this.isHoveredAll = false;
    this.toasts.forEach(item => this.resumeToastTimer(item));
  }

  private updateItemStageDOM(id: string, stage: string) {
    const wrapper = this.shadow.querySelector(`[data-id="${id}"]`);
    if (wrapper) {
      wrapper.className = `toast-wrapper ${stage}`;
    }
  }

  private renderToasts() {
    const container = this.shadow.querySelector('.toast-container');
    if (!container) return;

    container.innerHTML = this.toasts.map(item => {
      const type = item.type || 'info';
      let iconName = 'info';
      if (type === 'success') iconName = 'check';
      if (type === 'warning') iconName = 'info';
      if (type === 'error') iconName = 'x';

      return `
        <div class="toast-wrapper ${item.stage}" data-id="${item.id}">
          <div class="toast-card ${type}">
            <div class="toast-content-box">
              <span class="toast-icon">${getIconSvg(iconName as IconName)}</span>
              <div class="toast-message">${escapeHtml(item.message).replace(/\n/g, '<br/>')}</div>
            </div>
            <button class="close-btn" data-close-id="${item.id}" aria-label="Close">${getIconSvg('x')}</button>
          </div>
        </div>
      `;
    }).join('');

    const closeBtns = container.querySelectorAll('.close-btn');
    closeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const closeId = btn.getAttribute('data-close-id');
        if (closeId) this.removeToastTwoStage(closeId);
      });
    });
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 24px;
          right: 24px;
          z-index: 9999;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          font-family: inherit;
        }

        .toast-container {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          pointer-events: auto;
        }

        .toast-wrapper {
          position: relative;
          box-sizing: border-box;
          max-height: 200px;
          margin-bottom: 0;
          opacity: 1;
          transform: translateX(0);
          transition: transform 220ms var(--ease-fluent-standard),
                      opacity 220ms var(--ease-fluent-standard),
                      max-height 220ms var(--ease-fluent-standard),
                      margin-bottom 220ms var(--ease-fluent-standard);
        }

        .toast-wrapper.entering {
          opacity: 0;
          transform: translateX(100%);
        }

        .toast-wrapper.sliding-out {
          opacity: 0;
          transform: translateX(100%);
        }

        .toast-wrapper.collapsing {
          opacity: 0;
          transform: translateX(100%);
          max-height: 0 !important;
          margin-bottom: -10px !important;
          overflow: hidden;
        }

        /* 纯正 Fluent Toast 卡片：多行支持 & 右划消失 */
        .toast-card {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-width: 280px;
          max-width: 420px;
          padding: 12px 16px;
          box-sizing: border-box;
          border-radius: var(--radius-md);
          background: var(--color-surface-acrylic);
          backdrop-filter: blur(var(--blur-acrylic));
          border: 1px solid var(--color-card-border);
          box-shadow: var(--shadow-fluent-modal);
          color: var(--color-text-primary);
        }

        .toast-content-box {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          flex: 1;
          margin-right: 12px;
        }

        .toast-icon {
          width: 18px;
          height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .toast-icon svg {
          width: 100%;
          height: 100%;
          stroke: currentColor;
          stroke-width: 2.2;
        }

        .toast-card.info .toast-icon { color: var(--color-accent-primary); }
        .toast-card.success .toast-icon { color: #107c41; }
        .toast-card.warning .toast-icon { color: #d83b01; }
        .toast-card.error .toast-icon { color: #a80000; }

        .toast-message {
          font-size: 13px;
          line-height: 1.5;
          word-break: break-word;
          color: var(--color-text-primary);
        }

        /* 鼠标 Hover 在 Toast 卡片上时右侧展现优雅叉号关闭按钮 */
        .close-btn {
          cursor: pointer;
          border: none;
          background: transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          color: var(--color-text-secondary);
          opacity: 0;
          transition: opacity var(--duration-fast) var(--ease-fluent-standard),
                      background-color var(--duration-fast);
          flex-shrink: 0;
        }

        .toast-card:hover .close-btn {
          opacity: 1;
        }

        .close-btn:hover {
          background: rgba(0, 0, 0, 0.08);
          color: var(--color-text-primary);
        }

        .close-btn svg {
          width: 14px;
          height: 14px;
          stroke: currentColor;
          stroke-width: 2.2;
        }
      </style>

      <div class="toast-container"></div>
    `;

    const container = this.shadow.querySelector('.toast-container');
    if (container) {
      container.addEventListener('mouseenter', () => this.onMouseEnterAll());
      container.addEventListener('mouseleave', () => this.onMouseLeaveAll());
    }
  }
}

if (!customElements.get('ui-toast')) {
  customElements.define('ui-toast', UIToast);
}

// 自动检测并挂载 Toast Container，彻底解决 DOM 节点缺失导致 Toast 丢失问题！
export function showToast(options: ToastOptions) {
  let container = document.querySelector('ui-toast') as UIToast | null;
  if (!container) {
    container = document.createElement('ui-toast') as UIToast;
    document.body.appendChild(container);
  }
  container.addToast(options);
}
