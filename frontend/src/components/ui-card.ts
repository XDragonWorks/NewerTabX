import { getIconSvg, IconName } from '../utils/icons';

export class UICard extends HTMLElement {
  private shadow: ShadowRoot;
  private animFrameId: number | null = null;
  private targetAngle: number = 90;
  private currentAngle: number = 90;
  private isHovered: boolean = false;

  private readonly updateAnimation = (): void => {
    let diff = this.targetAngle - this.currentAngle;

    // 处理 360 度跨界平滑插值
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;

    this.currentAngle += diff * 0.035;

    this.style.setProperty('--grad-angle', `${this.currentAngle.toFixed(1)}deg`);

    if (this.isHovered || Math.abs(diff) > 0.1) {
      this.animFrameId = requestAnimationFrame(this.updateAnimation);
    } else {
      this.animFrameId = null;
    }
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    const rect = this.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const nx = mouseX / rect.width - 0.5;
    const ny = mouseY / rect.height - 0.5;

    // 根据鼠标相对于卡片中心的方位计算渐变倾角，由鼠标所在的边缘/角落向全卡片贯穿延伸
    this.targetAngle = Math.atan2(ny, nx) * (180 / Math.PI) + 270;

    if (!this.isHovered) {
      this.currentAngle = this.targetAngle;
      this.isHovered = true;
    }

    this.style.setProperty('--spotlight-opacity', '1');

    if (this.animFrameId === null) {
      this.animFrameId = requestAnimationFrame(this.updateAnimation);
    }
  };

  private readonly handleMouseLeave = (): void => {
    this.isHovered = false;
    this.style.setProperty('--spotlight-opacity', '0');
  };

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.addEventListener('mousemove', this.handleMouseMove);
    this.addEventListener('mouseleave', this.handleMouseLeave);
  }

  disconnectedCallback(): void {
    this.removeEventListener('mousemove', this.handleMouseMove);
    this.removeEventListener('mouseleave', this.handleMouseLeave);
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  static get observedAttributes() {
    return ['title', 'icon'];
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private render(): void {
    const title = this.getAttribute('title') || '';
    const icon = this.getAttribute('icon') || '';
    const iconMarkup = icon ? getIconSvg(icon as IconName) : '';

    this.shadow.innerHTML = `
      <style>
        :host {
          position: relative;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          border-radius: var(--radius-md);
          background: var(--color-card-bg);
          -webkit-backdrop-filter: blur(var(--blur-card)) saturate(140%);
          backdrop-filter: blur(var(--blur-card)) saturate(140%);
          /* border: 1px solid var(--color-card-border); */
          box-shadow: var(--shadow-fluent-card);
          overflow: hidden;
          width: 100%;
          height: 100%;
          transition: border-color var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard),
                      transform var(--duration-normal) var(--ease-fluent-standard);
        }

        :host::before {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          opacity: var(--spotlight-opacity);
          background: linear-gradient(
            var(--grad-angle),
            var(--shimmer-color-start) 0%,
            var(--shimmer-color-mid) 40%,
            transparent 85%
          );
          transition: opacity var(--duration-normal) var(--ease-fluent-standard);
        }

        :host-context([data-shimmer="false"])::before {
          display: none !important;
        }

        /* 仅保留 Header 与 Body 之间一条淡淡的分割线，Body 与 Footer 零分割线 */
        .card-header {
          position: relative;
          z-index: 1;
          padding: 16px 20px 0px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          /* border-bottom: 1px solid var(--color-card-border); */
          font-size: 15px;
          font-weight: 600;
          color: var(--color-text-primary);
          flex-shrink: 0;
        }

        .header-title-box {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .card-body {
          position: relative;
          z-index: 1;
          flex: 1;
          padding: 18px 20px;
          overflow-y: auto;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }

        /* 统一自定义 Fluent 精细滚动条 */
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
      </style>

      ${title ? `
        <div class="card-header">
          <div class="header-title-box">
            ${iconMarkup ? `<span>${iconMarkup}</span>` : ''}
            <span id="card-title"></span>
          </div>
          <slot name="header-action"></slot>
          <slot name="actions"></slot>
        </div>
      ` : ''}
      <div class="card-body">
        <slot></slot>
      </div>
    `;
    const titleElement = this.shadow.querySelector('#card-title');
    if (titleElement !== null) titleElement.textContent = title;
  }
}

if (!customElements.get('ui-card')) {
  customElements.define('ui-card', UICard);
}
