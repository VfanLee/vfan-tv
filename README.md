<div align="center">
  <img src="resources/icon.png" alt="Vfan TV Logo" width="120" />

# Vfan TV

> **Vfan TV** 是一款免费开源、跨平台的桌面端影视聚合客户端（空壳）。

[![Release](https://img.shields.io/github/v/release/vfanlee/vfan-tv?display_name=tag&style=flat-square)](https://github.com/vfanlee/vfan-tv/releases/latest)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue?style=flat-square)](LICENSE)

</div>

## ⚠️ 免责声明

在下载、安装或使用本软件前，请仔细阅读并理解下列条款。继续使用即视为您已知悉并接受：

1. **软件性质**  
   本软件系影视聚合客户端（空壳），**不提供、不内置、不运营**任何点播源、直播源或视听内容。全部数据源、链接及播放内容均由用户自行获取、配置与使用。

2. **使用范围**  
   本软件仅供个人学习与研究目的使用。**禁止**将本软件用于任何商业用途，**禁止**基于本软件对外提供公开服务、运营平台或有偿服务。

3. **责任归属**  
   用户对其自行收集、配置、访问或传播的数据与内容，以及由此产生的全部使用行为，独立承担法律责任。因公开分享、传播、运营或违法使用本软件所引发的争议、索赔、处罚或其他法律后果，均由用户自行负责；项目作者及贡献者不对前述事项承担任何责任。

4. **合规义务**  
   用户应遵守其所在国家或地区的法律法规，并确保自身使用行为合法。请低调使用本软件，避免不当传播与宣传。

5. **宣传与收录限制**  
   未经权利人书面授权，任何人不得在哔哩哔哩、小红书、微信公众号、抖音、今日头条及其他中国大陆社交平台，以视频、图文等方式宣传本项目；亦不得以「科技周刊 / 月刊」或其他媒体、站点形式收录、转载或推广本项目。

6. **无运营服务**  
   本项目不向任何国家或地区提供运营性服务、内容分发服务或技术托管服务。任何第三方在当地安装、使用本软件或对外提供相关服务的行为，均属其个人或该第三方行为，相关法律风险与责任由其自行承担，与本项目无关。

## ✨ 功能特性

- 📦 **多源管理**：订阅源、点播源、直播源可添加、启用与同步
- 🔍 **全源搜索**：一次搜索多个点播源
- 🎬 **点播观看**：资源库分类浏览，或按热门内容发现
- 🔀 **换源备用**：播放时可换源，支持备用地址切换
- 📡 **直播**：播放 IPTV 直播频道
- 📻 **电台**：收听网络电台
- 🔗 **直链播放**：粘贴视频链接即可播放
- ⭐ **收藏**：收藏喜欢的影视内容
- 🕘 **播放记录**：自动记住进度，方便继续观看
- 🎨 **外观**：亮色 / 暗色 / 跟随系统，可切换首页风格
- 🧭 **侧边栏**：可按需显示电台、直链、最近播放、收藏等入口
- 🪟 **迷你窗口**：小窗继续播放
- 💾 **数据管理**：备份与恢复本地数据
- ⬆️ **应用更新**：应用内检查、下载与安装更新
- 💻 **跨平台**：支持 macOS、Windows

## 📥 下载

前往 [**Releases**](https://github.com/vfanlee/vfan-tv/releases/latest) 下载对应平台的安装包：

| 平台       | 架构        |
| ---------- | ----------- |
| 🍎 macOS   | M系 / intel |
| 🪟 Windows | x64 / arm64 |

## 🧰 技术栈

| 架构分层      | 主要技术栈                                            |
| ------------- | ----------------------------------------------------- |
| 🖥️ 桌面运行时 | Electron                                              |
| 🛠️ 构建与分发 | Electron Forge（Webpack）、electron-updater           |
| 🗄️ 数据层     | better-sqlite3、Drizzle ORM、Zod                      |
| 🎨 渲染层     | React、React Router、Zustand、Tailwind CSS、shadcn/ui |
| ▶️ 播放层     | ArtPlayer、hls.js、mpegts.js                          |

## ⚙️ 重要配置说明

### 📦 订阅源格式

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
      "backups": [
        {
          "url": "https://backup.example.com/api.php/provide/vod",
          "referer": "https://backup.example.com",
        },
      ],
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

### 🎬 点播源格式

- `name`: 点播源名称
- `url`: 点播源 URL
- `referer`: 点播源 Referer。可选，默认为空
- `enabled`: 是否启用。可选，默认为 `false`
- `backups`: 备用点播地址列表。可选，默认空数组；不能包含当前 `url`，切换时会与当前地址交换

示例：

```json
[
  {
    "name": "示例源",
    "url": "https://example.com/api.php/provide/vod",
    "referer": "https://example.com",
    "enabled": true,
    "backups": [
      {
        "url": "https://backup.example.com/api.php/provide/vod",
        "referer": "https://backup.example.com"
      }
    ]
  }
]
```

### 📡 直播源格式

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
