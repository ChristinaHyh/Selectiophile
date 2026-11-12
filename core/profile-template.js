// A starting point for metadata configs, with notes on every part. JSON has no
// comments, so the notes are `_notes` and `_note` fields, which the extension ignores.

const COPY = {
  zh: {
    notes: [
      '这是 Selectiophile 的元数据配置模板，格式兼容 Obsidian Web Clipper。改好后在设置页"元数据配置"上传。_notes 和 _note 只是说明，插件会忽略，可以删除。',
      'name：配置名称。上传同名配置会替换原来的，包括内置配置。',
      'triggers：在哪些网页使用。可以写网址开头（如 https://www.example.com/articles/），也可以写正则（如 /example\\.com\\/(articles|papers)/）。从上往下，第一个匹配的配置生效。',
      'properties：要写入新笔记 frontmatter 的字段，只在新建笔记时使用。值为空的字段不写入，字段顺序由插件统一排列。',
      'type：text 文本，multitext 列表，date 日期，number 数字。',
      '取值写在 {{ }} 里。meta:name:xxx 读 <meta name="xxx">；meta:property:xxx 读 <meta property="xxx">；selector:CSS 读元素文字；selector:CSS?属性 读元素属性；selectorHtml:CSS 读元素 HTML。还可以用 url、title、date、domain、published。',
      '用 ?? 设置备选：{{meta:name:a ?? meta:name:b}} 先读 a，为空再读 b。不带 {{ }} 的内容会原样写入。',
      '用 | 接过滤器，从左到右处理：first、last、split:","、slice:0,4、join:" "、unique、wikilink、replace:"旧":"新"（也支持正则 replace:"/[^0-9]/g":""）、date:"YYYY-MM-DD"、safe_name、remove_html:(".选择器")、remove_attr:("class")、markdown、strip_tags、trim、lower、upper。不支持的过滤器会被跳过，上传时会提示。',
      '不用写 source：插件会自动写入 url。不支持 schema: 触发条件。',
      '剪藏原文（可选）：加上 noteContentFormat（正文模板）、noteNameFormat（原文文件名）和 path（如 references/papers，从设置里的库根目录算起），就能把整篇原文存进库里，写法和 Web Clipper 完全相同，由 Web Clipper 自己的模板引擎处理。注意：过滤器参数里的一个反斜杠要写成四个（JSON 里写八个），?? 后面的过滤器只作用于最后一个备选。',
      '不知道网页有哪些元数据？在网页上按 F12，在 Elements 里搜索 citation_ 或 og:。',
    ],
    title: 'title 同时是文件名。这里生成"第一作者(年份)-标题前 3 个词"。如果网页的作者写成"姓, 名"，把 split:" " 改成 split:","，把 last 改成 first。',
    authors: '作者列表。wikilink 让每位作者变成 [[双链]]，不需要的话删掉 |wikilink。',
    journal: '期刊名。',
    published: '发表日期，?? 依次尝试多个来源，date 统一格式。',
    doi: '建议保留：插件靠 DOI 识别同一篇论文，换个网址也能找到已有笔记。',
    paper_id: '可选的编号示例：取 DOI 的最后一段。用不上就删掉这一项。',
    keywords: '关键词。如果网页把关键词放在页面元素里，改成 {{selector:.keyword|unique}} 这样的写法。',
    created: '笔记的创建日期。',
  },
  en: {
    notes: [
      'A metadata config template for Selectiophile, compatible with Obsidian Web Clipper. Edit it, then upload it under "Metadata configs" in settings. _notes and _note are only explanations: the extension ignores them, and you can delete them.',
      'name: the config\'s name. Uploading the same name replaces the old one, built-in configs included.',
      'triggers: the pages to use it on. Either the start of a URL (https://www.example.com/articles/) or a regex (/example\\.com\\/(articles|papers)/). The first matching config wins, top to bottom.',
      'properties: fields written to a new note\'s frontmatter, only when the note is created. Empty values are skipped, and the extension sets the field order.',
      'type: text, multitext (a list), date or number.',
      'Values go in {{ }}. meta:name:xxx reads <meta name="xxx">; meta:property:xxx reads <meta property="xxx">; selector:CSS reads an element\'s text; selector:CSS?attr reads an attribute; selectorHtml:CSS reads its HTML. Also available: url, title, date, domain, published.',
      'Use ?? for fallbacks: {{meta:name:a ?? meta:name:b}} tries a, then b. Text outside {{ }} is written as is.',
      'Add filters with |, applied left to right: first, last, split:",", slice:0,4, join:" ", unique, wikilink, replace:"old":"new" (or a regex, replace:"/[^0-9]/g":""), date:"YYYY-MM-DD", safe_name, remove_html:(".selector"), remove_attr:("class"), markdown, strip_tags, trim, lower, upper. Unsupported filters are skipped, and an upload says so.',
      'No need for source: the extension writes url itself. schema: triggers are not supported.',
      'Clipping the original (optional): add noteContentFormat (the body template), noteNameFormat (the original\'s file name) and path (such as references/papers, counted from the vault root in settings) to save the whole page to the vault. They work exactly as in Web Clipper, rendered by Web Clipper\'s own template engine. Note that one backslash in a filter argument is written as four (eight inside JSON), and filters after ?? apply to the last fallback only.',
      'Not sure what metadata a page has? Press F12 on the page and search Elements for citation_ or og:.',
    ],
    title: 'title also names the file. This makes "First author(year)-first 3 title words". If the page writes authors as "Last, First", change split:" " to split:"," and last to first.',
    authors: 'The author list. wikilink makes each a [[link]]. Remove |wikilink if you don\'t want that.',
    journal: 'The journal name.',
    published: 'The publication date. ?? tries several sources, and date sets the format.',
    doi: 'Worth keeping: the extension uses the DOI to recognize a paper, so it finds the note from any URL.',
    paper_id: 'An optional example: the last part of the DOI. Delete it if you don\'t need it.',
    keywords: 'Keywords. If the page shows them in elements instead, use something like {{selector:.keyword|unique}}.',
    created: 'The date the note was created.',
  },
};

export function profileTemplate(lang = 'zh') {
  const c = COPY[lang] || COPY.zh;
  const field = (name, value, type) => ({ name, value, type, _note: c[name] });
  return {
    _notes: c.notes,
    schemaVersion: '0.1.0',
    name: 'my-journal',
    triggers: ['https://www.example.com/articles/'],
    properties: [
      field('title', '{{selector:meta[name=citation_author]?content|first|split:" "|last}}({{meta:name:citation_publication_date|slice:0,4}})-{{meta:name:citation_title|split:" "|slice:0,3|join:" "}}', 'text'),
      field('authors', '{{selector:meta[name=citation_author]?content|unique|wikilink}}', 'multitext'),
      field('journal', '{{meta:name:citation_journal_title}}', 'text'),
      field('published', '{{meta:name:citation_publication_date ?? meta:name:citation_online_date ?? published|date:"YYYY-MM-DD"}}', 'date'),
      field('doi', '{{meta:name:citation_doi}}', 'text'),
      field('paper_id', '{{meta:name:citation_doi|split:"/"|last}}', 'text'),
      field('keywords', '{{meta:name:citation_keywords|split:";"|trim|unique}}', 'multitext'),
      field('created', '{{date}}', 'date'),
    ],
  };
}
