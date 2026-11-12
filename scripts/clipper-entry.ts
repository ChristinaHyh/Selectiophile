// Bundled into vendor/clipper.js by scripts/build_clipper.mjs. It runs Obsidian Web
// Clipper's own template pipeline (knap templates, Defuddle Markdown), so a config
// clips the same text here as in Web Clipper. Mirrors `clip()` in the Clipper's
// src/api.ts, except that selectors read the live page, which holds Read Frog's
// translations and any userscript's marks, and Defuddle gets a copy, as it edits
// the document it reads.
import DefuddleClass from 'defuddle';
import { createMarkdownContent } from 'defuddle/full';
import { compileTemplate } from 'clipper/utils/template-compiler';
import { buildVariables, generateFrontmatter, formatPropertyValue } from 'clipper/utils/shared';
import { sanitizeFileName } from 'clipper/utils/string-utils';
import { createAsyncResolver, createSelectorProcessor } from 'clipper/api';
// The converter the formula userscript embeds (same version), for content/clip-prep.js.
import { MathMLToLaTeX } from 'mathml-to-latex';

interface ClipTemplate {
	noteNameFormat: string;
	noteContentFormat: string;
	path: string;
	properties: { name: string; value: string; type?: string }[];
}

async function clipDocument({ template, doc, url }: { template: ClipTemplate; doc: Document; url: string }) {
	let parsed: any = {};
	try {
		parsed = new DefuddleClass(doc.cloneNode(true) as Document, { url }).parse();
	} catch (e) {
		console.warn('Selectiophile: Defuddle failed, so {{content}} is empty', e);
	}
	const variables = buildVariables({
		title: parsed.title || doc.title,
		author: parsed.author,
		content: parsed.content ? createMarkdownContent(parsed.content, url) : '',
		contentHtml: parsed.content,
		url,
		fullHtml: doc.documentElement.outerHTML,
		description: parsed.description,
		favicon: parsed.favicon,
		image: parsed.image,
		published: parsed.published,
		site: parsed.site,
		language: parsed.language,
		wordCount: parsed.wordCount,
		schemaOrgData: parsed.schemaOrgData,
		metaTags: parsed.metaTags,
		extractedContent: parsed.variables,
	} as any);

	// A property is one line. Web Clipper's popup fields are single-line inputs, which drop
	// line breaks and glue the words together ("Build\nMachine" -> "BuildMachine"); a
	// space keeps them apart, and keeps a raw newline out of the YAML.
	const oneLine = (text: string) => text.replace(/[^\S\r\n]*[\r\n]+[^\S\r\n]*/g, ' ');
	const compile = (text: string) =>
		compileTemplate(0, text || '', variables, url, createAsyncResolver(doc), createSelectorProcessor(doc));

	const noteName = sanitizeFileName(await compile(template.noteNameFormat || '{{title}}')) || 'Untitled';
	const properties = [];
	const typeMap: Record<string, string> = {};
	for (const prop of template.properties || []) {
		const type = prop.type || 'text';
		typeMap[prop.name] = type;
		properties.push({ name: prop.name, value: formatPropertyValue(oneLine(await compile(prop.value)), type, prop.value), type });
	}
	const frontmatter = generateFrontmatter(properties as any, typeMap);
	const content = await compile(template.noteContentFormat);
	const path = (await compile(template.path || '')).trim();
	return { noteName, path, fullContent: frontmatter ? frontmatter + content : content };
}

(globalThis as any).SelectiophileClipper = { clipDocument, mathmlToLatex: (mathml: string) => MathMLToLaTeX.convert(mathml) };
