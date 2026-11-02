# 阅读站署名与转载保护

Git base: `c3b8a2e1933c2353fd480099042293148035ff69`。范围：公开署名与完整性保留，以及hero扫码入口；不替换生产故事、不推送或部署。

Risk: non-low — public archive/manifest contracts, untrusted text, browser/Node integrity checks and explicitly requested local-history cleanup.

保留schemaVersion1；新增可选公开publication、contributor、sourceText、exportIdentity、aiDisclosure，AI声明接受boolean/null。目录投稿者与制作署名分开，未知制作人不补造；已明确署名的旧清单保留。公开字段校验共享于浏览器和Node，严格长度/白名单/HTTP(S)无凭据链接。原文不进入轻量目录；提示词和内部生成记录不公开。

ZIP和独立manifest核对已声明最终SHA，WebP/XMP原字节保留。独立图片顺序读取，每图12MiB、合计100MiB，以同一已核验字节创建BlobURL；失败/pagehide释放。无hash旧图保留受限目录下按需加载。预先拒绝重复路径、大小写冲突、跨源和越界，避免未经验证引用覆盖已验证图片。旧ZIP可选watermark字段只作兼容校验，不展示、生成或检测。

阅读页以textContent和安全节点显示公开声明、许可、原文和版本。hero使用离线SVG二维码指向https://yysun.github.io/awesome-shiqu/，置于“翻开作品集”上方；无第三方运行依赖。

- [x] 公共字段、安全显示、来源/授权边界及旧格式兼容。
- [x] ZIP与独立图片哈希检查、预算、路径预检和资源释放。
- [x] 用本站实际普通浏览器导出的2幅无隐形水印ZIP更新fixture，验证Node/浏览器解析、兼容导入、静态构建及字节保留。
- [x] pnpm test67/67与build通过；生产works恢复原17篇/567幅，测试夹具不进入生产集合。
- [x] 390px浏览器试读：两幅1152×2048正常解码，署名一致，无编号UI/水平溢出；二维码桌面与手机在链接上方，扫码地址已解码核验。in-app当前预览已刷新。

用户2026-11-02撤回隐形水印；10份未发布试验ZIP恢复原提交，试验服务/模型/缓存清理。551幅最新源图没有重导出，源书库补齐成果保留。

用户随后明确要求代码/模型不留Git历史并完成两个RPD的DD/GC。仅整合本地未发布的功能提交到上述已核实远端base，保留其他分支/tag和原先共享历史；定向删除这些旧提交的reflog记录后GC，验证旧fixture及根仓库模型不可达/不存在。历史清理计划与独立AR/CR/VR审查记录位于本轮临时交付证据。无远端push。
