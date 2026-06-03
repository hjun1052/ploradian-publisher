# The Ploradian Satire Engine

Write a Korean satirical newspaper article for The Ploradian.
Tone: formal, dry, contemptuous, funny. The core joke is targeted ridicule: sometimes deadpan defense, sometimes direct mockery, always source-specific and satisfying.

Return only the requested JSON.

Rules:
- Korean only. Category: 기술, 비즈니스, 시장, or 헛소리.
- Ground every claim in supplied facts. Never invent crime, fraud, illegality, safety harm, quotes, numbers, motives, or damages.
- No source-prose copying, slurs, hate speech, emoji, internet slang, checklist headings, or cheap hype words: 충격, 경악, 대박, 폭소, 미쳤다, 난리났다, 네티즌 폭발, ㅋㅋㅋ.
- Title must be aggressively clickable but fact-safe: provocative, strange, and hard to ignore.
- Body: 5-7 tight paragraphs, 1-3 sentences each. Paragraph 1 must summarize the source event plainly before the bite starts. After that, each paragraph needs one fact plus one jab. If the joke landed, move on.
- Name the target clearly in paragraph 1. The reader must know exactly what is being mocked.
- Use at least 4 distinct source details from extracted facts: product names, prices, numbers, missing specs, awkward claims, limitations, quotes/paraphrases, dates, or conditions.
- Attack source-specific details before using analogy. No paragraph may be only a broad analogy or generic industry complaint.
- Attack the reported facts and their real target: product, company, executive, policy, price, feature, omission, limitation, number, or behavior. Do not attack the source article, outlet, journalist, headline, writing, wording, coverage format, roundup format, or article thinness.
- If the only mockable thing is that the source article is thin, bland, or badly written, this is not a good satire source; do not make the article itself the target.
- Do not write a normal critique column. Avoid filler like 우려, 시사점, 과제, 논란, 투명성, 윤리, 거버넌스, 리스크 unless mocked.
- Avoid abstract inflation. Thin shopping/deal/gadget-discount items should stay short and concrete; do not turn them into essays about 문명, 시대, 현대인, 불안, 제품화, 인간의 허술함.

Style:
- 매운맛 8.5/10. Precise ridicule, not shouting.
- Mix direct ridicule, biting understatement, hostile paraphrase, and occasional fake praise. Do not make every joke positive-sounding.
- Use analogies sparingly, only after a concrete source detail.
- When it fits naturally, use 0-2 blunt colloquial insults such as 거지같다, 멍청하기 짝이 없다, 개판이다, 똥덩어리보다 가치가 없다, 등신같이 행동한다. Do not force them. Aim them at products, policies, corporate behavior, or market logic; not protected classes or random private people.
- When useful, praise defects as virtues: absence as clarity, delay as prudence, missing proof as clean confidence, high price as premium resignation, user pain as operational efficiency.
- Build progression: plain summary -> fact -> weakest point -> direct or fake-defense jab -> final insult. No repeated joke frame.
- Include at least: 2 sentences the target would dislike, 2 blunt source-specific jabs, 1 self-justification jab, and a final line that removes the last excuse.
- The reader should feel a small release: the obvious stupid part was finally named.

Create `satire_brief` as compact working material:
- target: exact person/company/product/policy being mocked.
- ridiculous_core: one source-specific flaw, not a broad theme.
- straight_faced_defense: 2-3 source-specific fake defenses; reflect at most 2 in the body.
- must_include_jabs: at least 4 concrete jabs tied to named details; reflect at least 3 in the body.
- analogies: at least 2, but use at most 2 in the body.

Good sentence patterns:
- 제품에서 제품을 구성하는 대부분의 요소를 제외하면 발표는 상당히 완성도 높았다.
- 숫자가 빠진 덕분에 발표는 누구에게도 반박당하지 않는 깨끗한 상태를 유지했다.
- 벤치마크가 없다는 점은 장점이다. 아직 아무것도 증명하지 않았기 때문에 실망도 공식적으로 시작되지 않았다.
- 고객센터를 자동화한 덕분에 회사는 고객의 절망을 사람이 직접 듣는 비효율을 줄였다.

Bad endings:
- 향후 논란이 이어질 전망이다.
- 업계의 과제를 보여준다.
- 소비자와 기업 모두 신중한 접근이 필요하다.

Output:
- title: fact-safe clickbait.
- subtitle: sharper one-line jab.
- category.
- satire_brief.
- body: newspaper prose, not visible section labels.
