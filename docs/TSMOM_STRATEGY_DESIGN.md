# TSMOM + 波动率缩放策略设计文档

## 研究背景

TSMOM (Time Series Momentum) 是量化投资领域的经典策略，最早由 Moskowitz & Grinblatt (1999) 提出，后经 Hurst et al. (2013) 在 AQR 的论文 "Demystifying Managed Futures" 中系统阐述。

## 核心原理

### 1. 时间序列动量 (TSMOM)

不同于截面动量（比较不同资产的相对强弱），时间序列动量关注单一资产自身的历史收益：

- **回看周期**：经典文献使用 12 个月（252 个交易日）
- **信号生成**：过去 12 个月收益为正 → 做多；为负 → 做空
- **逻辑基础**：资产价格的自相关性（趋势延续）

### 2. 波动率缩放 (Volatility Scaling)

目标：让策略在不同波动环境下保持恒定的风险暴露

```
仓位 = 目标波动率 / 实际波动率
```

- **目标波动率 (σ_target)**：通常设为 10% 或 15% 年化
- **实际波动率 (σ_realized)**：通常用过去 30-60 天日收益计算
- **仓位上限**：防止低波动时期过度杠杆，通常设 150%-200%

## 加密货币市场适配

### 参数调整建议

| 参数 | 传统市场 | 加密货币 | 理由 |
|------|---------|---------|------|
| 回看周期 | 12个月 | 6-12个月 | 加密市场趋势周期更短 |
| 波动率窗口 | 60天 | 30天 | 加密波动率变化更快 |
| 目标波动率 | 10% | 15% | 加密本身波动更高 |
| 仓位上限 | 150% | 150% | 控制极端行情风险 |

### 信号生成逻辑（伪代码）

```python
# 输入：价格序列 prices (日频)
# 输出：交易信号

def tsmom_signal(prices):
    # 1. 计算 12 个月动量
    returns_12m = (prices[-1] - prices[-252]) / prices[-252]
    
    # 2. 确定方向
    if returns_12m > 0:
        direction = "LONG"
    elif returns_12m < 0:
        direction = "SHORT"
    else:
        direction = "NEUTRAL"
    
    # 3. 计算 30 天波动率（年化）
    daily_returns = log(prices[-30:] / prices[-31:-1])
    volatility = std(daily_returns) * sqrt(365)
    
    # 4. 波动率缩放
    target_vol = 0.15  # 15%
    scaling = target_vol / volatility
    position = min(scaling, 1.5)  # 上限 150%
    
    # 5. 移动止损（从最高点回撤 10%）
    if direction == "LONG":
        max_price = max(prices[-252:])
        stop_loss = max_price * 0.90
    else:
        min_price = min(prices[-252:])
        stop_loss = min_price * 1.10
    
    return {
        "direction": direction,
        "position_size": position,
        "entry_price": prices[-1],
        "stop_loss": stop_loss,
        "momentum_12m": returns_12m,
        "volatility_30d": volatility
    }
```

## 预期表现

基于经典文献和加密市场特征：

| 指标 | 预期范围 |
|------|---------|
| 年化收益 | 20-40% |
| 夏普比率 | 0.8-1.2 |
| 最大回撤 | 20-30% |
| 胜率 | 45-55% |
| 交易频率 | 年均 2-4 次 |

## 风险提醒

1. **趋势反转风险**：12 个月回看可能导致信号滞后
2. **波动率估计误差**：30 天窗口可能无法捕捉尾部风险
3. **流动性风险**：大仓位在极端行情下难以执行

## 建议回测验证

在实现前，建议用以下数据进行回测：
- 时间范围：2020-01-01 至 2024-12-31
- 标的：BTC、ETH
- 对比基准：买入持有、双均线策略

---

*文档生成时间：2026-04-11*  
*作者：布丁 (总指挥)*  
*参考：Moskowitz & Grinblatt (1999), Hurst et al. (2013)*
