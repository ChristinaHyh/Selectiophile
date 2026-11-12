// Builds Jev requests and turns answers into decisions. Jev only picks among
// options we supply; it never produces note text.
import { normalizeHeading } from './note.js';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';

// The default, which settings can change. Conservative until real highlights can
// calibrate it: 24 synthetic samples had no wrong answers, and this auto-saved 96%.
export const AUTO_SAVE_PROBABILITY = 0.9;
export const MIN_AUTO_SAVE_PERCENT = 50;

export const BLOCK_CRITERIA = {
  'Research Question': 'The question, hypothesis, aim or motivation the paper sets out to address.',
  'Main Findings': 'A result, measurement or conclusion the paper reports.',
  Novelty: 'What is new about this paper compared with prior work: a new method, dataset or contribution.',
  'Limitations of Experimental Design': 'A weakness in how the study was run: sample size, controls, confounds, bias, or setup that limits it.',
  'Insufficient Evidence or Alternative Explanations': 'A conclusion the evidence does not fully support, or another explanation that could account for the result.',
  'Ideas for My Research': "The reader sees something to apply, borrow or adapt in the reader's own work.",
  'Potential Follow-up Experiments': 'A concrete next experiment or study that could extend or test this work.',
  'Key Ideas': 'A main argument, claim or insight of the article.',
  'Useful Details': 'A fact, example, number, quote or resource worth keeping.',
  'My Thoughts': 'The reader\'s own reaction, disagreement, question or idea prompted by the article.',
  Others: 'Useful material that fits none of the other sections: background, definitions, references, tools, data availability.',
};

const descriptions = new Map(Object.entries(BLOCK_CRITERIA).map(([k, v]) => [normalizeHeading(k), v]));

// A heading the user added has no description; Jev then judges it by name alone.
const criteriaFor = (headings) =>
  Object.fromEntries(headings.map((h) => [h, descriptions.get(normalizeHeading(h)) ?? null]));

const BLOCK_INSTRUCTIONS = 'Choose the section of a reading note where this highlighted passage belongs. '
  + 'The reader_comment, when present, shows why the reader highlighted it and outweighs the topic of the passage. '
  + 'The highlight_purpose, when present, is the label the reader gave this highlight color. '
  + 'The comment may be written in Chinese.';

export function buildBlockRequest({ sourceTitle, quote, comment, paragraph, pageSection, discussion, purpose }, headings = Object.keys(BLOCK_CRITERIA), model = JEV_MODEL) {
  const state = { source_title: sourceTitle || '', highlighted_passage: quote };
  if (comment?.trim()) state.reader_comment = comment.trim();
  if (purpose) state.highlight_purpose = purpose;
  if (paragraph && paragraph !== quote) state.surrounding_paragraph = paragraph.slice(0, 1500);
  if (pageSection && !discussion) state.page_section = pageSection;
  if (discussion) state.source = 'A conversation with an AI assistant about this work, not the work itself.';
  return {
    model,
    state,
    questions: { block: { type: 'choice', instructions: BLOCK_INSTRUCTIONS, criteria: criteriaFor(headings) } },
  };
}

// Used only when the page has no identifier. Jev's docs discourage a "none of the
// above" option, so a separate yes/no question decides whether any note applies. A
// note may be on a paper or an article, and a page may be either, or about one.
export function buildNoteRequest({ pageTitle, url, quote, comment, conversation }, candidates, model = JEV_MODEL) {
  const state = { page_title: pageTitle || '', page_url: url, highlighted_passage: quote };
  if (comment?.trim()) state.reader_comment = comment.trim();
  if (conversation) {
    state.conversation_opening = conversation;
    state.source = 'The opening of a conversation with an AI assistant, which may discuss these works.';
  }
  const criteria = Object.fromEntries(candidates.map((c) => [c.name, c.description || null]));
  return {
    model,
    state,
    questions: {
      note: {
        type: 'choice',
        instructions: 'Which of these notes is about the same work as this web page, or the work it discusses?',
        criteria,
      },
      belongs: {
        type: 'noul',
        instructions: `Is this web page the same work as, or directly discussing, the subject of one of these notes: ${candidates.map((c) => c.name).join('; ')}? A page merely on a similar topic does not count.`,
      },
    },
  };
}

// For a conversation linked to several notes: every heading of every note is an option.
export function buildCrossNoteRequest({ quote, comment, paragraph, purpose }, options, model = JEV_MODEL) {
  const state = { highlighted_passage: quote };
  if (comment?.trim()) state.reader_comment = comment.trim();
  if (purpose) state.highlight_purpose = purpose;
  if (paragraph && paragraph !== quote) state.surrounding_paragraph = paragraph.slice(0, 1500);
  state.source = 'A conversation with an AI assistant about these works.';
  const criteria = Object.fromEntries(options.map((o) => [
    o.key,
    `In the note on "${o.title}". ${descriptions.get(normalizeHeading(o.heading)) ?? ''}`.trim(),
  ]));
  return {
    model,
    state,
    questions: {
      block: {
        type: 'choice',
        instructions: 'Choose which work this passage belongs to, and which section of its reading note. The reader_comment, when present, outweighs the topic of the passage.',
        criteria,
      },
    },
  };
}

export function rankAnswer(answer) {
  return Object.entries(answer.probabilities)
    .map(([option, p]) => ({ option, p }))
    .sort((a, b) => b.p - a.p);
}

export function decideBlock(answer, threshold = AUTO_SAVE_PROBABILITY) {
  const ranked = rankAnswer(answer);
  return { auto: ranked[0].p >= threshold, block: ranked[0].option, top: ranked[0].p, ranked };
}

export function decideNote(answers, threshold = AUTO_SAVE_PROBABILITY) {
  const ranked = rankAnswer(answers.note);
  const belongs = answers.belongs.noul;
  return { auto: belongs >= threshold && ranked[0].p >= threshold, note: ranked[0].option, top: ranked[0].p, belongs, ranked };
}

export async function askJev(key, body, { signal, attempt = 0 } = {}) {
  const started = performance.now();
  const res = await fetch(JEV_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if ((res.status === 429 || res.status === 529) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return askJev(key, body, { signal, attempt: attempt + 1 });
  }
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  return { json: JSON.parse(text), ms: performance.now() - started };
}
