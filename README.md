<div align="center">
  <img src="resources/icon.png" alt="Vfan TV Logo" width="120" />

# Vfan TV

> **Vfan TV** 是一款免费开源、开箱即用、跨平台的桌面端影视聚合播放器。  
> 基于 **TypeScript** + **Electron** + **React** + **Tailwind CSS** 构建，支持多源搜索、在线播放、收藏与播放记录。

[![Release](https://img.shields.io/github/v/release/vfanlee/vfan-tv?display_name=tag&style=flat-square)](https://github.com/vfanlee/vfan-tv/releases/latest)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue?style=flat-square)](LICENSE)

</div>

> [!IMPORTANT]
> 该软件为**空壳影视播放器**，无内置点播源和直播源，需要自行收集配置。

> [!WARNING]
> 请不要在 B 站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何「科技周刊 / 月刊」类项目或站点收录本项目。

## ✨ 功能特性

- 🖥️ **跨平台桌面客户端**：支持 Windows / macOS 平台
- 🔍 **多源聚合搜索**：一次搜索聚合多个点播源，支持按影片聚合或按点播源查看结果
- ▶️ **支持点播**：支持剧集选集、换源、播放进度记录、历史续播、收藏和自动续播
- 📺 **支持直播**：支持 M3U 直播源、频道分组、频道搜索、多线路切换和上次选择记忆
- ⚙️ **数据管理**：支持 点播源、直播源的导入 / 导出 / 订阅同步，以及应用数据备份、导入和初始化
- 🌗 **主题切换**：支持浅色、深色和跟随系统主题

## 📥 下载

前往 [**Releases**](https://github.com/vfanlee/vfan-tv/releases/latest) 下载对应平台的安装包：

| 平台       | 架构        |
| ---------- | ----------- |
| 🪟 Windows | x64 / arm64 |
| 🍎 macOS   | arm64       |

## 🧰 技术栈

| 技术栈      | 说明                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| 语言        | [TypeScript](https://www.typescriptlang.org/)                                                                   |
| 桌面框架    | [Electron](https://www.electronjs.org/)、[electron-vite](https://github.com/alex8088/electron-vite)             |
| 前端框架    | [React](https://react.dev/)、[React Router](https://reactrouter.com/)、[Zustand](https://zustand.docs.pmnd.rs/) |
| UI 框架组件 | [Tailwind CSS](https://tailwindcss.com/)、[shadcn/ui](https://ui.shadcn.com/)                                   |
| 播放器      | [ArtPlayer](https://artplayer.org/)、[HLS.js](https://github.com/video-dev/hls.js/)                             |
| 数据存储    | [SQLite](https://www.sqlite.org/)、[Drizzle ORM](https://orm.drizzle.team/)                                     |
| 代码质量    | [ESLint](https://eslint.org/)、[Prettier](https://prettier.io/)                                                 |

## ⚒️ 重要配置说明

### 订阅源格式

订阅源地址返回内容是 **Base58 编码后的 JSON 字符串**。

解码后必须是配置对象：

```jsonc
{
  // 上次更新时间
  "updatedAt": 1782518400000,
  // 点播源
  "vod": [
    {
      "name": "示例点播源",
      "url": "https://example.com/api.php/provide/vod",
      "referer": "https://example.com",
      "enabled": true,
    },
  ],
  // 直播源
  "live": [
    {
      "name": "示例直播源",
      "url": "https://example.com/live.m3u",
      "enabled": true,
    },
  ],
}
```

### 点播源格式

- `name`: 点播源名称
- `url`: 点播源 URL
- `referer`: 点播源 Referer。可选，默认为空
- `enabled`: 是否启用。可选，默认为 `false`

示例：

```json
[
  {
    "name": "示例源",
    "url": "https://example.com/api.php/provide/vod",
    "referer": "https://example.com",
    "enabled": true
  }
]
```

### 直播源格式

- `name`: 直播源名称
- `url`: 直播源 URL
- `enabled`: 是否启用。可选，默认为 `true`

示例：

```json
[
  {
    "name": "示例源",
    "url": "https://example.com/live.m3u",
    "enabled": true
  }
]
```

## ⚠️ 重要声明

- 本项目**仅供学习和个人使用**
- 请勿将部署的实例用于**商业用途**或**公开服务**
- 如因公开分享导致的任何法律问题，用户需**自行承担责任**
- 项目开发者不对用户的使用行为承担任何法律责任
- 本项目**不在中国大陆地区提供服务**。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任

## 📄 许可证

本项目采用 [**GNU General Public License v3.0**](LICENSE)（GPL-3.0）开源协议。

- 自由使用、研究、修改和分发
- 修改后的衍生作品须以相同协议开源，并向接收者提供完整源代码

## ❓ 常见问题

### macOS 安装运行后显示「文件已损坏」？

1. 在终端执行以下命令移除隔离属性：

   ```bash
   xattr -rd com.apple.quarantine "/Applications/Vfan TV.app/"
   ```

2. 重新打开应用。

## 🙏 致谢

- [LunaTV](https://github.com/MoonTechLab/LunaTV) —— 灵感来源，由此启发
- 感谢社区提供的优秀工具与库
- 感谢所有提供免费影视接口的站点

---

<div align="center">

**如果这个项目对你有帮助，欢迎 Star ⭐**

</div>
