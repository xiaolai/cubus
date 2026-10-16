// Regenerate `beginner-lesson.json`. See `beginner-lesson.mjs` for what it pins and when regenerating is
// allowed (only to record a deliberate change to what the beginner is taught, said in the commit).
//
//   node test/fixtures/regen-beginner-lesson.mjs

import { writeFileSync } from 'node:fs';

import { COMMENT, baselineCubes, bootLesson, lessonRecord } from './beginner-lesson.mjs';

const { lessonFor, whyText, win } = await bootLesson();
const cases = baselineCubes().map((facelets) => {
  const lesson = lessonFor({ facelets, lesson: null });
  if (!lesson) throw new Error(`no beginner lesson for ${facelets}`);
  return { facelets, lesson: lessonRecord(lesson, whyText) };
});
const out = new URL('./beginner-lesson.json', import.meta.url);
const json = `${JSON.stringify({ _comment: COMMENT, cases })}\n`;
writeFileSync(out, json);
console.log(`wrote ${out.pathname} — ${cases.length} cases, ${json.length} bytes`);
await win.happyDOM.abort();
process.exit(0);
