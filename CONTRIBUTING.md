# 贡献指南

欢迎通过 Pull Request 投稿完整的拾趣连环画。投稿后由维护者挑选；合并才代表收录。

## 只上传 ZIP

在拾趣中完成全部画面，下载「分镜与图片 ZIP」。保持 ZIP 内的 `故事.json`、`分镜.md` 与图片相对路径不变，把文件放入：

```text
works/<你的 GitHub 用户名>/<作品名>.zip
```

例如 `works/yysun/黄忠智取定军山.zip`。作者目录使用小写 GitHub 用户名；ZIP 可以保留中文原名，也支持大小写英文、内部空格、括号和常用标点。不同作者可以使用相同文件名，网站会自动生成各自的阅读标识。

文件名不能含路径分隔符、控制字符或 `<>:"\\|?*`；作品名首尾不要留空格。保持 ZIP 内的中文文件名和相对路径不变。网站显示的标题优先来自 `故事.json`，不由 ZIP 文件名决定。

## 通过 GitHub 网页上传

单个文件不超过 **25 MiB** 时，可以直接在网页操作：

1. Fork 仓库，在电脑上准备一个以你的小写 GitHub 用户名命名的文件夹，把 ZIP 放进去。
2. 在 Fork 仓库中打开 `works/`，选择 **Add file → Upload files**，把这个用户名文件夹拖入上传区。GitHub 支持拖入文件夹，会随文件一起创建目录。
3. 如果仓库中已有你的作者目录，也可以直接进入该目录，上传 ZIP 文件。
4. 核对最终路径为 `works/你的用户名/作品名.zip`，选择新分支提交，再向本仓库发起 PR。

作者目录里只放作品 ZIP，**不需要 `.gitkeep` 或 `README.md` 占位文件**。目录会随首个 ZIP 一起创建，额外占位文件会被内容检查拒绝。网页步骤与上传限制见 [GitHub 官方说明](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)。

## 提交较大的 ZIP

本项目支持单个 ZIP **不超过 100 MiB**。超过网页的 25 MiB 限制时，可以使用 GitHub Desktop 或命令行，把 ZIP 放入本地仓库的对应作者目录，再提交并推送分支。GitHub 普通 Git 仓库会阻止超过 100 MiB 的单个文件，见 [GitHub 大文件说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)。本项目读取实际 ZIP，不接受 Git LFS 指针文件。

在本地克隆后的仓库中，可以直接放入文件，也可以使用校验与复制命令：

```bash
pnpm add:story '/path/黄忠智取定军山.zip' --author yysun --slug '黄忠智取定军山'
pnpm validate
pnpm build
pnpm preview
```

`--slug` 是保存的作品文件名，不含 `.zip`，支持中文。不要提交生成的 `dist/`、`catalog/` 或拆出的图片；它们由维护者合并后的工作流处理。

## ZIP 内容

- 根目录有 UTF-8 编码的 `故事.json`（不超过 1 MiB），保留拾趣导出的标题、出处、`pages` 图片路径与旁白，以及 `generationModels` 模型记录。网站只公开去重后的模型名，不公开生成步骤或提示词。
- 兼容旧版仅含 `分镜.md` 的 ZIP；同时有 JSON 与 Markdown 时以 JSON 为准，JSON 无效会拒绝作品。
- 所有引用的图片均在 ZIP 中，使用 PNG、JPEG 或 WebP。
- 1–80 幅，顺序连续；单张图片不超过 12 MiB，ZIP 不超过 100 MiB。
- ZIP 使用普通存储或 Deflate 压缩，不使用密码、分卷、ZIP64、符号链接或 `../` 路径。

原始 ZIP 会公开保存。除了实际阅读内容，请检查制作要求、画面提示词及其他文件，确保没有不准备公开的信息。网站隐藏提示词不等于 ZIP 保密。

## PR 说明

填写自动出现的 PR 模板，说明作品名称、出处、收录理由、AI 参与及展示许可。作者目录会成为默认署名，维护者会在审阅时核对提交者与署名；代他人提交时请明确说明作者和授权。

只上传你有权公开展示的作品。若需要特定署名或再使用条件，请在 PR 中明确写出。代码的 MIT 许可不会自动套用到你的作品。

## 审核与发布

自动检查验证文件格式与结构；维护者仍需完整阅读作品，检查内容、画面、来源和授权。通过并合并到 `main` 后，自动生成封面与轻量目录，然后更新 GitHub Pages。连接该仓库的 Sites 阅读器会在重新加载目录后看到作品。

书架不需要下载所有 ZIP；读者打开某一篇时，浏览器才下载该篇的 ZIP。作品内文字以文本显示，不执行 Markdown 内嵌 HTML 或脚本。

## 修订或撤下

更新作品时替换原路径的 ZIP，在 PR 中说明变化；保持作者目录和 ZIP 文件名不变，可保留分享链接。要撤下作品，提交删除该 ZIP 的 PR，并说明原因。

撤下会使它退出当前目录，但此前公开的 Git 历史、缓存或他人下载的副本不会自动消失。来源错误或权利争议也可通过 Issue 提供作品标识和可核对的说明。
