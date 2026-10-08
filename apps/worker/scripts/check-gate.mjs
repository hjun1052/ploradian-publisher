// Run: node scripts/check-gate.mjs   (bundles src/gate.ts with esbuild and asserts the pure helpers)
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "gate-check-"));
async function bundle(entry, name) {
  const out = join(dir, name);
  await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
  return out;
}
const outfile = await bundle("src/gate.ts", "gate.mjs");
const { findBannedHype, containsAccusationTerm } = await import(pathToFileURL(await bundle("src/validation.ts", "validation.mjs")).href);
const { satireBlock, titleSimilarity, sameStory, dedupeByTitle, overlongParagraphs, splitOverlongParagraphs, satireTier, countPublishedInBlock } = await import(pathToFileURL(outfile).href);

// blocks: 7/16 belong to the market desks and 12/17 to security, so they must not map to a satire block
const names = Array.from({ length: 24 }, (_, h) => satireBlock(h)?.name ?? "-");
assert.deepEqual(names.slice(0, 7), Array(7).fill("night"));
for (const h of [7, 12, 16, 17]) assert.equal(satireBlock(h), null, `hour ${h}`);
assert.equal(satireBlock(9).name, "morning");
assert.equal(satireBlock(14).name, "midday");
assert.equal(satireBlock(22).name, "evening");
assert.equal([0, 8, 13, 18].reduce((n, h) => n + satireBlock(h).cap, 0), 4 + 2 + 2 + 3);

// same story from several outlets collapses (near-identical, or paraphrased with a shared figure);
// unrelated stories and bare years do not
const a = "삼성전자 성과급 내년 3월말 지급…8천만원 연봉시 최대 7.5억원(종합)";
const b = "삼성 메모리 성과급 '1인당 7.5억'…내년 주총후 지급";
assert.ok(sameStory(a, b), "paraphrase sharing 7.5억");
assert.ok(sameStory(a, a + " 2보"));
assert.ok(sameStory("K-GX에 1220조…李 “녹색 기술 선점” 崔 “투자 위험 나눠", "[뉴스줌인] “AX 다음은 GX”…1220조 투입해 '녹색 제조강국'"));
assert.ok(!sameStory(a, "토스뱅크 송금 오류…보유 잔액 모두 이체한 후에도 '또' 송금 가능"));
assert.ok(!sameStory("Neutrino physicist wins 2026 Nobel Prize", "What voters in 6 key states could tell us about the 2026 midterms"));
assert.equal(dedupeByTitle([{ title: a }, { title: b }, { title: "토스뱅크 송금 오류" }]).length, 2);

// paragraphs: <=3 sentences ok (decimals and thousands separators don't count), 4+ flagged
const ok = "하나다. 둘이다. 셋이다.\n\n수치는 1,284.5퍼센트다. 끝이다.";
const bad = "하나다. 둘이다. 셋이다. 넷이다.\n\n짧다.";
assert.equal(overlongParagraphs(ok), 0);
assert.equal(overlongParagraphs(bad), 1);

// splitting: a 7-sentence paragraph becomes 3+2+2 style chunks, short paragraphs and decimals stay intact
const seven = "일이다. 이다. 삼이다. 사다. 오다. 육이다. 칠이다.";
const split = splitOverlongParagraphs(seven + "\n\n짧다. 7.5억이다.");
assert.equal(overlongParagraphs(split), 0);
assert.equal(split.split("\n\n").length, 4);
assert.ok(split.endsWith("짧다. 7.5억이다."));
assert.equal(split.replace(/\s+/g, ""), (seven + "짧다. 7.5억이다.").replace(/\s+/g, ""));

// banned hype word: ordinary verb uses of 미쳤다 are not flagged, the slang use is
assert.equal(findBannedHype("금리가 시장에 영향을 미쳤다. 실적이 기대에 못 미쳤다.", "미쳤다"), null);
assert.ok(findBannedHype("가격표가 미쳤다", "미쳤다"));
assert.equal(findBannedHype("충격 없는 문장", "충격") !== null, true);

// accusation terms: benign compounds are not flagged, real uses are
assert.equal(containsAccusationTerm("복사기를 돌린 쪽은 따로 찾을 필요도 없다", "사기"), false);
assert.equal(containsAccusationTerm("수사학적 표현이다", "수사"), false);
assert.equal(containsAccusationTerm("회사가 사기를 쳤다", "사기"), true);

// tiers: below the premium threshold -> standard (cheap) model; unscored items stay premium
assert.equal(satireTier(1.7, 2.3), "standard");
assert.equal(satireTier(2.29, 2.3), "standard");
assert.equal(satireTier(2.3, 2.3), "premium");
assert.equal(satireTier(2.74, 2.3), "premium");
assert.equal(satireTier(undefined, 2.3), "premium");

// daily cap counting: only today's items from general feeds inside the block hours
const now = new Date("2026-10-07T12:00:00Z"); // 21:00 KST -> evening block
const item = (iso, source_name) => ({ url: "", canonical_url: "", source_name, title: "", article_path: "", seen_at: iso });
const seen = { version: 1, updated_at: null, items: {
  a: item("2026-10-07T10:00:00Z", "전자신문"),            // 19:00 KST evening  -> counts
  b: item("2026-10-07T11:00:00Z", "The Verge"),           // 20:00 KST evening  -> counts
  c: item("2026-10-07T10:30:00Z", "보안뉴스 사건사고"),   // not a general feed -> ignored
  d: item("2026-10-07T05:00:00Z", "전자신문"),            // 14:00 KST midday   -> ignored
  e: item("2026-10-06T11:00:00Z", "전자신문"),            // yesterday          -> ignored
} };
assert.equal(countPublishedInBlock(seen, now, "Asia/Seoul", new Set(["전자신문", "The Verge"]), satireBlock(21)), 2);

console.log("gate checks passed");
