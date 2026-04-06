# CS Author Tools

`CS Author Tools` 是一个 Chrome 扩展，目前包含两个功能：

- `投稿状态记录`：面向 ScholarOne / Manuscript Central 作者页面，用于自动抓取和保存投稿状态。
- `Scholar 统计`：面向 Google Scholar 个人主页，用于补充文章数量、第一作者数量和 CCF 统计。

## 功能一：投稿状态记录

用于监测并记录 `https://mc.manuscriptcentral.com/xxx` 各期刊 Author Dashboard 的投稿状态变化。

### 使用方式

1. 打开 `https://mc.manuscriptcentral.com/xxx` 对应期刊页面并登录。
2. 切换到 Author 选项卡，页面中出现 `Author Dashboard`。
3. 扩展会自动抓取并更新投稿状态，不需要额外点击。
4. 点击扩展图标，在 `投稿状态记录` 选项卡中查看全部期刊记录。
5. 如有需要，可在弹窗中导出 JSON、导入 JSON 或清空记录。

## 功能二：Scholar 统计

用于增强 Google Scholar 个人主页右侧 `Cited by` 区块的统计信息，并高亮当前作者姓名。

### 使用方式

1. 打开 Google Scholar 个人主页。
2. 扩展会自动在右侧 `Cited by` 区块下方插入统计信息。
3. 点击扩展图标，在 `Scholar 统计` 选项卡中控制功能开关。
4. 若需要显示 CCF 统计，需要先安装 easyScholar 插件并启用其中的 CCF 显示。

## 安装方法

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择本项目目录

## 说明

- 为适配页面异步渲染，扩展会在页面加载后多次检测并监听 DOM 变化。
- 本地保存使用 `chrome.storage.local`，数据仅保存在你的浏览器本地。
