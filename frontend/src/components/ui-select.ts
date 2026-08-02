import { getIconSvg } from '../utils/icons';

export interface SelectOptionData {
  value: string;
  label: string;
}

export class UISelect extends HTMLElement {
  private shadow: ShadowRoot;
  private isOpen: boolean = false;
  private selectedValues: string[] = [];
  private optionsData: SelectOptionData[] = [];
  private searchKeyword: string = '';
  private dropdownPanel: HTMLDivElement | null = null;
  private boundReposition: () => void;

  private static activeInstance: UISelect | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.boundReposition = this.repositionPanel.bind(this);
  }

  connectedCallback() {
    this.parseSlotOptions();
    this.initInitialValue();
    this.render();
  }

  disconnectedCallback() {
    this.cleanupTeleportPanel();
    if (UISelect.activeInstance === this) {
      UISelect.activeInstance = null;
    }
  }

  static get observedAttributes() {
    return ['value', 'multiple', 'searchable', 'placeholder', 'disabled'];
  }

  attributeChangedCallback(name: string) {
    if (name === 'value') {
      this.initInitialValue();
      this.updateTriggerLabel();
    } else {
      this.render();
    }
  }

  private parseSlotOptions() {
    const rawOptions = Array.from(this.querySelectorAll('option'));
    this.optionsData = rawOptions.map(opt => ({
      value: opt.value,
      label: opt.textContent || opt.value
    }));
  }

  private initInitialValue() {
    const isMultiple = this.hasAttribute('multiple');
    const valAttr = this.getAttribute('value') || '';
    if (isMultiple) {
      this.selectedValues = valAttr ? valAttr.split(',').map(s => s.trim()) : [];
    } else {
      this.selectedValues = valAttr ? [valAttr] : (this.optionsData.length > 0 ? [this.optionsData[0].value] : []);
    }
  }

  get value(): string | string[] {
    return this.hasAttribute('multiple') ? this.selectedValues : (this.selectedValues[0] || '');
  }

  set value(val: string | string[]) {
    if (Array.isArray(val)) {
      this.selectedValues = val;
      this.setAttribute('value', val.join(','));
    } else {
      this.selectedValues = [val];
      this.setAttribute('value', val);
    }
    this.updateTriggerLabel();
  }

  private toggleOpen() {
    if (this.hasAttribute('disabled')) return;
    if (this.isOpen) {
      this.closeTeleportPanel();
    } else {
      this.openTeleportPanel();
    }
  }

  private openTeleportPanel() {
    if (UISelect.activeInstance && UISelect.activeInstance !== this) {
      UISelect.activeInstance.closeTeleportPanel();
    }
    UISelect.activeInstance = this;

    this.isOpen = true;
    const trigger = this.shadow.querySelector('.select-trigger');
    if (trigger) trigger.classList.add('active');

    if (!this.dropdownPanel) {
      this.createDropdownPanel();
    }
    this.repositionPanel();

    if (this.dropdownPanel) {
      document.body.appendChild(this.dropdownPanel);
      requestAnimationFrame(() => {
        if (this.dropdownPanel) this.dropdownPanel.classList.add('visible');
      });
    }

    window.addEventListener('resize', this.boundReposition, true);
    window.addEventListener('scroll', this.boundReposition, true);
  }

  private closeTeleportPanel() {
    this.isOpen = false;
    const trigger = this.shadow.querySelector('.select-trigger');
    if (trigger) trigger.classList.remove('active');

    if (UISelect.activeInstance === this) {
      UISelect.activeInstance = null;
    }

    if (this.dropdownPanel) {
      this.dropdownPanel.classList.remove('visible');
      setTimeout(() => {
        this.cleanupTeleportPanel();
      }, 200);
    }

    window.removeEventListener('resize', this.boundReposition, true);
    window.removeEventListener('scroll', this.boundReposition, true);
  }

  private cleanupTeleportPanel() {
    if (this.dropdownPanel && this.dropdownPanel.parentNode) {
      this.dropdownPanel.parentNode.removeChild(this.dropdownPanel);
    }
    this.dropdownPanel = null;
  }

  public repositionPanel() {
    const trigger = this.shadow.querySelector('.select-trigger');
    if (!trigger || !this.dropdownPanel) return;

    const rect = trigger.getBoundingClientRect();
    this.dropdownPanel.style.position = 'fixed';
    this.dropdownPanel.style.top = `${rect.bottom + 6}px`;
    this.dropdownPanel.style.left = `${rect.left}px`;
    this.dropdownPanel.style.width = `${rect.width}px`;
  }

  private selectOption(optValue: string) {
    const isMultiple = this.hasAttribute('multiple');
    if (isMultiple) {
      const idx = this.selectedValues.indexOf(optValue);
      if (idx > -1) {
        this.selectedValues.splice(idx, 1);
      } else {
        this.selectedValues.push(optValue);
      }
      this.setAttribute('value', this.selectedValues.join(','));
      this.updateTriggerLabel();
      if (this.dropdownPanel) {
        this.updatePanelListContent();
        requestAnimationFrame(() => this.repositionPanel());
      }
    } else {
      this.selectedValues = [optValue];
      this.setAttribute('value', optValue);
      this.updateTriggerLabel();
      this.closeTeleportPanel();
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { value: this.value } }));
  }

  private createDropdownPanel() {
    const isSearchable = this.hasAttribute('searchable');
    const panel = document.createElement('div');
    panel.className = 'teleport-dropdown';
    
    // 圆角与表单 Input 100% 完全相同统一为 var(--radius-sm)；淡化选中的背景色，不喧宾夺主
    panel.innerHTML = `
      <style>
        .teleport-dropdown {
          box-sizing: border-box;
          border-radius: var(--radius-sm);
          background: var(--color-surface-acrylic);
          backdrop-filter: blur(var(--blur-acrylic));
          border: 1px solid var(--color-card-border);
          box-shadow: var(--shadow-fluent-modal);
          z-index: 99999;
          display: flex;
          flex-direction: column;
          max-height: 260px;
          overflow: hidden;
          font-family: inherit;
          opacity: 0;
          transform: translateY(-8px) scale(0.98);
          transition: opacity var(--duration-normal) var(--ease-fluent-standard),
                      transform var(--duration-normal) var(--ease-fluent-standard);
        }

        .teleport-dropdown.visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        .search-box {
          padding: 8px 10px;
          border-bottom: 1px solid var(--color-card-border);
        }

        .search-input {
          width: 100%;
          padding: 6px 10px;
          box-sizing: border-box;
          border-radius: var(--radius-sm);
          border: 1px solid var(--color-card-border);
          outline: none;
          font-size: 13px;
          background: var(--color-card-bg);
          color: var(--color-text-primary);
        }

        .options-list {
          flex: 1;
          overflow-y: auto;
          padding: 5px;
          margin: 0;
          list-style: none;
        }

        .option-item {
          position: relative;
          padding: 8px 12px 8px 16px;
          margin-bottom: 3px;
          border-radius: var(--radius-sm);
          font-size: 14px;
          font-weight: 400 !important;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--color-text-primary);
          transition: background-color var(--duration-fast) var(--ease-fluent-standard);
        }

        .option-item:hover {
          background: color-mix(in srgb, var(--color-accent-primary) 10%, transparent);
        }

        .option-item.selected {
          color: var(--color-accent-primary);
          background: color-mix(in srgb, var(--color-accent-primary) 14%, transparent);
        }

        .option-item.selected::before {
          content: '';
          position: absolute;
          left: 4px;
          top: 22%;
          height: 56%;
          width: 3px;
          border-radius: 2px;
          background: var(--color-accent-primary);
        }

        .empty-tip {
          padding: 16px;
          text-align: center;
          font-size: 13px;
          color: var(--color-text-secondary);
        }
      </style>

      ${isSearchable ? `
        <div class="search-box">
          <input type="text" class="search-input" placeholder="搜索选项..." />
        </div>
      ` : ''}
      <ul class="options-list"></ul>
    `;

    this.dropdownPanel = panel;
    this.updatePanelListContent();

    const searchInput = panel.querySelector('.search-input') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.value = this.searchKeyword;
      searchInput.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        this.searchKeyword = target.value;
        this.updatePanelListContent();
      });
    }

    const onOutsideClick = (e: MouseEvent) => {
      if (this.isOpen && this.dropdownPanel && !this.dropdownPanel.contains(e.target as Node) && !this.contains(e.target as Node)) {
        this.closeTeleportPanel();
        document.removeEventListener('click', onOutsideClick);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', onOutsideClick);
    }, 0);
  }

  private updatePanelListContent() {
    if (!this.dropdownPanel) return;
    const list = this.dropdownPanel.querySelector('.options-list');
    if (!list) return;

    const filtered = this.searchKeyword
      ? this.optionsData.filter(o => o.label.toLowerCase().includes(this.searchKeyword.toLowerCase()))
      : this.optionsData;

    if (filtered.length === 0) {
      const emptyTip = document.createElement('div');
      emptyTip.className = 'empty-tip';
      emptyTip.textContent = '未找到匹配选项';
      list.replaceChildren(emptyTip);
      return;
    }

    const items = filtered.map(opt => {
      const isSelected = this.selectedValues.includes(opt.value);
      const item = document.createElement('li');
      item.className = `option-item${isSelected ? ' selected' : ''}`;
      item.dataset.value = opt.value;
      const label = document.createElement('span');
      label.textContent = opt.label;
      item.appendChild(label);
      return item;
    });
    list.replaceChildren(...items);

    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = item.getAttribute('data-value');
        if (val) this.selectOption(val);
      });
    });
  }

  private updateTriggerLabel() {
    const labelContainer = this.shadow.querySelector('.label-container');
    if (!labelContainer) return;

    const placeholder = this.getAttribute('placeholder') || '请选择...';
    const isMultiple = this.hasAttribute('multiple');
    labelContainer.replaceChildren();

    if (this.selectedValues.length === 0) {
      const placeholderElement = document.createElement('span');
      placeholderElement.className = 'placeholder';
      placeholderElement.textContent = placeholder;
      labelContainer.appendChild(placeholderElement);
    } else if (isMultiple) {
      const tags = document.createElement('div');
      tags.className = 'tags-container';
      this.selectedValues.forEach(value => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        const item = this.optionsData.find(option => option.value === value);
        tag.textContent = item ? item.label : value;
        tags.appendChild(tag);
      });
      labelContainer.appendChild(tags);
    } else {
      const currentItem = this.optionsData.find(o => o.value === this.selectedValues[0]);
      const selectedLabel = document.createElement('span');
      selectedLabel.className = 'selected-label';
      selectedLabel.textContent = currentItem ? currentItem.label : this.selectedValues[0];
      labelContainer.appendChild(selectedLabel);
    }
  }

  private render() {
    const disabled = this.hasAttribute('disabled');

    if (this.optionsData.length === 0) {
      this.parseSlotOptions();
    }

    // 圆角统一下沉为 var(--radius-sm)，与全站 Input 输入框圆角绝对 100% 一致！
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          width: 100%;
          font-family: inherit;
        }

        .select-trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          min-height: 38px;
          padding: 6px 12px;
          box-sizing: border-box;
          border-radius: var(--radius-sm);
          font-size: 14px;
          font-weight: 400 !important;
          border: 1px solid var(--color-card-border);
          background: var(--color-card-bg);
          color: var(--color-text-primary);
          backdrop-filter: blur(var(--blur-card));
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          opacity: ${disabled ? '0.5' : '1'};
          transition: border-color var(--duration-normal) var(--ease-fluent-standard),
                      box-shadow var(--duration-normal) var(--ease-fluent-standard);
        }

        .select-trigger:hover:not(.disabled) {
          border-color: var(--color-card-border-hover);
        }

        .select-trigger.active {
          border-color: var(--color-accent-primary);
          box-shadow: 0 0 0 2px var(--color-accent-glow);
        }

        .label-container {
          flex: 1;
          display: flex;
          align-items: center;
        }

        .placeholder {
          color: var(--color-text-secondary);
        }

        .tags-container {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .tag {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          background: var(--color-accent-primary);
          color: #ffffff;
        }

        .arrow-icon {
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-secondary);
          transition: transform var(--duration-normal) var(--ease-fluent-standard);
          flex-shrink: 0;
          margin-left: 8px;
        }

        .select-trigger.active .arrow-icon {
          transform: rotate(180deg);
        }

        .arrow-icon svg {
          width: 100%;
          height: 100%;
          stroke: currentColor;
          stroke-width: 2.2;
        }
      </style>

      <div class="select-trigger ${disabled ? 'disabled' : ''} ${this.isOpen ? 'active' : ''}">
        <div class="label-container"></div>
        <span class="arrow-icon">${getIconSvg('chevron')}</span>
      </div>
    `;

    this.updateTriggerLabel();

    const trigger = this.shadow.querySelector('.select-trigger');
    if (trigger && !disabled) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleOpen();
      });
    }
  }
}

if (!customElements.get('ui-select')) {
  customElements.define('ui-select', UISelect);
}
