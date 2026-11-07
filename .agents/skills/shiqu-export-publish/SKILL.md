---
name: shiqu-export-publish
description: 将用户选定的拾趣故事按标题、作品 ID 或已下载的 ZIP 导出到 awesome-shiqu 的 works/yysun，检查公开内容并验证构建。用于收录或更新拾趣故事，以及按要求提交并推送作品 ZIP 到 GitHub。
---

# 拾趣作品导出与发布

## 确定作品和发布范围

- 从用户指定的标题、作品 ID 或本地 ZIP 路径确定作品。每篇单独导出，避免从书架或下载目录猜选。仅发布所有者明确选定、完成审阅并允许公开的作品。确认来源、制作署名、展示许可和 AI 披露，以实际作品为准。参照仓库根目录的 `CONTENT_POLICY.md` 和 `CONTRIBUTING.md`。
- 仅要求导出时，保存和验证 ZIP 后交付。用户要求发布、提交并推送，或明确调用此 skill 完成整个流程时，按下述 Git 步骤交付。用户只要求本地提交时，做到 commit 为止。推送到 `main` 会触发 GitHub Pages 发布。
- 在 awesome-shiqu 根目录检查 `git status --short --branch` 和 `git remote -v`，记下已有改动。使用默认输出时，先检查 `works/yysun` 有无未提交改动。存在改动时先确认导出不会覆盖已有工作。需要直接发布时，先确认当前分支是 `main`、`origin` 指向 `yysun/awesome-shiqu`，并在 `git fetch origin main` 后核对 `HEAD` 与 `FETCH_HEAD` 一致，避免推送夹带已有本地提交。分支、远端或版本不符时先解决目标与基线，再推送。

## 导出和检查

1. 找到 `yysun/shiqu` 的本地源码。当前工作区通常在 `../shiqu-docker`。按两个仓库的 `.nvmrc` 和 `package.json` 使用各自固定的工具链，awesome-shiqu 使用 Node 24。拾趣的 `pnpm export:story` 使用生产 Node 导出器和应用的只读 API，默认连接 `http://localhost:3000`。使用已运行的拾趣实例，用户指定其他地址时加 `--url '<地址>'`。

   ```bash
   pnpm -C ../shiqu-docker export:story '<完整故事标题或作品 ID>'
   pnpm -C ../shiqu-docker export:story '/绝对路径/已下载的故事.zip'
   ```

2. 默认输出到拾趣源码旁的 `../awesome-shiqu/works/yysun`。先确认该路径是当前仓库。导出器会为同一作品沿用既有文件名，保留分享链接。若源码和目标仓库不相邻，或已下载的 ZIP 是改过 ID 的同一作品，核对身份后用 `--output '/绝对路径/awesome-shiqu/works/yysun/作品名.zip'` 指定目标。显式输出可覆盖文件，先确认目标归属。遇到同名多篇时用作品 ID，当前版本缺图或未完成时报告缺口并停止该篇导出。应用不可访问时，使用用户提供的已下载 ZIP 或请用户提供可访问的实例地址。
3. 以导出命令报告的路径、标题、画幅数和 SHA-256 核对实际文件。检查 ZIP 完整内容，确认画面和旁白齐全、顺序正确，保留原文、出处、制作署名、展示与转载条件、AI 披露及原始 WebP 字节。公开包应包含 `故事.json`、`分镜.md`、`署名与转载.txt` 及 `图片/` 下的连续编号 WebP。检查正文、附带文件和元数据中是否有制作提示词或私有数据，发现问题先处理来源。用已有导出器处理下载 ZIP，避免手工重建或重新编码图片。
4. 在 awesome-shiqu 根目录运行 `pnpm test` 和 `pnpm build`。确认构建目录中的作品条目对应本次 ZIP，核对作品标题、画幅数及阅读地址。任何审阅或校验失败时先处理，成功前暂停提交和推送。

## 提交和推送

1. 逐个暂存本次通过审阅的 `works/yysun/` 下的 ZIP，按确切路径操作。核对 `git diff --cached --name-status` 及目标路径的未暂存改动。用 `git commit --only -m 'content: 收录或更新《作品名》' -- <本次 ZIP 的确切路径>` 提交。已有暂存改动应保留，`dist/`、`catalog/`、解压文件及临时 ZIP 留在本次提交范围之外。若目标与 `HEAD` 字节一致，报告已是当前版本，跳过空提交。
2. 核对新提交只包含选定 ZIP，且提交前的基线仍是远端 `main`。运行 `git push origin HEAD:refs/heads/main`，用 `git ls-remote origin refs/heads/main` 验证远端提交。如果 HTTPS 凭据读取失败，且 `gh auth status --hostname github.com` 显示有权推送的账号已登录，用 `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin HEAD:refs/heads/main` 重试一次。远端前移、分支保护或认证仍失败时，保留已验证的本地结果并报告具体阻碍，避免强推。
3. 回报作品标题、ZIP 路径和画幅数、测试与构建结果、提交哈希和推送状态。只有实际核实部署成功时才说作品已上线。
