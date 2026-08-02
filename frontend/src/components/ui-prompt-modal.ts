import { UIModal } from './ui-modal';
import { showToast } from './ui-toast';
import type { UICodeEditor } from './ui-code-editor';

export const CARD_AI_PROMPT_TEMPLATE = `
你正在为本系统编写一个本地可信 Card JavaScript 模块。请只输出可直接粘贴部署的 JavaScript，不要输出 Markdown 代码围栏，也不要使用 import。

模块格式：
module.exports = {
  // 可选元数据,用于卡片库展示:
  name: '卡片名称',           // 缺省时显示卡片 ID
  icon: 'sun',                // 内置图标名称,或内联 SVG 字符串(会做安全校验)
  description: '一句话描述',   // 可省略
  mount: (shadowRoot, sdk) => {
    const container = shadowRoot.querySelector('.card-container');
    // 在 container 中渲染卡片。
  },
  unmount: (shadowRoot) => {
    // 清理定时器和全局事件监听器。
  }
};

可用能力：
1. sdk.proxyFetch(url, init)：通过后端代理发起 HTTP/HTTPS 请求，支持 JSON、文本、Blob、FormData 和二进制请求体。
2. sdk.registerEnvironmentVariable({ key, defaultValue, description, secret })：注册环境变量。key 使用大写字母、数字和下划线。
3. await sdk.getEnvironmentAsync('API_KEY')：读取指定环境变量；若不存在，系统会自动注册并在环境变量设置页提示用户。
4. sdk.getEnvironment()：只返回 baseUrl、dataRoot 和当前 light/dark 主题，不会返回全部密钥。
5. sdk.cache.get/set/delete：卡片独立命名空间缓存。图片请使用 Blob，JSON 建议使用 .json 后缀。
6. sdk.navigate(url, '_self' | '_blank')：当前标签页或新标签页导航。
7. sdk.showToast({ message, type })：显示系统 Toast。
8. sdk.eventBus.on/off/emit：卡片之间发布订阅事件。
9. sdk.settings.register(definition)：向全局“卡片设置”页注册设置。支持 text、number、boolean、select、component。
10. sdk.settings.get('card.example.option', defaultValue)：读取已保存的卡片设置。
11. sdk.settings.onChange(id, callback)：设置保存后接收变化，并返回取消监听函数。

UI 与外观要求：
- 可直接使用 <ui-card>、<ui-button>、<ui-input>、<ui-select>、<ui-toggle>、<ui-slider> 等系统 Web Components。
- 使用 --color-text-primary、--color-text-secondary、--color-accent-primary、--color-card-bg、--color-card-border、--radius-sm、--radius-md、--duration-normal、--ease-fluent-standard 等 CSS 变量。
- 禁止 Emoji，图标使用系统组件的 icon 属性。
- 不要写固定主题颜色；如需衍生色，基于系统 CSS 变量计算。
- 不要访问 window、document、localStorage 或直接 fetch；只使用传入的 shadowRoot 和 sdk。
- 自定义代码在页面上下文运行，Shadow DOM 仅负责样式隔离，因此必须把输入内容当作不可信文本处理，禁止拼接到 innerHTML。

请生成以下卡片：
[在这里填写卡片需求]
`.trim();

export class UIPromptModal extends HTMLElement {
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
        .prompt-box { display: flex; flex-direction: column; gap: 12px; }
        .prompt-description { margin: 0; font-size: 13px; color: var(--color-text-secondary); }
      </style>
      <ui-modal id="inner-prompt-modal" title="AI Card 开发 Prompt" width="680px">
        <div class="prompt-box">
          <p class="prompt-description">复制这份规范并补充卡片需求，即可让 AI 生成可部署的 Card JavaScript。</p>
          <ui-code-editor id="prompt-editor" readonly height="360px"></ui-code-editor>
        </div>
        <div slot="footer">
          <ui-button id="btn-cancel-prompt">关闭</ui-button>
          <ui-button variant="primary" id="btn-copy-prompt" icon="copy">复制 Prompt</ui-button>
        </div>
      </ui-modal>
    `;

    this.modal = this.shadow.querySelector('#inner-prompt-modal') as UIModal | null;
    const editor = this.shadow.querySelector('#prompt-editor') as UICodeEditor | null;
    if (editor !== null) editor.value = CARD_AI_PROMPT_TEMPLATE;

    this.shadow.querySelector('#btn-cancel-prompt')?.addEventListener('click', () => this.close());
    this.shadow.querySelector('#btn-copy-prompt')?.addEventListener('click', () => {
      navigator.clipboard.writeText(CARD_AI_PROMPT_TEMPLATE).then(() => {
        showToast({ message: 'AI Prompt 已复制', type: 'success' });
      }).catch(error => {
        console.error('[PromptModal] Clipboard write failed:', error);
        showToast({ message: '复制失败，请在编辑器中手动复制', type: 'warning' });
      });
    });
  }
}

if (!customElements.get('ui-prompt-modal')) {
  customElements.define('ui-prompt-modal', UIPromptModal);
}
