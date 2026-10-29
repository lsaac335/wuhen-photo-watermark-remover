# 无痕修图 / Wuhen Photo Watermark Remover

一个隐私优先的本地照片去水印与修复工具。照片在设备内处理，不会上传到服务器。

A privacy-first, local photo watermark removal and inpainting tool. Images are processed on-device and are never uploaded to a server.

> 请仅处理你拥有或已获授权的照片。  
> Only process images that you own or are authorized to edit.

## 功能 / Features

- 画笔、矩形和擦除标记 / Brush, rectangle, and eraser selection tools
- 撤销、重做、缩放和原图还原 / Undo, redo, zoom, and reset
- 精细、平衡、强力三档修复 / Three repair strength levels
- 可拖动的前后对比 / Draggable before-and-after comparison
- PNG/JPG 导出 / PNG and JPG export
- 最高约 2000 万像素的本地处理 / Up to about 20 MP local processing
- Windows 桌面程序、macOS 桌面源码和浏览器版 / Windows desktop, macOS desktop source, and browser version

## 使用 / Usage

1. 打开照片，用画笔或矩形完整覆盖要修复的区域。
2. 选择修复强度，点击「立即修复」。
3. 用前后对比检查效果，导出 PNG 或 JPG。

The algorithm works best on skies, walls, tables, and other relatively simple backgrounds. For faces, repeated patterns, and dense text, repair smaller regions in multiple passes.

## 本地开发 / Development

需要 Node.js 22+ 和 pnpm 10+。

```bash
pnpm install
pnpm desktop:web
pnpm build
pnpm test
```

### Windows 桌面版

需要 .NET 6 SDK。

```powershell
pnpm desktop:web
dotnet publish desktop-app/WatermarkRemover.csproj -c Release -r win-x64 --self-contained true -o release/portable
```

### macOS 桌面版

`macos-app/` 包含 Electron 桌面壳。正式的 macOS 发布包应在 Mac 上构建，并使用 Apple Developer ID 签名和公证。仓库的 GitHub Actions 可生成未签名的 Apple Silicon 和 Intel 测试包。

`macos-app/` contains the Electron shell. Production macOS packages should be built on macOS and signed/notarized with an Apple Developer ID. The included GitHub Actions workflow can generate unsigned Apple Silicon and Intel test archives.

## 项目结构 / Project structure

- `app/` — React 修图界面与像素修复逻辑
- `desktop-web/` — 桌面版前端入口
- `desktop-app/` — Windows WinForms + WebView2 容器
- `macos-app/` — macOS Electron 容器
- `scripts/` — 打包辅助脚本
- `tests/` — 基础渲染测试

## 隐私与安全 / Privacy and security

- 图片处理不需要后端或账号。
- 项目不收集分析数据。
- 请不要在 issue 中上传私密原图。

See [SECURITY.md](SECURITY.md) for responsible disclosure guidance.

## 贡献 / Contributing

欢迎提交 issue 和 pull request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## 许可证 / License

[MIT](LICENSE)
