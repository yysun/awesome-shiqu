# 作品 ZIP

把拾趣导出的「分镜与图片 ZIP」原样放到：

```text
works/<GitHub 用户名>/<作品名>.zip
```

例如 `works/yysun/黄忠智取定军山.zip`。用户名目录使用小写；ZIP 保留拾趣导出的中文文件名即可，也支持大小写英文、内部空格和常用标点。作者署名来自用户名目录。标题、原著、旁白、图片顺序和改编说明从 `分镜.md` 读取，网站自动生成阅读标识。

每个 ZIP 最多 **100 MiB**，最多 80 幅；图片支持 PNG、JPEG、WebP，单张最多 12 MiB。请提交普通 STORE 或 DEFLATE ZIP，不使用密码、ZIP64 或分卷。

[GitHub 网页上传](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)的单个文件上限是 **25 MiB**；更大的 ZIP 可通过 GitHub Desktop 或命令行提交，仍需不超过 100 MiB。

只上传 ZIP 即可，不需要提交封面、JSON 或解压后的图片。合并后，自动工作流生成书架目录与封面，阅读器直接下载 ZIP 并在浏览器里展开。

作者目录随首个 ZIP 一起创建，不要在里面放 `.gitkeep` 或 `README.md` 占位文件。要修订作品，请替换原路径的 ZIP，保留文件名以维持分享链接。

ZIP 中的全部内容会被公开保存，包括原始导出中可能包含的制作要求和画面提示词。阅读页面只显示作品内容，但这不意味着 ZIP 中的其他内容保密。

完整操作见 [贡献指南](../CONTRIBUTING.md)。这里不放测试或演示作品。
