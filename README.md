# awesome-shiqu · 拾趣好故事

通过 GitHub PR 收藏值得读、值得回看的拾趣连环画。作者提交 ZIP，维护者审核收录；阅读器从 GitHub 下载 ZIP，在手机或电脑的浏览器里展开阅读。

[拾趣](https://github.com/yysun/shiqu)负责创作，本仓库负责精选与展示。初始版本不预置测试故事。

## 提交一篇作品

1. 在拾趣中完成故事，下载「分镜与图片 ZIP」。检查完整 ZIP 中的文字、图片和提示词是否适合公开。
2. Fork 本仓库，把 ZIP 原样放到 `works/<你的 GitHub 用户名>/<作品名>.zip`，例如 `works/yysun/黄忠智取定军山.zip`。可以保留拾趣导出的中文文件名。
3. 发起 PR，在模板中说明出处、收录理由和展示许可。维护者审核通过后合并。

**投稿只需要一个 ZIP。** 标题、原著、图片顺序、旁白、结语、改编说明和生成模型从 ZIP 内的 `故事.json` 提取；用户名目录作为默认署名。封面与目录自动生成，无需手写 JSON，也不用提交解压后的图片。旧版仅含 `分镜.md` 的 ZIP 仍可阅读；两者同时存在时以 JSON 为准，JSON 无效时会明确报错，不退回 Markdown。

简介兼容新版 `summary` 与旧版 `hook`；优先读取 `summary`，仅在该字段缺失时读取 `hook`。公开清单仍统一使用 `hook`，作品集卡片、阅读页与分享的显示方式不变。

阅读页的作品信息及「出处与改编说明」显示去重后的模型名。公开清单的可选 `generationModels` 字段只保存模型名字符串数组，不包含逐步生成记录、原文节选或提示词；旧作品未记录模型时不显示模型信息。

作品集卡片单独显示「分镜模型」，取自分镜批次的 `plan:<起始幅号>` 模型记录；旧版整篇生成使用 `plan` 记录。可选 `storyboardModels` 字段仅保存去重后的模型名，不混入提纲、结语或图片生成模型。书架直接读取轻量目录，不为显示模型下载 ZIP；未记录分镜模型的作品不显示该项。自动发布时会重新生成含此字段的目录。

作者目录使用小写 GitHub 用户名；ZIP 文件名支持中文、大小写英文、内部空格和常用标点，无需改成拼音。每个 ZIP 不超过 **100 MiB**，含 1–80 幅画面；单张图片不超过 12 MiB，支持 PNG、JPEG、WebP。ZIP 使用普通 STORE 或 DEFLATE 压缩。

**GitHub 网页上传每个文件最多 25 MiB**；超过 25 MiB、未超过 100 MiB 的 ZIP 可通过 GitHub Desktop 或命令行提交。这是上传方式的限制，阅读器支持读取仓库中不超过 100 MiB 的 ZIP。参见 [GitHub 上传文件说明](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)与[大文件限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)。操作步骤见 [贡献指南](CONTRIBUTING.md)。

## 阅读站怎样更新

| 阶段 | 自动完成的工作 |
| --- | --- |
| 发起 PR | 检查 ZIP 格式、分镜、缺图、图片格式、路径及文件大小；运行测试和构建 |
| 维护者合并到 `main` | 生成 `catalog/catalog.json` 和封面，提交生成结果，然后部署 GitHub Pages |
| 打开书架 | 优先读取 GitHub 的轻量作品目录，只载入目录和封面 |
| 打开故事 | 从 GitHub 的 `works/` 下载这一篇 ZIP，核对 SHA-256，在浏览器中展开图片和旁白 |

ZIP 地址固定到生成目录时的源码 commit；修改文件后产生新摘要。网站自动生成稳定的阅读标识，中文原名保留在仓库中。修订时保持作者目录和 ZIP 文件名不变，可保留分享链接，打开时读取当前收录版本。

Sites 与 GitHub Pages 可以使用同一套阅读器。Sites 读取 GitHub 上的目录与 ZIP，因此新增作品不需要重新部署 Sites。GitHub 暂时不可用时，书架可使用本次站点构建内置的目录；GitHub 尚未建立时，空书架仍能打开。

## 连接作品仓库

`site/config.json` 指定 GitHub 来源：

```json
{
  "github": {
    "owner": "yysun",
    "repo": "awesome-shiqu",
    "branch": "main",
    "directory": "works",
    "catalog": "catalog/catalog.json"
  },
  "preferRemoteCatalog": true
}
```

这里配置的是阅读器连接目标，不代表仓库已经建立或已经发布。使用其他 GitHub 账号时修改 `owner` 和 `repo`。作品仓库须公开，浏览器才能直接读取；不在前端配置 GitHub Token。

## 本地检查与阅读

准备 Node 24 和 pnpm 11.25.0。项目没有第三方运行依赖。

```bash
pnpm add:story '/path/黄忠智取定军山.zip' --author yysun --slug '黄忠智取定军山'
pnpm test
pnpm build
pnpm preview
```

`add:story` 是可选的校验与复制快捷方式；`--slug` 指定保存的作品文件名，不含 `.zip`，可以直接填写中文名。直接把 ZIP 放进对应目录也可以。打开终端显示的地址，检查翻页、长卷、手机显示、收藏与阅读进度。`pnpm validate` 单独检查内容；`pnpm catalog` 在已提交的 Git 仓库中生成供静态阅读站读取的远程目录。

`pnpm preview` 与 `pnpm dev` 只读取本次 `pnpm build` 生成的本地目录、封面和 ZIP，避免远程旧目录覆盖本地修改。预览服务器仅在返回配置时关闭远程目录优先，不修改 `site/config.json` 或构建文件；线上静态站仍按发布配置连接 GitHub。修改预览服务器代码后需重启预览服务。

`pnpm build` 会为每篇作品生成对搜索引擎友好的静态页面：`books/<原著>/<作品名>/` 为作品页，`books/<原著>/` 为书目页，均带有规范链接（canonical）与 Open Graph 元信息；配置了 GitHub 仓库时还会生成 `sitemap.xml`。书架卡片和分享链接指向这些地址；原有 `reader.html?story=<编号>` 链接继续有效。

本地 ZIP 未提交时，日期暂用文件修改日期；合并后使用 Git 记录中的首次提交日期。原有 `stories/<slug>/story.json` 格式与 `pnpm import:story` 仍可本地构建阅读；远程目录只接受 `works/` ZIP。有旧作品时，先将原始拾趣 ZIP 放入 `works/` 并移除相应旧目录，再启用自动发布。

多页模式一次列出全部画面，采用上图下文布局：窄屏（不超过 760px）一列，中屏（761–1023px）两列，宽屏（1024px 起）三列，图片随各列宽度等比缩放，向下滚动阅读；长卷模式保持单列连续阅读。两种模式均记录阅读进度，切换时保留当前画页。

## GitHub 设置

创建并推送独立仓库后，在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。主分支工作流会自动生成目录并部署；成功地址由部署步骤返回。

目录生成 job 仅在 `main` 执行，具有提交 `catalog/` 所需的 `contents: write` 权限；PR 检查只有读取权限，不使用 `pull_request_target`。当前自动发布方案需要仓库策略允许 GitHub Actions 直接提交生成的目录到 `main`。如果分支保护要求所有变更通过 PR 且不允许机器人直接提交，这个 job 会失败；应先改用适合该仓库规则的目录发布方案，例如单独的索引分支，再启用自动发布。

主分支更新按队列运行，提交只使用普通 push。若同时有人更新主分支，旧构建的 push 会拒绝，较新提交的排队工作流会重新生成目录；不会强制覆盖用户提交。

## 目录

| 路径 | 用途 |
| --- | --- |
| `works/<GitHub 用户名>/<作品名>.zip` | 经 PR 审阅的作品原始存档，保留中文原名 |
| `catalog/catalog.json` | 自动生成的远程书架目录 |
| `catalog/covers/` | 自动生成的封面，按内容摘要命名 |
| `site/` | 书架、阅读器、ZIP 解析及站点配置 |
| `scripts/` | 校验、构建、生成目录与预览 |
| `dist/` | 本地静态构建结果，不提交 |

## 公开范围与许可

ZIP 会原样保存在公开仓库并供阅读器下载。阅读页面不显示制作要求或画面提示词，但这些内容若存在于原 ZIP，仍可被下载查看；提交前请先检查整个 ZIP。

代码采用 [MIT 许可](LICENSE)。作品文字、图片和其他资料不自动适用代码许可；署名、来源及使用条件见作品和 PR 的说明。收录标准及更正方式见 [内容说明](CONTENT_POLICY.md)。
