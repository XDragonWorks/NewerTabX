export class UICodeEditor extends HTMLElement {
  private shadow: ShadowRoot;
  private textareaElem: HTMLTextAreaElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['value', 'placeholder', 'height', 'readonly'];
  }

  attributeChangedCallback(name: string, _oldVal: string, newVal: string) {
    if (this.textareaElem === null) return;

    if (name === 'value') {
      if (this.textareaElem.value !== newVal) {
        this.textareaElem.value = newVal !== null ? newVal : '';
      }
    } else if (name === 'placeholder') {
      this.textareaElem.placeholder = newVal !== null ? newVal : '';
    } else if (name === 'readonly') {
      this.textareaElem.readOnly = this.hasAttribute('readonly');
    }
  }

  get value(): string {
    return this.textareaElem ? this.textareaElem.value : (this.getAttribute('value') || '');
  }

  set value(val: string) {
    this.setAttribute('value', val);
    if (this.textareaElem) {
      this.textareaElem.value = val;
    }
  }

  private handleInput() {
    const val = this.value;
    this.dispatchEvent(new CustomEvent('input', { detail: { value: val }, bubbles: true, composed: true }));
    this.dispatchEvent(new CustomEvent('change', { detail: { value: val }, bubbles: true, composed: true }));
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Tab' && this.textareaElem) {
      e.preventDefault();
      const start = this.textareaElem.selectionStart;
      const end = this.textareaElem.selectionEnd;

      this.textareaElem.value = this.textareaElem.value.substring(0, start) + '  ' + this.textareaElem.value.substring(end);
      this.textareaElem.selectionStart = this.textareaElem.selectionEnd = start + 2;
      this.handleInput();
    }
  }

  private render() {
    const value = this.getAttribute('value') || '';
    const placeholder = this.getAttribute('placeholder') || '// 在此输入代码...';
    const requestedHeight = this.getAttribute('height') || '220px';
    const height = /^\d+(\.\d+)?(px|rem|em|vh|%)$/.test(requestedHeight) ? requestedHeight : '220px';
    const isReadonly = this.hasAttribute('readonly');

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          font-family: 'Consolas', 'Fira Code', 'Cascadia Code', monospace;
        }

        .editor-container {
          position: relative;
          width: 100%;
          height: ${height};
          border-radius: var(--radius-sm);
          border: 1px solid var(--color-card-border);
          background: var(--color-card-bg);
          backdrop-filter: blur(var(--blur-acrylic));
          overflow: hidden;
          transition: border-color var(--duration-fast) var(--ease-fluent-standard),
                      box-shadow var(--duration-fast) var(--ease-fluent-standard);
        }

        .editor-container:hover {
          border-color: var(--color-card-border-hover);
        }

        .editor-container:focus-within {
          border-color: var(--color-accent-primary);
          box-shadow: 0 0 0 2px var(--color-accent-glow);
        }

        .code-textarea {
          width: 100%;
          height: 100%;
          padding: 12px 14px;
          box-sizing: border-box;
          border: none;
          background: transparent;
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: 13px;
          line-height: 1.5;
          outline: none;
          resize: none;
          white-space: pre;
          tab-size: 2;
          overflow-y: auto;
        }

        .code-textarea::placeholder {
          color: var(--color-text-secondary);
        }

        /* 统一精致 Fluent 滚动条 */
        .code-textarea::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .code-textarea::-webkit-scrollbar-track {
          background: transparent;
        }

        /* 水平/竖直滚动条交汇处保持透明，避免白色小方块 */
        .code-textarea::-webkit-scrollbar-corner {
          background: transparent;
        }

        .code-textarea::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.18);
          border-radius: 3px;
          transition: background-color 180ms var(--ease-fluent-standard);
        }

        .code-textarea::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.35);
        }

        :host-context([data-theme="dark"]) .code-textarea::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
        }

        :host-context([data-theme="dark"]) .code-textarea::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
      </style>

      <div class="editor-container">
        <textarea class="code-textarea" id="code-textarea"></textarea>
      </div>
    `;

    this.textareaElem = this.shadow.querySelector('#code-textarea') as HTMLTextAreaElement | null;

    if (this.textareaElem) {
      this.textareaElem.value = value;
      this.textareaElem.placeholder = placeholder;
      this.textareaElem.readOnly = isReadonly;
      this.textareaElem.addEventListener('input', () => this.handleInput());
      this.textareaElem.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }
  }
}

if (!customElements.get('ui-code-editor')) {
  customElements.define('ui-code-editor', UICodeEditor);
}
