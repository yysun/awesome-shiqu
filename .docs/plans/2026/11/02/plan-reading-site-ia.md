# 阅读站信息架构重设计

Git base: `411c25f9a9ca4ed7a26e17ddbe2191b3b1b7db6a`。需求：`.docs/reqs/2026/11/02/req-reading-site-ia.md`；E2E：`.docs/tests/test-reading-site-ia.md`。

里程碑提交：`8d0ab73`（实现 + 测试 + 文档）、`e87061d`（移除 ZIP 下载链接）；`pnpm test` 76/76、`pnpm build` 通过。CR passed（独立评审，第 1 轮）。

Risk: non-low — 公开 URL 结构与导航属于消费者契约，跨构建脚本/客户端模块/模板协调，新增维护者数据文件（`site/featured.json`）。

## 结构决定

- **页面分工**：静态生成（SEO、无 JS）：`books/`、`books/<书>/`、`themes/`、`themes/<主题>/`、`styles/<画风>/`；客户端从目录渲染：首页 `./`、`featured/`、`collection/`、阅读页推荐区。`featured/index.html` 与 `collection/index.html` 由构建生成（见共享页面壳），脚本路径用 `../assets/`，`versionAssets` 的 `assets/<dep>"` 替换规则天然覆盖。
- **共享路由**：`site/assets/story-url.mjs` 新增 `facetRoutes(stories)`（主题 → `themes/<slug>/`，画风 → `styles/<slug>/`；slug 复用 `slugify`）、`compareLatest(a,b)`（最近收录优先，其次篇名，最后 `id`，与目录顺序无关）与 `assertUniqueSlugs(routes)`。构建对书名、主题、画风分别断言"不同标题不得映射到同一 slug"，碰撞即构建失败并列出冲突标题（目录由 PR 生成，失败在合并前可见；现有非冲突 URL 不变）。客户端复用同一函数，不自行拼路径。书目页顺序、阅读页上一篇/下一篇、首页"最近收录"全部使用 `compareLatest`。
- **精选**：`site/featured.json` → `{"stories":[{"path":"works/<用户名>/<作品名>.zip","note":"…"}]}`。`archiveCatalogEntry` 补充 `sourcePath`（与 `scripts/catalog.mjs` 对齐，schema 不变，仅加可选字段）；`validateCatalog` 校验可选 `sourcePath` 为满足 `validArchivePath` 的字符串。校验逻辑放在 `site/assets/featured.mjs`（Node 与浏览器共用）：对象、`stories` 数组 ≤ 50、`path` 满足 `validArchivePath`、`note` 为 ≤ 200 字符字符串、路径不重复。三种状态统一：文件不存在 → 构建与运行时均视为空精选（首页不渲染精选区、导航隐藏"精选"、`featured/` 显示空状态）；文件存在但格式错误 → 构建失败，运行时视为空并 `console.warn`；引用了目录中不存在的 `sourcePath` → 构建失败，运行时（远程目录可能领先/落后）跳过该条。旧版 `stories/` 清单作品没有 `sourcePath`，仍可浏览、不可被精选引用。
- **共享页面壳**：`scripts/build.mjs` 抽出 `pageShell({depth, active, title, description, canonical, cover, body, skipTarget})`，统一 masthead（品牌 + 导航：精选 / 书目 / 分类 / 全部作品 + 搜索表单 `GET collection/?q=`）、页脚与 canonical/Open Graph。静态列表页（`books/`、`books/<书>/`、`themes/`、`themes/<slug>/`、`styles/<slug>/`）以及客户端渲染的 `featured/`、`collection/` 都由构建用同一壳生成（后两者主体只有空容器与 `<script type="module">`），`site/` 不再手写这两页。首页 `site/index.html` 保留手写 hero，但 masthead/页脚标记与壳一致；构建以 `homePageHTML(template, base)` 为其注入 canonical/OG。阅读页保留精简 `reader-header`（返回书目 + 品牌 + 阅读方式 + 收藏/分享），新增面包屑，并追加与壳相同的页脚；不放主导航，避免干扰阅读。发布测试按页面类别断言：壳页面（首页、`books/*`、`themes/*`、`styles/*`、`featured/`、`collection/`）含同一组导航项与页脚，且除首页外恰有一个与自身类别匹配的 `aria-current="page"`；`featured.json` 为空时导航不含"精选"项，此时 `featured/` 页本身没有 `aria-current`（唯一例外），其余壳页面不变；阅读页（`reader.html` 与 `books/<书>/<故事>/`）只断言面包屑/返回链接与页脚；所有 HTML 的相对链接在各深度都能解析到 dist 内存在的文件或目录。`reader.html` 不写静态 canonical，`reader.mjs` 在通过 `?story=` 打开已收录作品时把 `<link rel="canonical">` 指向该作品静态页。
- **客户端模块**：`cards.mjs`（从 `shelf.mjs` 抽出 `storyCard`，供首页/精选/全部作品/阅读页推荐共用，带收藏按钮与阅读进度）；`shelf.mjs` 改为 `collection/` 页脚本（保留搜索/排序/收藏切换，新增原著、主题、画风下拉可组合筛选，读取 `?q=` 与 `?scope=saved`）；新增 `home.mjs`、`featured.mjs`（页面脚本名 `featured-page.mjs` 以区分数据模块）。
- **阅读页**：`reader.html` 返回链接与新增面包屑在有路由时指向书目页；移除「出处、署名与转载说明」中的「下载作品 ZIP」链接及其脚本（用户要求不提供下载）；`story-ending` 增加上一篇/下一篇与"同书更多""同主题更多"（各 ≤ 3，排除当前篇），本地试读隐藏。模板 `"./` → `"../../../"` 的重写规则不变。
- **兼容**：首页 `#collection` 哈希跳转到 `collection/`；首页保留 `id="contribute"` 投稿段落，`#contribute` 锚点继续有效；`reader.html?story=`、`?preview=1` 不变；`copySite` 保留路径加入构建生成的 `themes`、`styles`、`featured`、`collection`。
- **样式**：复用 `story-card`、`story-grid`、`section-heading`、`shelf-tabs`、`filters`、`nav-link`；新增少量类：`.masthead-search`、`.book-card`、`.facet-chips`、`.breadcrumb`、`.story-nav`（上一篇/下一篇）、`.recommend`。不改配色与字体。

## 任务

- [x] `site/assets/story-url.mjs`：新增 `facetRoutes`、`compareLatest`、`assertUniqueSlugs`；`tests/story-url.test.mjs` 覆盖书名/主题/画风碰撞报错（含标点与截断差异）、空主题跳过、同日同名按 `id` 稳定排序。
- [x] `site/assets/featured.mjs`：`validateFeatured(data)`、`loadFeatured({root, fetcher})`、`matchFeatured(featured, stories)`；`scripts/archive-library.mjs` 的 `archiveCatalogEntry` 增加 `sourcePath`；`validateCatalog` 校验可选 `sourcePath`；`tests/library-loader.test.mjs` 新增精选校验、缺文件为空、格式错误告警且为空、未匹配条目跳过、旧版无 `sourcePath` 作品仍通过的用例。
- [x] `scripts/build.mjs`：`pageShell`、`homePageHTML`（为 `index.html` 注入 canonical/OG）、生成 `featured/index.html` 与 `collection/index.html`；`booksPageHTML` 卡片含封面、篇数、最近收录；`bookPageHTML` 显示主题/画风标签、其他书目入口、按 `compareLatest` 排序；新增 `themesPageHTML`、`facetPageHTML` 并写入 `themes/`、`themes/<slug>/`、`styles/<slug>/`；读取并校验 `site/featured.json`（缺失为空、格式错误或未知路径失败）；`sitemapXML` 加入 `featured/`、`collection/`、`themes/` 及各分类页；保留路径加入 `themes`、`styles`、`featured`、`collection`；`tests/publishing.test.mjs` 覆盖新页面、每个 HTML 的导航/页脚/`aria-current`/相对链接可解析、分类名与推荐语 HTML 转义、缺少主题的作品不进入分类页、无精选文件可构建、无效精选报错、sitemap。
- [x] `site/assets/cards.mjs` + `site/assets/shelf.mjs`：抽出卡片；`collection/` 页脚本承载检索网格，支持 `?q=`、`?scope=saved` 与原著/主题/画风组合筛选。
- [x] `site/index.html` + `site/assets/home.mjs`：首页区块（hero、精选、最近收录、按原著、按主题/画风、继续阅读与收藏入口、关于、投稿）；无数据区块不渲染；`#collection` 跳转。
- [x] `site/assets/featured-page.mjs`：精选页渲染与空状态。导航是否含"精选"由构建按 `site/featured.json` 是否为空统一决定（首页 masthead 也由构建替换），客户端不再单独切换——`featured.json` 随站点一起部署，两者不会不一致。
- [x] `site/reader.html` + `site/assets/reader.mjs`：面包屑、返回书目、共用页脚、上一篇/下一篇、同书/同主题推荐；`?story=` 打开时设置 canonical；试读隐藏。
- [x] `site/assets/site.css`：新增类样式，含 760px 以下导航与搜索的收纳。
- [x] `site/featured.json`：初始精选 6 篇，带简短中性推荐语；构建曾因一个文件名写错而失败并指出路径，验证了校验路径。
- [x] `README.md`：更新"阅读站怎样更新"中的 `pnpm build` 生成页面说明与首页导航描述；说明 `site/featured.json`。
- [x] 验证：`pnpm test`、`pnpm build`、`pnpm preview` 下逐页检查链接与 390px 布局（见 E2E）。SS 阶段：`pnpm test` 76/76，`pnpm build` 17 篇/2 书目/4 分类/6 精选；headless Chrome 检查首页、`collection/?q=`、`?scope=saved`、`#collection` 跳转、`reader.html?story=` 的 canonical/面包屑/上一篇下一篇/推荐，以及 390px/1280px 截图。
- 补充：`tests/publication.test.mjs` 的工作区复制了生产 `site/`，需移除 `featured.json` 才能用测试 ZIP 构建（精选校验按设计拒绝未收录路径）。

## 风险

- 远程目录（GitHub）与本地 `featured.json` 可能短暂不一致：客户端跳过缺失项，不报错。
- 主题/画风为自由文本，分类可能碎片化；索引仅显示实际存在的值，不做归一化。
- `site.css` 为单行压缩文件，编辑需谨慎避免破坏既有规则。
