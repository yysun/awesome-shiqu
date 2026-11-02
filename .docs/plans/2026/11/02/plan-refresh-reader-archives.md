# 更新17篇故事并清理阅读区旧数据

Git base: `43bac5fb3a438fcbd02f34105e28b224c41a55f4`。根仓库正式codec基线db5d9ba；两仓库入口工作区干净。

Risk non-low：批量公开作品、原子替换、远端历史改写与发布。复用现有正式导出，不修改产品codec。

1. 只读SQLite，复用正式view和supersededSql：按原17个ZIP内的id映射同故事族，保留文件名，选最新可见版本；未收藏不等于非书架作品，不能仅按saved=1漏选。白名单快照仅包含公开导出字段和允许的551个媒体输入；私有记录仅留.data，不进入静态资源。记录各源输入SHA/尺寸与版本身份，导出前后再查最新版本/图片身份。
2. 有界可行性probe：localhost临时Vite导出页通过真实按钮调用正式createStoryZip，先一篇小故事。仅loopback、禁HMR，Vite拒绝.data/数据库/媒体通用文件路径。只读服务按精确白名单提供选中源图，目的接收器只接受17个固定文件名、任务token和本地Origin，限100MiB。解析/验证成功再用临时文件+短期备份替换同名ZIP，失败恢复；不在其他目录保留ZIP。probe通过后顺序导出全部17篇。
3. 用实际parseStoryArchive与独立Python验证ZIP、551幅可读、原尺寸、XMP/XML、原图/载荷/最终SHA、公开数据与源快照一致、私有字段排除。验证一组实际图片底部署名像素和阅读站窄屏试读。运行阅读站pnpm test/validate/build。
4. 发布前在隔离临时Git目录从现main导入历史，过滤所有历史works/**/*.zip及catalog/covers/**和旧catalog/catalog.json，再把当前17包放回原路径。保留全部非作品代码/文档变更（含二维码/署名功能）。记录旧ZIP/封面blob denyset、远端main lease及其他远端refs；不镜像推送、不推refs/agents。
5. 源内容commit A只含当前17ZIP及清理后代码/文档，catalog按A生成并仅保留当前17封面，生成commit B。独立CR审查最终推送候选/lease/旧对象不可达/新包来源；推送前再查源快照与远端是否变更。仅main显式force-with-lease。
6. 验证CI/Pages和线上目录/下载摘要；CI若提交catalog-only后继C，确认ZIP/tree未变、目录sourceCommit可达且对应当前包。同步本地main到已发布后继，保留其他本地refs/无关恢复对象，不对整个本地.git做不必要GC。清理旧故事对象以远端main可达图为验收范围，其他克隆/服务端缓存不做删除承诺。
7. 完成VR/DD，删除临时导出服务器、备份、ZIP副本与隔离历史目录。仅保留小型检查记录；不重写根仓库历史。

权限依据：本轮明确重新输出和清理，之前明确17篇测试站发布、清Git历史及force push；原图不变。重写仅阅读仓库main，其他远端refs变动时先审查，不盲目覆盖。

AR risk: non-low — batch archive replacement, public content validation and remote history rewriting. AR review round:1; reviewer:reused. AR passed: no blocking architecture flaws.

SS: 小故事7幅探针通过后，正式默认codec顺序完成17篇/551幅，同名原子替换、无备份残留。独立Python全量解码/RIFF/XML/三类SHA及原尺寸验证通过，源媒体SHA一致；阅读站67tests、validate和build通过，143.22MiB。未新增运行时依赖或修改codec。浏览器手机390px梨香院44幅，首图941×1672，未溢出。旧历史二进制denyset47个。发布候选在隔离目录过滤历史后制作，尚未推送。
