# Digital Collection Gallery

一个基于 `Electron + React + TypeScript + Vite` 的本地数字藏品展馆工具，用来导入按收藏集 ID 整理好的本地资源目录，完成浏览、筛选、精选展馆展示和全屏查看。

可以自行从其它地方获取收藏集图片
## 当前功能

- 导入本地收藏集根目录，自动扫描数字命名的收藏集文件夹
- 首页展示全部收藏集，支持按 ID 排序
- 进入收藏集详情页后浏览该收藏集下的全部图片和视频
- 全屏查看图片 / 视频，支持左右切换
- Hall 展馆模式
  - 精选卡片轮播
  - 桌面端 3D 卡环展示
  - 竖屏布局下的单卡沉浸式展示
  - 鼠标拖拽切换卡片
  - 点击主图进入全屏
  - 点击标题跳转到对应收藏集
- Hall Settings
  - 自定义 Featured Entry
  - 自定义标题、副标题、媒体资源
  - 拖拽排序
  - Builder / Gallery 双视图
  - Gallery 视图支持搜索、按收藏集筛选、多选、批量移除
- Settings
  - 收藏集展示名修改
  - 手动封面设置
  - Featured 媒体设置
  - 全屏轮播行为配置

## 技术栈

- `Electron`
- `React 19`
- `React Router`
- `TypeScript`
- `Vite`
- `pnpm`

## 环境要求

建议安装：

- `Node.js 20+`
- `pnpm 9+`

如果你还没安装 `pnpm`：

```bash
npm install -g pnpm
```

## 安装依赖

```bash
pnpm install
```

## 开发运行

```bash
pnpm dev
```

这个命令会同时启动：

- Vite 开发服务器
- Electron 主进程

## 构建

```bash
pnpm build
```

## 直接运行构建后的 Electron

先执行：

```bash
pnpm build
```

再执行：

```bash
pnpm start
```

## 代码检查

```bash
pnpm lint
```

## 导入规则

导入目录时，程序支持两种情况：

1. 直接导入某一个收藏集目录
   例如：

```text
E:\gallery\105435
```

2. 导入一个根目录，程序会扫描它下面所有“纯数字命名”的子目录
   例如：

```text
E:\gallery
├─ 102794
├─ 102857
├─ 105435
```

只有目录名是纯数字时，才会被识别为收藏集 ID。

## 支持的资源格式

图片：

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.gif`
- `.bmp`

视频：

- `.mp4`
- `.webm`
- `.mov`
- `.m4v`

## 资源显示规则

- 收藏集默认封面：
  - 优先使用手动设置的封面
  - 否则使用该收藏集的第一张图片
  - 如果没有图片，则回退到第一个视频
- 视频缩略图：
  - 如果同名图片存在，会优先用同名图片作为预览
  - 例如 `001_xxx.mp4` 会优先匹配 `001_xxx.png`

## 本地数据存储

程序会把配置文件和收藏集索引写到 Electron 的用户数据目录下：

```text
<userData>/gallery-data/
```

主要文件：

- `app-config.json`
- `collections.json`

这些文件保存的是：

- 已导入的目录
- Hall 精选配置
- 收藏集展示偏好
- 全屏播放相关设置

程序不会删除或改写你导入目录里的原始媒体文件。

## 主要页面说明

### 首页

- 导入收藏集目录
- 浏览全部收藏集
- 查看首页精选轮播

### Collection Detail

- 查看某个收藏集下的所有资源
- 点击卡片进入全屏查看

### Hall

- 以精选卡片的形式展示收藏内容
- 支持拖拽、点击、轮播和全屏查看

### Settings

- 修改收藏集展示名
- 指定封面和 Featured 媒体
- 配置全屏轮播行为

### Hall Settings

- 编辑 Hall 精选卡片
- Builder 模式下逐条配置
- Gallery 模式下批量预览和移除
