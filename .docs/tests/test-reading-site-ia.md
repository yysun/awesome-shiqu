# 阅读站信息架构 E2E

前置：`pnpm build` 成功；`pnpm preview` 运行于 http://127.0.0.1:4173/；`site/featured.json` 至少含 2 篇有效作品。

1. 打开首页：hero 下依次出现「精选」「最近收录」「按原著」「按主题」区块；无本机阅读记录时不出现「继续阅读」。导航为 精选 / 书目 / 分类 / 全部作品，首页无网格搜索框；顶栏搜索输入"黛玉"回车跳转到 `collection/?q=黛玉`，列表仅含标题/简介含"黛玉"的作品。
2. 打开 `featured/`：显示 `featured.json` 中的作品，顺序一致；临时把其中一条 path 改成不存在的作品并重新构建 → `pnpm build` 报错并指出路径；还原后构建成功。
3. 打开 `books/`：每部原著一张卡片，含封面、篇数、最近收录日期；点进 `books/红楼梦/` 显示主题/画风标签，点击标签进入 `themes/爱情与错过/`，列出全部该主题作品并有当前导航高亮"分类"。
4. 打开 `themes/`：列出主题与画风两组，各项篇数与 `collection/` 对应筛选结果一致；`styles/黏土定格/` 列出 3 篇三国作品。
5. 打开 `collection/`：原著 + 主题筛选组合后结果正确；切换"我的收藏"显示空状态；`collection/?scope=saved` 直接进入收藏视图。
6. 打开任一阅读页：头部返回链接指向所属书目页；面包屑可逐级点击；读到结尾出现上一篇/下一篇（同书）、同书更多、同主题更多，均不含当前篇；`reader.html?preview=1` 选择 ZIP 后不显示这些推荐；阅读页任何位置（含「出处、署名与转载说明」）都没有下载 ZIP 的链接。
7. 旧链接：`reader.html?story=<编号>` 正常打开；首页 `/#collection` 跳到 `collection/`，`/#contribute` 定位到投稿段落；`sitemap.xml` 含 `featured/`、`collection/`、`themes/` 与各分类页。
8. 读过一篇并收藏另一篇后回到首页：出现「继续阅读」区块且顺序为最近阅读在前，收藏入口指向 `collection/?scope=saved`；清空本机数据后区块消失。
9. 删除 `site/featured.json` 后 `pnpm build` 成功，首页无精选区且导航不显示"精选"，`featured/` 显示空状态；还原文件。
10. 390px 宽度：首页、`collection/`、`themes/`、阅读页无水平溢出；导航与搜索可用。
