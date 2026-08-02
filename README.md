<div style="margin: auto; padding-top: 32px; text-align: center;">
    <img src="./assets/icon.png" width="48" height="48" style="display: block; margin: 0 auto 8px;">
    <h1 style="border: none; margin-bottom: 0px;">NewerTabX</h1>
    <span>高可自定义性的新生代浏览器开始页</span>
</div>

## 功能与特性

- 卡片式仪表盘：可拖拽布局，卡片由 JS 模块定义可充分自定义
- 自定义壁纸：支持Bing每日壁纸 / 自定义 URL / 视频 / 脚本获取
- 面向大语言模型：支持 AI 生成自定义需求卡片
- 设计语言：Fluent Design 与 Windows 系统无缝衔接

## 安装与使用

### Windows

- **安装版**：从 [GitHub Releases](https://github.com/XDragonWorks/NewerTabX/releases) 下载最新的安装包 `NewerTabX-Setup-x.y.z.exe` 并运行即可完成安装
- **便携版**：从 [GitHub Releases](https://github.com/XDragonWorks/NewerTabX/releases) 下载最新的编写版本 `NewerTabX-portable-x.y.z-windows.zip` 并解压运行 `NewerTabX.exe` 即可直接使用
### macOS

从 [GitHub Releases](https://github.com/XDragonWorks/NewerTabX/releases) 下载 `NewerTabX-x.y.z-macos.tar.gz` 并且解压，运行其中的 `NewerTabX`。<br>
首次运行可能需在"系统设置 → 隐私与安全性"中允许，或右键 → 打开。

### 浏览器插件

在扩展管理页开启开发者模式，加载 `NewerTabX-extension-x.y.z.zip` 解压后的目录即可。

## 本地开发

前置：Node.js 20+、Python 3.10+

```bash
# 后端（DEV=1 开启代码变更自动重载）
cd backend
pip install -r requirements.txt
DEV=1 python main.py        # Windows cmd: set DEV=1 && python main.py

# 前端
cd frontend
npm ci
npm run dev
```

开发过程中的数据保存在 `backend/data/`。

## 构建

```bash
# Windows（.ps1）/ macOS、Linux（.sh）
powershell -ExecutionPolicy Bypass -File build\build-backend.ps1   # build/build-backend.sh
```

如果遇到问题请先尝试询问 AI 解决，确认是 BUG 之后欢迎提交修复。

## 贡献

欢迎 Issue 和 Pull Request。提交 PR 前请确保：

- `Human in the loop`，提交的 PR 至少受到过提交者的简要审核
- `cd frontend && npm run build` 通过
- `python -m py_compile backend/main.py` 通过

## 许可证

[GPLv3](LICENSE)