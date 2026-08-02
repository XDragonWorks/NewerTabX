import './styles/main.css';
import './components/index';
import { showToast } from './components/ui-toast';
import { getPerformanceConfig, applyPerformanceConfig } from './utils/performance';

const initialPerfConfig = getPerformanceConfig();
applyPerformanceConfig(initialPerfConfig);

const appContainer = document.querySelector('#app');
if (appContainer !== null) {
  appContainer.innerHTML = `
    <div style="padding: 32px; max-width: 1100px; margin: 0 auto; width: 100%; box-sizing: border-box; overflow-y: auto; height: 100vh;">
      <header style="margin-bottom: 32px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 8px;">UI Component Gallery & Lab</h1>
          <p style="color: var(--color-text-secondary); font-size: 14px;">独立的控件画廊与交互测试实验室 (Standalone Lab)</p>
        </div>
        <div style="display: flex; gap: 12px;">
          <a href="/index.html" style="text-decoration: none;">
            <ui-button icon="arrow-left">返回主导航页</ui-button>
          </a>
          <ui-button id="btn-toggle-theme" icon="sun">切换暗色/亮色</ui-button>
        </div>
      </header>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
        
        <!-- 1. Buttons, Toggle & Checkbox -->
        <ui-card title="Buttons, Toggle & Checkbox">
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <ui-button variant="primary" icon="save">Primary Button</ui-button>
              <ui-button icon="calendar">Standard Button</ui-button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 4px;">
              <ui-toggle label="半透明亚克力玻璃特效" ${initialPerfConfig.material === 'acrylic' ? 'checked' : ''}></ui-toggle>
              <ui-checkbox label="打勾正中心对齐测试" checked></ui-checkbox>
            </div>
          </div>
        </ui-card>

        <!-- 2. Select Dropdown -->
        <ui-card title="Fluent Dropdown (<ui-select>)">
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div>
              <label style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 6px; display: block;">标准 Fluent Select Dropdown (无粗体抖动)</label>
              <ui-select value="high">
                <option value="high">高性能预设</option>
                <option value="medium">中等性能</option>
                <option value="low">低性能模式</option>
              </ui-select>
            </div>
            <div>
              <label style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 6px; display: block;">多选 Tags Dropdown (Multiple + Searchable)</label>
              <ui-select multiple searchable value="blur,flip">
                <option value="blur">高斯模糊特效 (Acrylic Blur)</option>
                <option value="shimmer">微光轮廓高光 (Shimmer Highlight)</option>
                <option value="flip">Modal“有源” FLIP 展开动画</option>
              </ui-select>
            </div>
          </div>
        </ui-card>

        <!-- 3. Radio Group & Slider -->
        <ui-card title="Radio Group 互斥组 & Slider 双轨">
          <div style="display: flex; flex-direction: column; gap: 18px;">
            <div>
              <label style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px; display: block;">壁纸源选择 (Radio Group 自动互斥)</label>
              <ui-radio-group value="bing">
                <ui-radio label="Bing 每日壁纸" value="bing"></ui-radio>
                <ui-radio label="静态图" value="static"></ui-radio>
                <ui-radio label="纯色" value="color"></ui-radio>
              </ui-radio-group>
            </div>

            <div>
              <ui-slider label="高斯模糊半径" min="0" max="40" value="12" unit="px"></ui-slider>
            </div>
          </div>
        </ui-card>

        <!-- 4. Code Editor Component -->
        <ui-card title="Fluent Code Editor (<ui-code-editor>)">
          <p style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 10px;">
            独立带行号侧边栏、Tab 智能补全与 Web Component 响应式代码编辑器。
          </p>
          <ui-code-editor height="160px" value="export default {\n  mount: (shadow, sdk) => {\n    console.log('Hello Card!');\n  }\n};"></ui-code-editor>
        </ui-card>

        <!-- 5. Toast Notifications -->
        <ui-card title="Toast Notifications">
          <p style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 12px;">
            右划滑入/滑出、两阶段分步上移、Hover 暂停倒计时与多行支持。
          </p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <ui-button id="btn-toast-info" icon="info">Info</ui-button>
            <ui-button id="btn-toast-success" icon="check">Success</ui-button>
            <ui-button id="btn-toast-multiline" variant="primary" icon="code">测试多行 Toast</ui-button>
          </div>
        </ui-card>

      </div>
    </div>
  `;

  document.querySelector('#btn-toggle-theme')?.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    showToast({ message: `主题已切换至 ${newTheme === 'dark' ? '暗色' : '亮色'} 模式`, type: 'info' });
  });

  document.querySelector('#btn-toast-info')?.addEventListener('click', () => {
    showToast({ message: '这是一条标准的 Fluent 提示信息', type: 'info' });
  });
  document.querySelector('#btn-toast-success')?.addEventListener('click', () => {
    showToast({ message: '操作成功并已持久化保存！', type: 'success' });
  });
  document.querySelector('#btn-toast-multiline')?.addEventListener('click', () => {
    showToast({
      message: '这是一条包含多行文本的 Toast 消息：\n1. 支持换行排版与自动拉伸\n2. 鼠标 Hover 悬停在 Toast 上会自动暂停所有 Toast 的倒计时',
      type: 'warning',
      duration: 5000
    });
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add('app-ready');
    });
  });
}
