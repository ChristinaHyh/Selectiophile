<p align="center">
  <img src="icons/icon.svg" width="88" alt="Selectiophile">
</p>

<h1 align="center">Selectiophile</h1>

<p align="center">
  在网页上划线和评论，一键存到 Obsidian 笔记的对应标题下，并可把原文剪藏入库。<br>
  Highlight and comment on web pages, file each under the right heading of your Obsidian note, and keep the page as the original.
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

Selectiophile（原名 Lectiophile）是一个 Chrome 扩展，给在网页上读论文和文章、在 Obsidian 里记笔记的人用。选中一段话，想写评论就写一句，它会存到对应笔记的对应标题下，你可以接着往下读，不用切到 Obsidian 找位置、粘贴、补链接。

AI 只判断存到哪里，不写笔记。引用和评论都原样写入，没有 API Key 也能使用，由你自己选择标题。

<p align="center">
  <img src="docs/screenshots/zh-highlight.png" width="640" alt="选中文字后点颜色即可划线"><br><br>
  <img src="docs/screenshots/zh-saved-note.png" width="640" alt="划线和评论写入笔记的对应标题下">
</p>

### 功能

- **划线和评论**：选中文字后点颜色，或按 `Alt+S` 直接保存；按 `Alt+C` 先写评论，再按 `Ctrl+Enter` 保存。
- **六种颜色**：每种颜色的用途可以自己命名，比如结论、方法、灵感。
- **高亮可以修改**：重新打开网页后高亮还在。点击高亮可以改颜色、加或改评论、改位置和删除。
- **自动找到笔记**：论文按 DOI、arXiv ID、网址和标题查找，普通文章按网址和标题查找。没有对应笔记就用模板新建。
- **自动选择标题**：由 [Jev](https://typesafe.ai/) 判断。概率达到你设置的门槛（默认 90%）就直接保存，否则列出选项，按数字键选择。
- **AI 对话里也能划线**：内置了 ChatGPT、Claude、Gemini、DeepSeek、Kimi 等网站的规则。第一次划线时根据前几轮对话关联笔记，之后都存到已关联的笔记。
- **钉住笔记**：钉住一篇后，之后的划线都存到这篇。
- **文档类别**：设置页"笔记文档配置"按类别组织，默认有学术文献和网页文章两类，可以新增。每个类别有自己的元数据配置、笔记模板（可以指定直接使用它的网站，支持通配符，以及新笔记存放的子文件夹）和剪藏设置。网页按匹配到的配置归类；没有匹配时，论文归入学术文献，其他网页归入网页文章。
- **元数据配置**：兼容 Obsidian Web Clipper 的 JSON 格式，用来生成 frontmatter 和文件名。内置了 ACS、MDPI、ScienceDirect、Nature、Science，以及给没有专用配置的网页（博客、新闻等）用的通用文章配置 `web-article`。
- **原文剪藏**：配置里有 `noteContentFormat` 时，可以把整篇文献按配置存进库里（如 `references/papers`），由 Web Clipper 自己的模板引擎转成 Markdown。剪下的原文是存档，供人或 AI 日后回溯：只存原文，不存 Read Frog 译文；正文里的文献引用、图表和公式引用、章节引用都变成文件内的链接（如 `[[#^ref12|¹²]]`、`[[#^fig2|Fig. 2a]]`），对应的文献条目、图注、编号公式带块 ID（`^ref12`、`^fig2`、`^tbl1`、`^eq3`），其余每个段落按文字生成块 ID（`^p-1x2y3z`），同一段文字重新剪藏时 ID 不变，图片所在的行不加 ID。笔记里每条划线的链接带一个看不见的属性 `data-clip="原文名#^p-1x2y3z"`，指向它在原文里的段落：先划线后剪藏的，剪藏时补上；已剪藏的，保存划线时写入。划线跨段时指向起始段，原文里找不到这段文字时不加。读书笔记的 `references` 属性和 References 标题下都会链接到原文（旧笔记的 `reference` 属性会改名为 `references`），原文的 `notes` 字段链接回笔记，`clipped` 记录入库日期，`clip_check` 记录剪藏时和网页正文核对的结果（如 `text 249/249 blocks, duplicates 0, formulas 32/32`），漏段落、重复图表时会提示，并在原文里加 `clip_review` 属性写明问题（如 `incomplete, check against the page: formulas 0/84`），提醒日后读它的人或 AI 先对照网页（`url`）核查；重新剪藏且没有问题时这个属性消失，人工核查过也可以自己删掉。每个类别有一个“自动剪藏”开关（学术文献默认开，网页文章默认关）：打开时，创建笔记或写页面简评时自动剪藏；关闭时点工具栏图标手动剪藏。类别可以指定剪藏文件夹，留空时用配置里的 `path`。没有专用配置的网页（博客、新闻等）按 `web-article` 配置剪藏，默认存到 `references/articles`。
  - 公式不需要另装油猴脚本：剪藏时在网页的副本上补齐 LaTeX（MathJax 2 和 3，有无隐藏 MathML 都可以）。网页本身不会被改动。网页用 TeX 写的公式，存的就是作者原来的 TeX，包括还没滚动到、MathJax 还没画出来的公式（懒加载，如 MDPI）；只有用了网页自定义宏（Obsidian 不认识）的公式，和本来就是 MathML 的公式，才由 MathML 转成 LaTeX。
  - 网站配置只需写三样：正文在哪（`selectorHtml`）、要去掉什么（`remove_html`）、元数据（`properties`），例如 `{{selectorHtml:#body|remove_html:(".download-link")|markdown}}`。引用、图表、公式编号的处理在插件里完成，插件认得 Springer Nature、Atypon（Science 等）、Silverchair（ACS 等）、MDPI 和 Elsevier 这几个出版平台的标记方式。
  - 剪完会自查：公式明显变少、正文几乎为空、留有没处理完的标记时，提示框会说明。这通常表示网站改版了，配置需要更新。
  - 公式取自 MathJax。公式没剪下来时，在网页的公式上右键，在 MathJax 菜单的 Options 里勾选 Include Hidden MathML，再剪藏一次。
  - 配置里 `a ?? b | date:"YYYY-MM-DD"` 这样写在最后的过滤器，对找到的任一个值都生效，读书笔记和剪藏一致（Web Clipper 本身只对最后一个值生效）。
  - 修配置不必等新版本：在设置页下载内置配置，修改后用同样的 `name` 上传，就会替代内置的那份。同一个文件也能直接导入 Web Clipper。
- **网页简评**：按 `Alt+R`，或点工具栏图标再点"写简评"，给整篇文章写几句评价，窗口和评论框风格相同。简评写进这篇网页对应笔记的 `comments` 属性。还没有笔记时，简评先存在插件里，原文剪藏后也写进原文的 `comments`，看板里能看到；有笔记后移到笔记里。所属类别打开了自动剪藏的，保存简评时会同时剪藏原文，并在笔记里链接它。没加入白名单的网站也能从工具栏图标写简评。
- **看板**：预设的两张 Dataview 表格：笔记（来源列链接到网页，显示期刊或网站名；不含剪藏的原文）和入库原文（原文、剪藏日期、简评、对应笔记，按剪藏日期排列，最多 100 篇）。表头随设置页的语言切换。默认存在库的顶层，可以从下拉列表选子文件夹，也可以把库里的文件夹拖进设置页。想要别的表格时，直接在 Obsidian 里改这篇笔记（写法见 Dataview 文档），改过的看板插件不会覆盖。需要 Dataview 插件。
- **其他**：白名单、黑名单和所有网站三种模式；只写入笔记、不显示网页高亮的模式；数据备份和恢复；两套配色；中文和 English 界面。

目前只支持网页，不支持 PDF。

### 写入笔记的样子

不需要自定义 CSS，划线是普通引用，评论是列表项：

```markdown
## Main Findings

> <span style="color:#7fae8c">■</span> 划线原文 <sup>结论 · <a href="https://…" data-lp="a1b2" title="2026-11-06">原文</a></sup>

- **Comments：** 我的评论
```

`■` 是划线颜色，`结论` 是这个颜色的用途，`原文` 是跳回网页这段文字的链接。`data-lp` 是这条划线的 ID，阅读时看不到，撤销、移动和删除都靠它。

### 安装

1. 下载这个仓库，解压到一个固定的位置。
2. 打开 `chrome://extensions`，开启"开发者模式"，点"加载已解压的扩展程序"，选择这个文件夹。
3. 在弹出的设置页选择 Obsidian 库的文件夹。笔记和剪藏的原文都存在库里，位置在"笔记文档配置"里按类别设置。Chrome 重启后可能需要到这里重新授权一次。
4. 可选：填写 Jev API Key。
5. 打开要读的网页，点工具栏图标，再点"加入白名单"。

需要 Chrome 111 或更新的版本。看板需要在 Obsidian 里安装 Dataview 插件。

详细用法见[使用说明](使用说明.md)。

### 隐私

- 不需要账号，没有服务端，不做统计。笔记是你电脑上所选文件夹里的普通 Markdown 文件。
- Jev Key、高亮的定位和颜色、设置都保存在浏览器本地。Key 未加密，也不会写入备份文件。
- 没有 Key 时不发送任何内容。填写 Key 后，判断存放位置所需的内容会发送给 Jev（TypeSafe AI）：划线、评论、所在段落、网页标题和网址，以及候选笔记的标题和小标题。在 AI 对话页面第一次划线时，还会发送这个对话的前几轮，可以在设置里设为 0 关闭。

### 开发

纯原生 JavaScript，源码就是扩展本身。唯一的例外是 `vendor/clipper.js`：Obsidian Web Clipper 的模板引擎（knap）和 Markdown 转换（Defuddle），从 Web Clipper 源码打包而来，只在剪藏原文时注入网页。更新它：

```bash
npm i --prefix <依赖目录> knap@0.6.0 defuddle@0.19.2 dayjs esbuild mathml-to-latex@1.8.0 turndown temml
node scripts/build_clipper.mjs <obsidian-clipper 源码> <依赖目录>
```

剪藏前的网页整理在 `content/clip-prep.js`（去掉译文、补齐公式 LaTeX、标出引用和图表），转成 Markdown 之后的收尾在 `core/archive.js`（链接、块 ID）。

**剪藏格式的维护。** 网站改版时，用样本核对：

1. 在该网站的文章页上按 Ctrl+S 保存（翻译过也可以，译文不会进剪藏），放进样本目录的一个子文件夹，命名为 `page.html`，再写一个 `case.json`：`{ "url": "文章网址", "config": "papers-science-clipper.json" }`。
2. `node scripts/check_clips.mjs <装有 playwright 的目录> <样本目录>` 会按当前配置重新剪藏每个样本，和上次认可的 `expected.md` 逐行比较，并列出自查发现的问题。
3. 修改配置或 `clip-prep.js`，直到结果正确，再加 `--update` 认可新结果。之后每次改动都跑一遍，确认其他网站没受影响。

样本是整篇文章，只放在本地（如 `temp/selectiophile-samples`），不放进扩展目录，也不要公开。

**看板的 Dataview 查询**用 Dataview 本身检查：`node scripts/check_dashboard.cjs <库里的 .obsidian/plugins/dataview/main.js>`。Dataview 遇到某一列出错时会直接丢掉这一行，在 Obsidian 里不报错，所以改了 `core/dashboard.js` 之后要跑一遍。

```bash
npm test                                  # 核心逻辑
node e2e/run.mjs <装有 playwright 和 mathjax@3.2.2 的目录>   # 在无头 Chromium 中跑完整流程
npm run eval                              # 用真实 Jev 评估归类，需要 TYPESAFE_API_KEY
python3 scripts/build_release.py <目录>    # 生成上传 Chrome 应用商店的 zip
```

| 目录 | 内容 |
|---|---|
| `core/` | 不依赖界面的逻辑：笔记读写、归类、保存流程 |
| `content/` | 网页里的工具栏、评论框、高亮和提示 |
| `popup/`、`options/` | 工具栏弹窗和设置页 |
| `profiles/` | 内置的元数据配置 |
| `vendor/` | 打包好的 Web Clipper 模板引擎，用于剪藏原文 |
| `e2e/`、`eval/` | 端到端测试和 Jev 评估 |
| `scripts/` | 打包和生成商店图片 |

端到端测试用浏览器私有文件系统代替真实文件夹，并模拟 Jev 的回答，所以真实的文件夹授权和 Jev 判断要手动确认。

### 致谢

感谢 **Joe**，是他给了我开发这个插件的灵感。

元数据配置的格式来自 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper)，剪藏原文使用它的模板引擎（MIT 许可）。Selectiophile 是独立项目，与 Obsidian 官方没有关联。

---

## English

Selectiophile (formerly Lectiophile) is a Chrome extension for people who read papers and articles on the web and keep notes in Obsidian. Highlight a passage, add a comment if you like, and it is written under the right heading of the right note. You keep reading, with no switching to Obsidian to find the spot, paste and add the link.

AI only decides where a highlight goes and never writes your notes. Quotes and comments are saved exactly as they are. It also works without an API key: you choose the heading yourself.

<p align="center">
  <img src="docs/screenshots/en-highlight.png" width="640" alt="Select text and click a color to highlight it"><br><br>
  <img src="docs/screenshots/en-saved-note.png" width="640" alt="Highlights and comments saved under the right headings of a note">
</p>

### Features

- **Highlight and comment**: select text and click a color, or press `Alt+S` to save. Press `Alt+C` to write a comment first, then `Ctrl+Enter` to save.
- **Six colors**: name what each one is for, such as finding, method or idea.
- **Editable highlights**: highlights come back when you reopen a page. Click one to change its color, add or edit its comment, move it or delete it.
- **Finds the note**: papers are matched by DOI, arXiv ID, address and title, and articles by address and title. If there is no note yet, one is created from a template.
- **Chooses the heading**: [Jev](https://typesafe.ai/) decides. Above the confidence level you set (90% by default) it saves straight away. Below it, you see the options and press a number key.
- **Works in AI chats**: rules are included for ChatGPT, Claude, Gemini, DeepSeek, Kimi and others. The first highlight links the conversation to your notes using its first rounds, and later ones go to the linked notes.
- **Pinned notes**: pin a note to send every highlight to it.
- **Templates and folders**: upload your own note templates and tie them to sites with wildcards, and send each template's new notes to a subfolder.
- **Metadata configs**: uses the Obsidian Web Clipper JSON format to fill in frontmatter and file names. ACS, MDPI, ScienceDirect, Nature and Science are included, plus `web-article`, a general config for pages without one of their own (blogs, news).
- **Clipping originals**: when a config has `noteContentFormat`, the whole paper can be saved to the vault by it (for example to `references/papers`), turned into Markdown by Web Clipper's own template engine. The clip is an archive, for a person or an AI to go back to: the original only, without Read Frog's translations. The text's citations and its references to figures, tables, equations and sections become links within the file (`[[#^ref12|¹²]]`, `[[#^fig2|Fig. 2a]]`); reference entries, captions and numbered equations carry block ids (`^ref12`, `^fig2`, `^tbl1`, `^eq3`), and every other paragraph one made from its text (`^p-1x2y3z`), the same when the page is clipped again. Image lines get none. Each entry's link in a note carries a hidden `data-clip="original#^p-1x2y3z"` pointing to the paragraph of the original it came from: written when the entry is saved if the page is clipped, otherwise when it is. A highlight across paragraphs points to where it starts; text the original doesn't hold gets none. The reading note links to it in its `references` property and under its References heading (an older note's `reference` property is renamed to `references`), the original's `notes` field links back, `clip_check` records how it compared with the page's text when clipped (for example `text 249/249 blocks, duplicates 0, formulas 32/32`), with a warning for missing paragraphs or repeated figures; such a clip also gets a `clip_review` property naming what looks wrong (for example `incomplete, check against the page: formulas 0/84`), telling a person or an AI reading it later to check it against the page (`url`) first. Clipping again without problems drops it, and it can be deleted by hand once checked; and `clipped` records the day it was clipped. Each document type has one switch: clip the page by itself when its note is created or a page comment is saved; otherwise clip from the toolbar icon. Pages without a config of their own (blogs, news) are clipped by the `web-article` config to `references/articles`.
  - Config links: under "Configs & clipping" in settings, each config can be given the template its new notes start from and the folder its originals go to. A template tied to a site comes first.
  - Formulas need no userscript: clipping prepares a copy of the page, filling in LaTeX (MathJax 2 and 3, with or without hidden MathML). The page itself is left as it was. A formula the page writes in TeX is saved as the authors' TeX, even one MathJax hasn't drawn yet because it wasn't scrolled to (lazy typesetting, as on MDPI); only formulas using the page's own macros, which Obsidian wouldn't know, and formulas written in MathML are converted from MathML.
  - A site's config says three things: where the article is (`selectorHtml`), what to leave out (`remove_html`), and the metadata (`properties`), for example `{{selectorHtml:#body|remove_html:(".download-link")|markdown}}`. Citations, figures and equation numbers are handled by the extension, which knows how the Springer Nature, Atypon (Science and others), Silverchair (ACS and others), MDPI and Elsevier platforms mark them.
  - Each clip is checked: when formulas are clearly missing, the text is almost empty, or unprocessed marks remain, the notice says so. That usually means the site changed and its config needs updating.
  - Formulas are read from MathJax. If they are missing, right-click a formula on the page, turn on Include Hidden MathML under Options in the MathJax menu, and clip again.
  - A filter written after the last fallback, as in `a ?? b | date:"YYYY-MM-DD"`, applies to whichever value is found, in reading notes and clips alike (Web Clipper itself applies it to the last value only).
  - Fixing a config needs no new release: download the bundled one in settings, edit it, and upload it with the same `name` to replace it. The same file imports into Web Clipper as is.
- **Page comments**: press `Alt+R`, or click the toolbar icon and "Write a comment", to write a few lines about the whole article, in a window styled like the comment box. The comment goes into the `comments` property of the page's note. Before the page has a note it is kept in the extension and, once the page is clipped, in the original's `comments`, so the dashboard shows it; it moves to the note when there is one. A document type set to clip by itself clips the page when you comment on it, linked from the note. It works from the toolbar icon on sites not on your list too.
- **Dashboard**: two preset Dataview tables: notes (the source links the web page, shown as the journal or site; clipped originals are left out) and clipped originals (original, clip date, comment and note, by clip date, up to 100). Headings follow the language of the settings page. It goes at the top of the vault, or a subfolder picked from the list or dragged in from the file manager. For other tables, edit the note in Obsidian (see the Dataview docs); an edited dashboard is never overwritten. Requires the Dataview plugin.
- **Also**: allowlist, blocklist and all-sites modes; a mode that writes to notes without showing page highlights; backup and restore; two color themes; English and Chinese interfaces.

Web pages only. PDFs are not supported yet.

### What a saved entry looks like

No custom CSS is needed. The highlight is a plain blockquote and the comment is a list item:

```markdown
## Main Findings

> <span style="color:#7fae8c">■</span> The highlighted text <sup>Finding · <a href="https://…" data-lp="a1b2" title="2026-11-06">Source</a></sup>

- **Comments:** My comment
```

`■` is the highlight color, `Finding` is what that color is for, and `Source` links back to this passage on the page. `data-lp` is the highlight's ID. It doesn't show when reading, and undo, move and delete rely on it.

### Installation

1. Download this repository and unzip it somewhere permanent.
2. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose this folder.
3. On the settings page that opens, choose the folder in your Obsidian vault that holds your notes. Chrome may ask you to authorize it again here after a restart.
4. Optional: enter a Jev API key.
5. Open a page you want to read, click the toolbar icon, then click "Add to allowlist".

Requires Chrome 111 or later. The dashboard requires the Dataview plugin in Obsidian.

The detailed [user guide](使用说明.md) is in Chinese.

### Privacy

- No account, no server and no analytics. Notes are plain Markdown files in the folder you choose on your computer.
- The Jev key, highlight positions and colors, and settings stay in your browser. The key is not encrypted, and it is never written to backup files.
- Without a key, nothing is sent. With a key, what is needed to decide where a highlight goes is sent to Jev (TypeSafe AI): the highlight, comment, paragraph, page title and address, and the titles and headings of candidate notes. The first highlight on an AI chat page also sends the first rounds of that conversation, which you can turn off by setting it to 0.

### Development

Plain JavaScript; the source is the extension. The one exception is `vendor/clipper.js`: Obsidian Web Clipper's template engine (knap) and Markdown converter (Defuddle), bundled from Web Clipper's source and injected into a page only when clipping it. To update it:

```bash
npm i --prefix <deps dir> knap@0.6.0 defuddle@0.19.2 dayjs esbuild mathml-to-latex@1.8.0 turndown temml
node scripts/build_clipper.mjs <obsidian-clipper source> <deps dir>
```

The page is prepared for clipping in `content/clip-prep.js` (translations out, formulas' LaTeX in, citations and figures marked), and the Markdown is finished in `core/archive.js` (links, block ids).

**Keeping clip formats working.** When a site changes, check it against samples:

1. Save an article page of that site with Ctrl+S (translated or not: translations stay out of clips) as `page.html` in a folder of the samples dir, with a `case.json`: `{ "url": "the article's address", "config": "papers-science-clipper.json" }`.
2. `node scripts/check_clips.mjs <dir with playwright> <samples dir>` clips every sample again with the current configs, compares each line with the last approved `expected.md`, and lists what the clip check finds.
3. Change the config or `clip-prep.js` until the clip is right, then approve it with `--update`. Run it after every change, so other sites are known to be unaffected.

Samples are whole articles: keep them local (for example `temp/selectiophile-samples`), outside the extension folder, and never publish them.

**The dashboard's Dataview queries** are checked with Dataview itself: `node scripts/check_dashboard.cjs <a vault's .obsidian/plugins/dataview/main.js>`. Dataview drops a row whose column fails, with no error in Obsidian, so run it after changing `core/dashboard.js`.

```bash
npm test                                   # core logic
node e2e/run.mjs <dir with playwright and mathjax@3.2.2>     # full flows in headless Chromium
npm run eval                               # measure filing with real Jev; needs TYPESAFE_API_KEY
python3 scripts/build_release.py <dir>     # build the zip for the Chrome Web Store
```

| Folder | Contents |
|---|---|
| `core/` | Logic with no UI: reading and writing notes, filing, the save flow |
| `content/` | The toolbar, comment box, highlights and messages on the page |
| `popup/`, `options/` | The toolbar popup and settings page |
| `profiles/` | Bundled metadata configs |
| `vendor/` | Web Clipper's bundled template engine, for clipping originals |
| `e2e/`, `eval/` | End-to-end tests and the Jev evaluation |
| `scripts/` | Packaging and store images |

End-to-end tests use the browser's private file system in place of a real folder, and scripted Jev answers, so real folder permissions and real Jev decisions need checking by hand.

### Acknowledgements

Thanks to **Joe**, who gave me the idea for this extension.

The metadata config format comes from [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper), and clipping originals uses its template engine (MIT license). Selectiophile is an independent project, not affiliated with Obsidian.
