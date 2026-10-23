# GitHub 框架调研与技术选择

核对日期：2026-10-21。通过 GitHub 公共 API、官方 README 和 LICENSE 核对，未复制无明确许可的租车项目源码。

| 项目 | 功能与技术 | 许可证和维护情况 | 本项目适配情况 |
| --- | --- | --- | --- |
| [Payload](https://github.com/payloadcms/payload) / [官方 Website 模板](https://github.com/payloadcms/payload/tree/main/templates/website) | Next.js、React、TypeScript；认证、后台、媒体管理、草稿发布、访问控制 | MIT；45,383 stars；2026-10-21 有推送；[v3.91.0](https://github.com/payloadcms/payload/releases/tag/v3.91.0) 于 2026-10-15 发布 | 完整 CMS 候选中的首选，适合未来扩充多角色权限、内容审核、版本管理。当前 main 模板要求 Node >=24.15.0，包含 workspace 依赖，不能直接复制 package.json 后安装 |
| [Refine](https://github.com/refinedev/refine) | React 后台框架；CRUD、认证、权限、国际化；支持 Ant Design / MUI / 自定义 UI | MIT；35,913 stars；最后推送 2026-09-10，未归档 | 后台灵活，但需要另配数据库 API，并自行设计公众车型展厅 |
| [Strapi](https://github.com/strapi/strapi) / [LaunchPad](https://github.com/strapi/LaunchPad) | JS / TS CMS；媒体库、发布管理、自动 REST / GraphQL API；SQLite / PostgreSQL / MySQL | 社区版 MIT；ee/ 目录为单独企业许可；73,355 stars；2026-10-21 有推送 | 成熟可用，但通常需要 CMS 和前端两个服务，当前目录规模使用较重 |
| [Directus](https://github.com/directus/directus) | 数据库驱动后台与 API | 38,639 stars；最后推送 2026-10-20；当前 main 的 license 为 MSCL-1.0-GPL，并非 MIT | 表格化运营体验合适，但许可证和部署方式需按所选版本核对，不作为当前首选 |
| [CAR-RENTAL-SYSTEM](https://github.com/Amey-Thakur/CAR-RENTAL-SYSTEM) | PHP 7、MySQL、Bootstrap 3、jQuery；车辆管理、目录和预订 | MIT；40 stars；最后推送 2026-09-05；README 明确为课程项目并提示依赖旧技术 | 可参考栏目组织，但不作为新公司官网底座；最近推送日期不能证明技术栈已更新 |

另核对 [Rent-a-Ride](https://github.com/jeevan-aj/Rent-a-Ride) 等专用租车仓库，部分具备车辆筛选和管理功能，但未声明开源许可证，因此未复用其源码。

## 当前选择

本项目采用轻量 React / TypeScript 前端及独立服务端 API，以已有车型资料构建中文车型展厅和专用管理界面。当前业务是公司可租售车型目录，不是按日期占用库存、在线付款的汽车预订平台；无需引入订单、支付或供应商市场模块。

后台围绕实际操作设计：新增和编辑车型、图片上传排序、上下架，以及公司联系方式维护。车辆展示状态 `published` 与现车情况 `availability` 分开保存。前台支持常温 / 冷藏和面包 / 平板 / 厢货 / 高栏筛选，车型可配置多个车身类型。使用服务端持久化和登录保护，不依赖浏览器 localStorage 模拟管理数据。

此选择降低了当前规模的安装、部署和维护成本，也避免为了少量车型引入完整 CMS 的配置负担。未来如需多人审核、细粒度权限、内容版本、跨站点发布，可迁移到 Payload；当前车辆字段与媒体信息保持清晰结构，方便迁移。

上面是经过实查的候选比较；当前实现并未声称套用了这些 CMS 的源码或完成了其功能集成。stars 和最新推送日期仅是调研当天的快照，不构成质量或安全保证。
