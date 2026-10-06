# AI 应用教学开放日报名系统

> 前后端分离的报名系统：**Node.js + Express** 提供 API、**SQLite** 持久化、前端原生 HTML/CSS/JS，可部署到副机经内网穿透对外访问。

## 项目简介

用纯 HTML + 原生 CSS/JS 实现报名全流程，包含**用户端**与**管理端**两个独立入口；后端提供 REST API 并托管前端静态资源，数据落 SQLite 单文件（重启不丢）。

## 两端入口

| 端 | 文件 | 访问网址 | 功能 |
|---|---|---|---|
| 用户端 | `user.html` | `/user.html` | 报名、报名成功回执、按手机号查询 |
| 管理端 | `admin.html` | `/admin.html` | 名单总览、身份/场次/关键字筛选、导出 CSV（真实下载） |

管理端**无登录**，通过独立网址直接进入（用户明确选择，保持 Demo 状态）。

## 如何运行

### 1. 安装并启动后端

```bash
cd server
npm install
npm start
```

默认端口 **3000**，可用环境变量覆盖：`PORT`、`DB_PATH`、`BACKUP_DIR`、`CORS_ORIGIN`。

### 2. 一键脚本

- Windows：双击 `start.bat`
- Linux 副机：`bash start.sh`

### 3. 打开页面

- 用户端：`http://localhost:3000/user.html`
- 管理端：`http://localhost:3000/admin.html`

> **必须通过服务地址打开**（前端与后端同源）。不要用 `file://` 双击打开——那样无法访问 API。

### 4. 部署到副机 + 内网穿透

见 [docs/部署文档.md](docs/部署文档.md)（Node 环境、ngrok 穿透、防火墙、关闭隧道、备份恢复）。

## 目录结构

```
ai-open-day-signup-demo/
├── README.md
├── .gitignore
├── user.html                              # 用户端入口（报名 / 成功 / 查询）
├── admin.html                             # 管理端入口（名单 / 筛选 / 导出）
├── start.sh / start.bat                   # 启动脚本
├── assets/
│   ├── css/style.css                      # 全局样式（校园深蓝主题）
│   └── js/
│       ├── store.js                       # API 客户端（封装 fetch）
│       ├── user.js                        # 用户端逻辑
│       └── admin.js                       # 管理端逻辑
├── server/                                # 后端服务（Express + SQLite）
│   ├── package.json
│   ├── config.js                          # 字典、错误码、备份份数等常量
│   ├── db.js                              # SQLite 连接、建表、启动备份
│   ├── regno.js                           # 报名编号生成
│   ├── server.js                          # 应用入口（CORS / 限流 / 日志 / 错误处理）
│   └── routes/
│       ├── registrations.js               # 报名四接口
│       └── sessions.js                    # 场次字典
├── data/                                  # 运行时数据（git 忽略）
│   ├── app.db                             # SQLite 数据文件
│   └── backups/                           # 启动备份，保留最近 7 份
├── docs/部署文档.md
├── basic_code_information_archive/        # 治理层：基础代码信息档案
└── modification_log/
    └── 改动记录.md
```

## API 契约

统一响应体 `{ code, message, data }`，`code = 0` 表示成功。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/registrations` | 提交报名（name, role?, department?, phone, session） |
| GET | `/api/registrations/lookup?phone=` | 按手机号查询，未命中 `data=null` |
| GET | `/api/registrations?role&session&keyword` | 名单列表（三条件 AND） |
| GET | `/api/registrations/export?role&session&keyword` | 导出 CSV（UTF-8 BOM） |
| GET | `/api/sessions` | 场次字典 |

错误码：`1001` 参数校验失败 / `1002` 手机号重复 / `5000` 服务器内部错误。

## 数据说明

- 数据存于 `data/app.db`（SQLite，**WAL 模式**），**空库启动、不注入种子数据**。
- 每次启动自动备份到 `data/backups/`，命名为 `app-YYYYMMDD-HHmmss.db`，**仅保留最近 7 份**。
- 报名记录字段：`reg_no`（`REG+YYYYMMDD+4位流水`）、姓名、身份、院系、手机号、参加场次、报名时间。
- **手机号全局唯一**：前端预检 + 后端 DB 唯一索引兜底，重复提示「该手机号已报名，请勿重复提交」。
- 重置数据：停服后删除 `data/app.db*` 再启动即可。

## 业务定稿速查

- 场次 **2 场**（同主题「AI 应用教学开放日」，仅时间不同）：上午场 09:00–12:00、下午场 14:00–17:00；地点 **报告厅 A**；**无容量概念**。
- 必填校验仅卡 **姓名 / 手机号 / 参加场次**；身份、院系可留空；校验在**失焦时实时触发**，错误提示为**红色中文**、显示在字段下方。
- 查询按手机号，命中展示 姓名/身份/院系/参加场次/报名时间；未命中提示「暂未查到报名记录哦」。
- 管理端筛选 = 身份 + 场次 + 关键字（三者 AND，服务端执行）；导出 CSV 严格按当前筛选，带 UTF-8 BOM。
- 视觉：校园深蓝，主色 `#1E3A8A` + 青色点缀 `#0EA5E9`，浅色底卡片式；文案活泼亲切。

## 安全提示

- 管理端**无鉴权**，拿到网址者可见全部手机号；演示结束后**请及时关闭穿透隧道**。
- 后端已启用：参数化 SQL、请求体 16kb 限制、`/api` 限流、CORS 来源可控、统一错误处理（不泄漏堆栈）。

## 许可证

本项目基于 [MIT License](LICENSE) 开源，可自由使用、修改与分发（需保留版权声明）。

## 目录补充说明

- `basic_code_information_archive/`：各模块的基础信息档案（职责、数据模型、接口与约束）。
- `modification_log/`：开发过程中的改动记录（按时间追加）。
- 两者为本项目的治理层文档，随代码同步维护，供教学示范与二次开发参考。

