# SlowRich Dashboard 统一风格重构计划

## 目标
统一所有页面为清爽浅色风格（参考 IBIT 回测页面）

## 待重构文件

| 文件 | 当前状态 | 优先级 |
|------|---------|--------|
| index.html | ✅ 已完成 | - |
| backtest-wheel-ibit.html | ✅ 已完成（参考标准） | - |
| backtest-wheel.html | ❌ 旧深色风格 | 高 |
| backtest-dip.html | ❌ 旧深色风格 | 高 |
| backtest-allweather.html | ❌ 旧深色风格 | 高 |
| options-monitor.html | ❌ 旧深色风格 | 中 |

## 统一规范

### 颜色规范
- 背景: #fafafa
- 卡片背景: #ffffff
- 边框: #e5e7eb
- 主文字: #1a1a1a
- 次要文字: #666666
- 强调色: #10b981 (green), #f59e0b (amber)
- 细阴影: 0 1px 2px rgba(0,0,0,.04)

### 导航规范
```
SlowRich (品牌) | 实盘信号 | 策略库 | 知识库 | 组合
```

### 布局规范
- 容器: max-width: 1200px, margin: 0 auto
- 卡片圆角: 10-12px
- 内边距: 紧凑 (12-16px)
- 字体: Inter / system-ui

### 组件规范
1. **统计卡片**: 白色背景，细边框，紧凑padding
2. **图表区域**: 白色卡片，圆角，内嵌canvas
3. **表格**: 简洁线条，hover效果
4. **按钮**: 圆角8px，主按钮绿色
5. **输入框**: 白色背景，细边框

## 重构步骤
1. 逐一重构每个回测页面
2. 进化官评审
3. Mark 验收
4. 统一整合
