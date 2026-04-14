# Delta Neutral策略监控面板需求文档

## 策略背景
SlowRich的Delta Neutral策略：
- **多头**: 买入JLP (Jupiter Liquidity Provider)
- **空头**: 在Astar（或类似平台）做空对冲
- **收益来源**: JLP的APR - 资金费率成本

## 数据源

### 1. JLP数据 (Jupiter)
- JLP实时价格
- JLP 24h价格变化
- JLP实时APR (7天平均)
- JLP组成成分 (SOL, ETH, BTC, USDC等权重)

### 2. Astar资金费率
- Astar永续合约资金费率
- 历史资金费率趋势
- 预测下期资金费率

### 3. 市场数据 (Coinglass风格)
- 各交易所资金费率排名
- 资金费率套利机会 (币安vsOKX等)
- 多空比

### 4. Delta Neutral计算
- 对冲比例计算
- 净收益估算 (JLP APR - 资金费率)
- 风险指标 (价格波动、费率变化)

## 面板设计

### 卡片布局
```
┌─────────────────────────────────────────┐
│ Delta Neutral 策略监控                   │
├─────────────────────────────────────────┤
│                                         │
│ JLP 价格: $1.85 (+2.3%)     APR: 8.5%   │
│ Astar费率: 0.005%/8h        多空比: 1.2 │
│                                         │
│ 预估净收益: 6.2% APR ⚡️                 │
│                                         │
│ 资金费率排名 (Top 5)                    │
│ 1. BTC 币安 0.01%                       │
│ 2. ETH OKX 0.008%                       │
│ 3. SOL Bybit -0.003%                    │
│                                         │
│ [查看完整数据 →]                        │
└─────────────────────────────────────────┘
```

## API需求

### 已有API
- `/api/rates/defi` - DeFi收益率
- 需要扩展JLP数据

### 需要新增
- `/api/funding-rates` - 各交易所资金费率
- `/api/jlp-stats` - JLP价格、APR、成分
- `/api/astar-funding` - Astar资金费率
- `/api/delta-neutral-calc` - 净收益计算

## 技术实现

### 数据源
1. **JLP**: Jupiter API或链上数据
2. **Astar**: Astar API或合约读取
3. **资金费率**: Coinglass API或各交易所API

### 前端
- 实时数据展示
- 趋势图表 (7天资金费率走势)
- 套利机会提醒
- 风险警告 (费率大幅变化)

## 验收标准
- [ ] JLP价格实时显示
- [ ] Astar资金费率显示
- [ ] 净收益自动计算
- [ ] 资金费率排名Top 5
- [ ] 7天趋势图表
- [ ] 和现有风格统一
