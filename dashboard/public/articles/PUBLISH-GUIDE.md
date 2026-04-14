# 公众号文章发布流程

## 快速路径（5分钟）

### 1. 从微信后台复制
- 打开公众号后台 → 素材管理 → 找到文章
- **全选复制**（Ctrl+A, Ctrl+C）
- 粘贴到 VS Code / 记事本

### 2. 格式整理（关键步骤）

**删除微信垃圾代码：**
```
# 删掉这些：
- class="rich_media_content"
- style="..." （微信自带的各种样式）
- data-something="..." 
- <script> 标签
```

**保留这些：**
```
# 标题
标题直接放最前面

# 正文结构
## 小标题用 ##
正文段落之间空一行

**粗体用两个星号**

- 列表用 -
- 就这样

> 引用用 > 

---
分割线用三个 -
```

### 3. 塞进模板

1. 复制 `/articles/TEMPLATE.html` （我待会给你做）
2. 重命名为 `dayX-YYYY-MM-DD.html`
3. 改标题、日期、标签
4. Markdown 内容贴到 `<!-- MARKDOWN_START -->` 和 `<!-- MARKDOWN_END -->` 之间

### 4. 检查清单

- [ ] 标题是否吸引人？
- [ ] 前3段能不能抓住读者？
- [ ] 有没有解释专业术语？
- [ ] 策略部分是否放在最后？
- [ ] 图片是否上传到自己的CDN？（不要直接用微信的图片链接）
- [ ] 文章列表页 `/articles/index.html` 是否添加了新文章卡片？

---

## 图片处理

**微信图片的问题：**
微信图片域名 `mmbiz.qpic.cn` 有防盗链，外部网站可能显示不了。

**解决方案：**
1. 下载图片到本地 `articles/images/`
2. 改路径为 `./images/xxx.jpg`
3. 或者上传到图床（推荐：sm.ms / imgur）

---

## 进阶：自动抓取（可选）

如果你想自动化，用这个脚本：

```bash
# wechat-to-md.sh
# 需要安装: npm install -g @github-wechat/wechat-article-crawler

URL=$1
FILENAME=$2

wechat-crawler "$URL" > "articles/${FILENAME}.md"
echo "已保存到 articles/${FILENAME}.md"
```

用法：
```bash
./wechat-to-md.sh "https://mp.weixin.qq.com/s/xxxxx" "day3-2026-03-10"
```

---

## 文件命名规范

```
day{序号}-{日期}.html

例如：
day1-2026-03-08.html
day2-2026-03-09.html
weekend-2026-03-09.html  （周末特辑）
```

---

## 常见问题

**Q: 微信文章里的图表怎么弄？**
A: 截图保存为图片，或者手动做成 Markdown 表格。

**Q: 视频能同步吗？**
A: 微信视频有防盗链，建议改成文字描述 + 外链（比如 B站/YouTube）。

**Q: 排版和微信不一样怎么办？**
A: 网站有网站的风格，不需要和微信完全一致。保持简洁清晰就行。
