# Filter lines shared by the bundled paper configs. The first block is site-agnostic:
# it turns Read Frog's translations into quotes and the formula userscript's marked
# MathJax into <math data-latex>, exactly as the user's ACS/MDPI/ScienceDirect configs do.

def chain(source, filters):
    return '{{' + '|'.join([source] + filters) + '}}'

READ_FROG_MATH = [
    r'replace:"<cfix-end></cfix-end></span>":"</blockquote>"',
    r'replace:"/<span [^>]*read-frog-translated-block-content[^>]*>/g":"<blockquote>"',
    r'replace:"<mjx-math data-blatex":"<math display=block data-latex"',
    r'replace:"<mjx-math data-latex":"<math data-latex"',
]

# Pages typeset by MathJax 2 (nature.com) keep each formula's TeX in a script tag
# next to its rendering: use that TeX, as the userscript's marks only cover MathJax 3.
MATHJAX2 = [
    r'replace:"/<script type=.math[/]tex; mode=display.[^>]*>([^]*?)<[/]script>/g":"<math display=block data-latex=\"$1\">x</math>"',
    r'replace:"/<script type=.math[/]tex.[^>]*>([^]*?)<[/]script>/g":"<math data-latex=\"$1\">x</math>"',
]
# MathJax 3's CHTML output (science.org) holds no text, only glyph classes, and
# Defuddle drops a <math> without text: once a formula carries its LaTeX, keep a
# placeholder in place of its rendering.
CHTML_MATH = [
    r'replace:"/(<math [^>]*data-latex=[^>]*>)[^]*?<[/]mjx-math>/g":"$1x</math>"',
]
# Not `.MathJax`: MathJax 3's own container carries that class too.
MATHJAX2_RENDERING = '.MathJax_Preview,.MathJax_SVG_Display,.MathJax_SVG,.MJX_Assistive_MathML'

CLEAN_ATTRS = r'remove_attr:("class,data-read-frog-walked,data-read-frog-paragraph,data-read-frog-inline-node,data-cfix-chem")'

# Display math inside a translated quote, and empty quote lines.
QUOTE_MATH = [
    r'replace:"/^> [$][$]([^])> (.*)[^]> [$][$]$/gm":">$1> $$$$ $2 $$$$$1>"',
    r'replace:"/^>$[^]>$/gm":">"',
    r'replace:"/^>$[^](?!>)/gm":""',
]

# A heading's translation joins the heading line, numbering is dropped from the
# translation, and no-break spaces become spaces.
NB = '\u00a0'
HEADINGS = [
    'replace:"/^(#+ .*?)[ ' + NB + ']*$[^][^]?^> (.+)$/gm":"$1  $2"',
    r'replace:"/^(#+ [0-9]+)[Z-^]([.] )/gm":"$1$2"',
    'replace:"/^(#+ .+?[ ' + NB + '][ ' + NB + '])(?:[0-9][0-9.]*(?:[Z-^]?[.．、:：)）] ?| )|[一二三四五六七八九十]+[、．.] ?)/gm":"$1"',
    'replace:"/(?<=^#+ .*)' + NB + '/gm":" "',
]
ABSTRACT = 'replace:"/^(#+ Abstract)[ ' + NB + ']+[^ ' + NB + '].*$/gm":"$1  摘要"'

# ⟦12⟧ becomes [[#^ref12|¹²]]: a link to the reference, still reading as a superscript.
_SUP = dict(zip('0123456789', '⁰¹²³⁴⁵⁶⁷⁸⁹'))
SUPERSCRIPT_REFS = [r'replace:"/⟦([0-9]+)⟧/g":"[[#^ref$1|⟪$1⟫]]"'] + [
    f'replace:"/(?<=⟪[^⟫]*){d}(?=[^⟪]*⟫)/g":"{s}"' for d, s in _SUP.items()
] + [r'replace:"/[⟪⟫]/g":""']
