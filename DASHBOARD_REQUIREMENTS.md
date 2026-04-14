# SlowRich Dashboard 重构需求文档

## 项目背景
重构现有的 SlowRich Dashboard，从深色风格改为清爽浅色风格，并按三大板块重新组织内容。

## 设计风格
- **风格**: 清爽浅色（类似 Notion / Linear）
- **主背景**: #fafafa 或 #ffffff
- **卡片背景**: #ffffff with subtle shadow
- **文字**: #1a1a1a 主文字，#666666 次要文字
- **强调色**: #10b981 (green), #f59e0b (amber)
- **字体**: Inter / system-ui
- **圆角**: 8-12px
- **阴影**: subtle box-shadow (0 1px 3px rgba(0,0,0,0.1))

## 三大板块结构

### 1. 实盘信号 (Live Signals)
包含三个子模块：

#### 1.1 期权信号
- DVOL (Deribit Volatility Index) 当前值
- 7天历史波动率
- 30天历史波动率
- **VPR (Volatility Risk Premium) 计算**: IV - RV
  - IV = DVOL 当前值
  - RV = 过去30天实际波动率
  - 显示 VPR 数值和判断（正=开仓有利，负=观望）
- API 已有: `/api/btc-dvol`, `/api/btc-prices`, `/api/timing`

#### 1.2 DeFi 收益监控
- 稳定币池子列表（来自 DeFiLlama）
- 显示: 协议名、池子、链、TVL、APY
- 已有数据: `/api/rates/defi`
- 只需优化展示样式

#### 1.3 CTA 双均线信号
- 选择交易对: BTC/USDT, ETH/USDT
- 短期均线 (默认 20日)
- 长期均线 (默认 50日)
- 当前信号: 金叉(做多) / 死叉(做空) / 观望
- 需要新增 API 和数据源

### 2. 策略回测库 (Strategy Backtests)
现有策略卡片网格：
- Strategy #1: Options Wheel (SPY)
- Strategy #2: IBIT Wheel (BTC ETF)
- Strategy #3: Dip-Buying (定投)
- Strategy #4: All Weather (全天候)
- Strategy #5: Options Monitor (期权监控)

每个卡片显示:
- 策略名称
- 简要描述
- 历史表现指标 (Sharpe, Max DD, Ann Return)
- 进入按钮

### 3. 知识库 (Knowledge Base)
链接列表：
- Notion 知识库主页
- 策略文档
- 风险管理手册
- API 文档

## 技术栈
- 纯 HTML + CSS + Vanilla JS
- Chart.js 用于图表
- 不需要框架，保持轻量

## 现有资源
- 位置: `/home/ubuntu/.openclaw/workspace/slowrich-github/dashboard/`
- 已有 API 端点: `/api/*`
- 现有页面保留在 `/backtest-*.html`

## 交付物
1. 新的首页 `index.html` —— 导航 + 三大板块概览
2. 期权信号组件 `signals-options.html` (或嵌入首页)
3. CTA 双均线组件 (新开发)
4. 统一的 CSS 样式文件

## 验收标准
- [ ] 浅色清爽风格
- [ ] 三板块导航清晰
- [ ] VPR 计算正确显示
- [ ] CTA 信号能正确计算并展示
- [ ] 移动端适配
