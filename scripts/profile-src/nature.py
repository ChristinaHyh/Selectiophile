# Source of profiles/papers-nature-clipper.json, kept readable: one filter per line.
# Run: python3 scripts/profile-src/nature.py > profiles/papers-nature-clipper.json
import json, sys
sys.dont_write_bytecode = True  # Chrome refuses an unpacked extension holding __pycache__.
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import chain, READ_FROG_MATH, MATHJAX2, MATHJAX2_RENDERING, CLEAN_ATTRS, QUOTE_MATH, HEADINGS, ABSTRACT, SUPERSCRIPT_REFS

# Nature's raw TeX, for a page MathJax hasn't rendered yet. The `x` keeps Defuddle
# from dropping an empty <math>.
STATIC_TEX = [
    r'replace:"/<span class=.mathjax-tex.>[$][$]([^<]*?)[$][$]<[/]span>/g":"<math display=block data-latex=\"$1\">x</math>"',
    r'replace:"/<span class=.mathjax-tex.>.[(]([^<]*?).[)]<[/]span>/g":"<math data-latex=\"$1\">x</math>"',
]

body = chain('selectorHtml:.main-content', READ_FROG_MATH + MATHJAX2 + STATIC_TEX + [
    # Equation numbers become \tag{n} and a block id below.
    r'replace:"/<div class=.c-article-equation__number.>[^<(]*[(]([^)<]+)[)][^<]*<[/]div>/g":"<p>⟦EQ$1⟧</p>"',
    # In-text citations: ⟦12⟧, unwrapped from their <sup> so they can be links.
    r'replace:"/<a [^>]*data-test=.citation-ref.[^>]*#ref-CR([0-9]+).[^>]*>[^<]*<[/]a>/g":"⟦$1⟧"',
    r'replace:"/<sup>((?:⟦[0-9]+⟧|[,–−-]|&nbsp;| )+)<[/]sup>/g":"$1"',
    # Figure and table captions keep their number for the block id.
    r'replace:"/<b id=.(Fig|Tab)([0-9]+).[^>]*>/g":"<b>⟦$1$2⟧"',
    'remove_html:("' + MATHJAX2_RENDERING + r',mjx-math,mjx-speech,.cfix-drop,svg,.c-article__pill-button,.c-article-section__figure-link")',
    CLEAN_ATTRS,
    'markdown',
    r'replace:"](//":"](https://"',
    r'replace:"/^[*][*]⟦Fig([0-9]+)⟧((?:Extended Data )?Fig[.] [0-9]+:?) ?(.*?)[*][*](.*)$/gm":"**$2** $3$4 ^fig$1"',
    r'replace:"/^[*][*]⟦Tab([0-9]+)⟧((?:Extended Data )?Table [0-9]+:?) ?(.*?)[*][*](.*)$/gm":"**$2** $3$4 ^tbl$1"',
    r'replace:"/⟦(Fig|Tab)[0-9]+⟧/g":""',
    r'replace:"/^[$][$]\n([^]*?)\n[$][$]\n\n⟦EQ([^⟧]+)⟧$/gm":"$$$$\n$1 \\\\tag{$2}\n$$$$\n\n^eq$2"',
    r'replace:"/⟦EQ[^⟧]*⟧/g":""',
] + SUPERSCRIPT_REFS + [
    r'replace:"/[[]([^[]*?)][(][^)]*#Fig([0-9]+)[)]/g":"[[#^fig$2|$1]]"',
    r'replace:"/[[]([^[]*?)][(][^)]*#Tab([0-9]+)[)]/g":"[[#^tbl$2|$1]]"',
    r'replace:"/[[]([^[]*?)][(][^)]*#Equ([0-9]+)[)]/g":"[[#^eq$2|$1]]"',
] + QUOTE_MATH + HEADINGS + [
    r'replace:"/(?<![!])[[]([^[]*?)][(][/#][^)]*[)]/g":"$1"',
])

abstract = chain('selectorHtml:section[data-title=Abstract]', READ_FROG_MATH + MATHJAX2 + STATIC_TEX + [
    r'replace:"/<a [^>]*data-test=.citation-ref.[^>]*#ref-CR([0-9]+).[^>]*>[^<]*<[/]a>/g":"⟦$1⟧"',
    r'replace:"/<sup>((?:⟦[0-9]+⟧|[,–−-]|&nbsp;| )+)<[/]sup>/g":"$1"',
    'remove_html:("' + MATHJAX2_RENDERING + r',mjx-math,mjx-speech,.cfix-drop,svg")',
    CLEAN_ATTRS,
    'markdown',
] + SUPERSCRIPT_REFS + QUOTE_MATH + HEADINGS + [
    ABSTRACT,
    r'replace:"/(?<![!])[[]([^[]*?)][(][/#][^)]*[)]/g":"$1"',
])

references = chain('selectorHtml:#Bib1-content .c-article-references', [
    r'remove_html:(".c-article-references__links,.read-frog-translated-content-wrapper,svg")',
    r'replace:"/<[/]?(?:ol|li)(?: [^>]*)?>/g":""',
    r'replace:"/<p class=.c-article-references__text. id=.ref-CR([0-9]+).[^>]*>/g":"<p>⟦R$1⟧ "',
    r'remove_attr:("class,data-read-frog-walked,data-read-frog-paragraph,data-read-frog-inline-node")',
    'markdown',
    r'replace:"/^⟦R([0-9]+)⟧ (.*)$/gm":"**$1.** $2 ^ref$1"',
])

profile = {
    'schemaVersion': '0.1.0',
    'name': 'papers-Nature',
    'behavior': 'create',
    'noteContentFormat': f'{abstract}\n\n{body}\n\n## References\n{references}',
    'properties': [
        {'name': 'title', 'value': '{{selector:meta[name=citation_author]?content|first|split:","|first}}({{meta:name:citation_publication_date|slice:0,4}})-{{meta:name:citation_title|split:" "|slice:0,3|join:" "}}', 'type': 'text'},
        {'name': 'source', 'value': '{{url}}', 'type': 'text'},
        {'name': 'doi', 'value': '{{meta:name:citation_doi}}', 'type': 'text'},
        {'name': 'paper_id', 'value': '{{meta:name:citation_doi|split:"/"|last}}', 'type': 'text'},
        {'name': 'authors', 'value': '{{selector:.c-article-author-list a[data-test=author-name]|unique|wikilink}}', 'type': 'multitext'},
        {'name': 'published', 'value': '{{meta:name:citation_online_date|date:"YYYY-MM-DD"}}', 'type': 'date'},
        {'name': 'created', 'value': '{{date}}', 'type': 'date'},
        {'name': 'journal', 'value': '{{meta:name:citation_journal_title}}', 'type': 'text'},
        {'name': 'collection', 'value': 'papers', 'type': 'text'},
        {'name': 'keywords', 'value': '{{selector:.c-article-subject-list__subject|unique}}', 'type': 'multitext'},
    ],
    'triggers': ['https://www.nature.com/articles/'],
    'noteNameFormat': '{{meta:name:citation_title|safe_name}}',
    'path': 'references/papers',
}
print(json.dumps(profile, ensure_ascii=False, indent='\t'))
