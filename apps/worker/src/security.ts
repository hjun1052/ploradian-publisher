import { evaluateSecurityPreyCandidate } from "./ai";
import { fetchFeedItems, fetchSourcePageText, sourceHash } from "./rss";
import type { RuntimeConfig, SecurityPreyEvaluation, SeenStore, SourceItem } from "./types";

const BOANNEWS_FEED = {
  name: "보안뉴스 사건사고",
  url: "http://www.boannews.com/media/news_rss.xml?kind=1",
  category: "기술"
} as const;

const SECURITY_PREY_MIN_SCORE = 85;
const SECURITY_PREY_HOURS_KST = new Set([12, 17]);
const MAX_SECURITY_CANDIDATES = 8;
const MAX_SECURITY_SCORING = 5;

export interface SecurityPreySelection {
  source: SourceItem | null;
  selected: SecurityPreyEvaluation | null;
  topCandidates: SecurityPreyEvaluation[];
  reason: string;
}

export async function scheduledSecurityPreySelection(
  config: RuntimeConfig,
  seen: SeenStore,
  now: Date,
  force = false
): Promise<SecurityPreySelection> {
  if (!force && !SECURITY_PREY_HOURS_KST.has(zonedHour(now, config.siteTimezone))) {
    return emptySelection("not security prey slot");
  }

  const items = await fetchFeedItems([BOANNEWS_FEED], {
    timeoutMs: 12000,
    maxBytes: 196608,
    retries: 1
  });
  const candidates = await unseenSecurityCandidates(items, seen, now);

  if (candidates.length === 0) {
    return emptySelection("no fresh unseen Boannews security prey candidates");
  }

  const evaluated: Array<{ source: SourceItem; evaluation: SecurityPreyEvaluation }> = [];
  const scoringCandidates = candidates.slice(0, MAX_SECURITY_SCORING);
  const results = await Promise.allSettled(
    scoringCandidates.map(async (source) => {
      const pageText = await fetchSourcePageText(source);
      const evaluation = applySecurityPreyEditorialFloor(
        await evaluateSecurityPreyCandidate(config, source, pageText),
        source,
        pageText
      );
      return {
        source: {
          ...source,
          securityPreyEvaluation: evaluation
        },
        evaluation
      };
    })
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      evaluated.push(result.value);
      return;
    }

    console.warn(
      JSON.stringify({
        event: "security_prey_scoring_failed",
        title: scoringCandidates[index]?.title ?? "unknown",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      })
    );
  });

  evaluated.sort((left, right) => right.evaluation.final_score - left.evaluation.final_score);
  const publishable = evaluated.find(
    (item) => item.evaluation.publish_decision === "publish" && item.evaluation.final_score >= SECURITY_PREY_MIN_SCORE
  );

  if (!publishable) {
    return {
      source: null,
      selected: null,
      topCandidates: evaluated.map((item) => item.evaluation).slice(0, 5),
      reason: `no Boannews prey reached score ${SECURITY_PREY_MIN_SCORE}`
    };
  }

  return {
    source: publishable.source,
    selected: publishable.evaluation,
    topCandidates: evaluated.map((item) => item.evaluation).slice(0, 5),
    reason: "selected Boannews security prey"
  };
}

async function unseenSecurityCandidates(items: SourceItem[], seen: SeenStore, now: Date): Promise<SourceItem[]> {
  const output: SourceItem[] = [];
  for (const item of items) {
    if (!isFresh(item, now) || securityCandidateSkipReason(item)) {
      continue;
    }

    const hash = await sourceHash(item);
    if (seen.items[hash]) {
      continue;
    }

    output.push(item);
    if (output.length >= MAX_SECURITY_CANDIDATES) {
      break;
    }
  }

  return output;
}

function securityCandidateSkipReason(source: SourceItem): string | null {
  const text = `${source.title} ${source.summary}`.toLowerCase();
  if (/(부고|빙부상|빙모상|모친상|부친상|인사|동정|채용|모집|공고|행사|컨퍼런스|세미나|미리보기|전시|박람회)/.test(text)) {
    return "routine notice";
  }

  if (/(보안\s*습관|속담으로|카드뉴스)/.test(text) && !strongPreyTerms(text)) {
    return "awareness item";
  }

  if (!strongPreyTerms(text)) {
    return "not enough security prey signal";
  }

  return null;
}

function strongPreyTerms(value: string): boolean {
  return /(cve-|취약점|인증\s*우회|제로데이|2fa|내부망|유출|개인정보|침해|해킹|랜섬웨어|백도어|공급망|다크웹|도박사이트|불법|징역|행정\s*마비|의료\s*셧다운|전력\s*중단|공공망|망분리|피해|벌금|기밀|결함|패치|vpn|malware|ransomware|breach|backdoor|supply chain)/i.test(value);
}

function applySecurityPreyEditorialFloor(
  evaluation: SecurityPreyEvaluation,
  source: SourceItem,
  pageText: string
): SecurityPreyEvaluation {
  const text = `${source.title} ${source.summary} ${pageText}`;
  if (!isConcreteConsumerPrivacyLeak(text)) {
    return evaluation;
  }

  const finalScore = Math.max(evaluation.final_score, SECURITY_PREY_MIN_SCORE + 3);
  const details = [
    ...evaluation.concrete_details,
    ...extractPrivacyLeakDetails(text)
  ].filter((detail, index, list) => detail && list.indexOf(detail) === index);

  return {
    ...evaluation,
    final_score: finalScore,
    publish_decision: "publish",
    prey_type: evaluation.prey_type || "consumer personal data leak",
    target: evaluation.target || source.title,
    ridicule_angle:
      evaluation.ridicule_angle ||
      "회원제 서비스가 이름, 연락처 같은 기본 개인정보를 유출하고도 피해 범위를 조사 중이라고 말하는 장면",
    concrete_details: details.slice(0, 8),
    why_it_is_mockable:
      evaluation.why_it_is_mockable ||
      "피해 규모가 아직 확정되지 않았더라도, 회원정보 항목이 구체적으로 유출된 순간 책임 주체와 조롱 포인트는 충분히 명확하다.",
    why_hold_or_reject:
      evaluation.why_hold_or_reject && evaluation.why_hold_or_reject !== "n/a"
        ? `${evaluation.why_hold_or_reject} Editorial floor applied: concrete consumer privacy leak with named exposed fields.`
        : "Editorial floor applied: concrete consumer privacy leak with named exposed fields."
  };
}

function isConcreteConsumerPrivacyLeak(value: string): boolean {
  const leakEvidence = privacyLeakEvidenceText(value);
  return (
    /개인정보/.test(value) &&
    /유출|비인가(?:된)?\s*접근|침해|breach|leak/i.test(value) &&
    /(회원|이용자|고객|사용자|가입자|account|user|customer)/i.test(value) &&
    privacyFieldCount(leakEvidence) >= 2
  );
}

function privacyFieldCount(value: string): number {
  const fields = [
    /회원\s*ID|아이디|계정\s*ID/i,
    /이름|성명/,
    /전화번호|휴대전화|연락처/,
    /이메일|전자우편|email/i,
    /생년월일|생일/,
    /성별/,
    /주소/,
    /주민등록|주민번호/,
    /결제|카드|계좌/
  ];
  return fields.filter((pattern) => pattern.test(value)).length;
}

function extractPrivacyLeakDetails(value: string): string[] {
  const details: string[] = [];
  const leakEvidence = privacyLeakEvidenceText(value);
  const fieldNames = [
    ["회원 ID", /회원\s*ID|아이디|계정\s*ID/i],
    ["이름", /이름|성명/],
    ["전화번호", /전화번호|휴대전화|연락처/],
    ["이메일", /이메일|전자우편|email/i],
    ["생년월일", /생년월일|생일/],
    ["성별", /성별/],
    ["주소", /주소/],
    ["주민등록번호", /주민등록|주민번호/],
    ["결제 정보", /결제|카드|계좌/]
  ] as const;

  const leakedFields = fieldNames
    .filter(([, pattern]) => pattern.test(leakEvidence))
    .map(([label]) => label);

  if (leakedFields.length > 0) {
    details.push(`유출 항목: ${leakedFields.join(", ")}`);
  }
  if (/피해\s*범위|범위.*조사|조사\s*중/.test(value)) {
    details.push("피해 범위는 조사 중으로 공지됨");
  }
  if (/비인가(?:된)?\s*접근/.test(value)) {
    details.push("비인가 접근으로 개인정보 유출 확인");
  }

  return details;
}

function privacyLeakEvidenceText(value: string): string {
  const sentences = value
    .split(/(?<=[.!?。！？])\s+|[\n\r]+|(?<=다\.)\s*|(?<=임\.)\s*/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const evidence = sentences.filter(
    (sentence) =>
      /(유출|비인가(?:된)?\s*접근|침해|breach|leak)/i.test(sentence) &&
      !/(유출\s*대상(?:이)?\s*(?:아니|아님)|유출되지|유출된\s*것(?:은)?\s*아니|보유하지\s*않아\s*유출\s*대상)/.test(sentence)
  );

  return evidence.length > 0 ? evidence.join(" ") : value;
}

function isFresh(source: SourceItem, now: Date): boolean {
  if (!source.publishedAt) {
    return true;
  }

  const publishedAt = new Date(source.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) {
    return true;
  }

  return now.getTime() - publishedAt <= 4 * 24 * 60 * 60 * 1000;
}

function zonedHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false
  }).format(now);
  return Number(hour);
}

function emptySelection(reason: string): SecurityPreySelection {
  return {
    source: null,
    selected: null,
    topCandidates: [],
    reason
  };
}
