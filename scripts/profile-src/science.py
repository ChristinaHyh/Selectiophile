# Source of profiles/papers-science-clipper.json (science.org: Science, Science
# Advances and the other AAAS journals). Run:
#   python3 scripts/profile-src/science.py > profiles/papers-science-clipper.json
# Checked against a saved Science research article (2026, with Read Frog and the
# formula userscript 2.7). science.org shows no keywords, so there are none.
import json, sys
sys.dont_write_bytecode = True  # Chrome refuses an unpacked extension holding __pycache__.
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import chain, READ_FROG_MATH, MATHJAX2, MATHJAX2_RENDERING, CHTML_MATH, CLEAN_ATTRS, QUOTE_MATH, HEADINGS, ABSTRACT

CITATIONS = [
    # (1, 2) style references: each number links to its entry.
    r'replace:"/<a [^>]*data-xml-rid=.R([0-9]+).[^>]*>[^]*?<[/]a>/g":"⟦$1⟧"',
    # Fig. 1A: a link to the figure's caption.
    r'replace:"/<a [^>]*data-target=.core-fv-([FT])([0-9]+).[^>]*>([^<]*)<[/]a>/g":"⟪$1$2|$3⟫"',
    # The caption's number gets the block id.
    r'replace:"/<span class=.heading.[^>]*>(Fig[.] ([0-9]+))<[/]span>[.]?/g":"<b>⟦FIG$2⟧$1.</b>"',
    r'replace:"/<span class=.heading.[^>]*>(Table ([0-9]+))<[/]span>[.]?/g":"<b>⟦TBL$2⟧$1.</b>"',
]
DROP = '.figure-pop-btn,.figure-extra,.figure-links,.core-tools'
LINKS = [
    r'replace:"/⟦([0-9]+)⟧/g":"[[#^ref$1|$1]]"',
    r'replace:"/⟪F([0-9]+)[|]([^⟫]*)⟫/g":"[[#^fig$1|$2]]"',
    r'replace:"/⟪T([0-9]+)[|]([^⟫]*)⟫/g":"[[#^tbl$1|$2]]"',
    r'replace:"/^[*][*]⟦FIG([0-9]+)⟧(.*?)[*][*](.*?) *$/gm":"**$2**$3 ^fig$1"',
    r'replace:"/^[*][*]⟦TBL([0-9]+)⟧(.*?)[*][*](.*?) *$/gm":"**$2**$3 ^tbl$1"',
    r'replace:"/⟦(?:FIG|TBL)[0-9]+⟧/g":""',
    r'replace:"/([!][[][^[]*?][(])[/](?![/])/g":"$1https://www.science.org/"',
]

def section(selector, extra=()):
    return chain(f'selectorHtml:{selector}', READ_FROG_MATH + CHTML_MATH + MATHJAX2 + CITATIONS + [
        'remove_html:("' + MATHJAX2_RENDERING + ',mjx-math,mjx-speech,.cfix-drop,svg,' + DROP + '")',
        CLEAN_ATTRS,
        'markdown',
    ] + LINKS + QUOTE_MATH + HEADINGS + list(extra) + [
        r'replace:"/(?<![!])[[]([^[]*?)][(][/#][^)]*[)]/g":"$1"',
    ])

# Research articles open with an editor's summary and a structured abstract; other
# article types have only some of these.
abstracts = '\n\n'.join(section(s, [ABSTRACT]) for s in ('#editor-abstract', '#structured-abstract', '#abstract'))
body = section('#bodymatter')

# Each entry starts with its number, whether the text follows on the same line or
# in the next paragraph.
references = chain('selectorHtml:#bibliography', [
    r'remove_html:("h2,.label,.external-links,.truncation-wrapper,.read-frog-translated-content-wrapper,svg")',
    r'replace:"/<div [^>]*id=.(?:core-)?R([0-9]+).[^>]*>/g":"<p>⟦R$1⟧</p><div>"',
    r'remove_attr:("class,role,data-read-frog-walked,data-read-frog-paragraph,data-read-frog-inline-node")',
    'markdown',
    r'replace:"/^⟦R([0-9]+)⟧[ \n]*(.+)$/gm":"**$1.** $2 ^ref$1"',
])

DOI = '{{url|replace:"/^.*?doi[/](?:abs[/]|full[/]|epdf[/]|pdf[/])?(10[.][^?#]+).*$/":"$1"}}'

profile = {
    'schemaVersion': '0.1.0',
    'name': 'papers-Science',
    'behavior': 'create',
    'noteContentFormat': f'{abstracts}\n\n{body}\n\n## References\n{references}',
    'properties': [
        {'name': 'title', 'value': '{{selector:[property=author] [property=familyName]|first}}({{meta:name:dc.Date|slice:0,4}})-{{meta:name:dc.Title|split:" "|slice:0,3|join:" "}}', 'type': 'text'},
        {'name': 'source', 'value': '{{url}}', 'type': 'text'},
        {'name': 'doi', 'value': DOI, 'type': 'text'},
        {'name': 'paper_id', 'value': DOI.replace('}}', '|split:"/"|last}}'), 'type': 'text'},
        {'name': 'authors', 'value': '{{selector:meta[name^=dc][name$=Creator]?content|unique|wikilink}}', 'type': 'multitext'},
        {'name': 'published', 'value': '{{meta:name:dc.Date|date:"YYYY-MM-DD"}}', 'type': 'date'},
        {'name': 'created', 'value': '{{date}}', 'type': 'date'},
        {'name': 'journal', 'value': '{{meta:name:citation_journal_title ?? meta:property:og:site_name}}', 'type': 'text'},
        {'name': 'collection', 'value': 'papers', 'type': 'text'},
    ],
    'triggers': ['https://www.science.org/doi/'],
    'noteNameFormat': '{{meta:name:dc.Title ?? title|safe_name}}',
    'path': 'references/papers',
}
print(json.dumps(profile, ensure_ascii=False, indent='\t'))
