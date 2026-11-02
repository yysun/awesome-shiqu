# 阅读站信息架构重设计

## Summary

按同类阅读站的常见模式（导航对应浏览维度、首页精选→最新→分类 rail、三类规范页、阅读页"你在哪里"）重组站点：

- 主导航 **精选 · 书目 · 分类 · 全部作品** + 顶栏搜索（`GET collection/?q=`），所有壳页面与页脚由 `scripts/build.mjs` 的 `pageShell`/`mastheadHTML`/`footerHTML` 统一生成；首页 masthead 也由构建替换并注入 canonical/OG。
- 首页改为精选、最近收录、按原著、按主题与画风、继续阅读/我的收藏、关于、投稿；无数据区块不渲染；`#collection` 跳转到 `collection/`，`#contribute` 保留。
- 新增静态页 `themes/`、`themes/<主题>/`、`styles/<画风>/`，书目总览卡片含封面/篇数/最近收录，书目页含主题/画风标签与其他书目入口；新增客户端页 `featured/`、`collection/`（搜索 + 原著/主题/画风组合筛选 + 排序 + 收藏，支持 `?q=`/`?scope=saved`）。
- 阅读页：返回链接指向书目页、面包屑、`?story=` 打开时设置 canonical、同书上一篇/下一篇、同书与同主题推荐（各 ≤3、去重）、共用页脚；按用户要求移除「下载作品 ZIP」链接。
- 精选来源 `site/featured.json`（按 `works/` 路径引用，含可选推荐语）：缺失为空，格式错误或引用未收录作品时构建失败，运行时跳过未匹配项；目录条目补充 `sourcePath` 并在 `validateCatalog` 校验。
- 共享路由模块新增 `compareLatest`（日期→篇名→id）、`facetRoutes`、`groupByBook`、`slugConflicts`；不同书名/主题/画风映射到同一 slug 时构建失败并列出冲突。
- README 更新站点结构、精选文件与冲突规则说明。

## Verification

- `pnpm test`：76/76 通过（新增路由、精选、目录 `sourcePath`、分类页/壳页面/链接可解析/转义/精选状态/slug 冲突测试；`tests/publication.test.mjs` 工作区移除生产 `featured.json`）。
- `pnpm build`：17 篇 / 551 幅 / 2 书目 / 4 分类页 / 6 精选；曾因精选文件名写错失败并指出路径。
- headless Chrome 对 `pnpm preview` 站点：首页区块与数量、`collection/?q=黛玉`、`?theme=`/`?style=`/`?book=&theme=` 组合计数与分类页一致、`?scope=saved`、`#collection` 跳转、`reader.html?story=` 的 canonical/返回/面包屑/上一篇下一篇/推荐、种子 localStorage 后的「继续阅读」与收藏入口、sitemap 条目；390px 与 1280px 截图（首页、全部作品、分类、书目、阅读页结尾）。
- 独立 CR：通过，另行核对 dist 内 29 个 HTML 的 448 个相对链接全部可解析。
- 评审/验证记录：`AR passed`（4 轮文档修订后）、`CR passed: no major findings`。
- 未覆盖：本地 ZIP 试读隐藏推荐仅依据代码路径（headless 无法选择文件）；真实 GitHub Pages 部署未执行。

VR passed: all acceptance criteria complete

## Notes

- `stories/` 已被旧版清单目录占用，全部作品页使用 `collection/`。
- 导航是否显示"精选"由构建按 `featured.json` 决定，客户端不再切换；两者随站点一起部署。
- 书目总览按书名排序（README 既有约定），首页"按原著"按最新收录排序。
- 未做排行榜、回目顺序解析或视觉改版；`site.css` 仅追加规则。
