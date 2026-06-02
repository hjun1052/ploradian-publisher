import type { SourceItem } from "./types";

const NONSENSE_HOURS = new Set([0, 8, 16]);

interface NonsenseSeed {
  title: string;
  summary: string;
}

const SEEDS: [NonsenseSeed, ...NonsenseSeed[]] = [
  {
    title: "한 사무실 구석에서 클립 세 개가 방향을 바꾸지 않은 채 오후를 견뎠다",
    summary:
      "특별한 이해관계자는 확인되지 않았다. 현장에는 클립 세 개와 흰 종이 한 장이 있었고, 누구도 그 배열의 의미를 설명하지 않았다."
  },
  {
    title: "복도 끝 정수기 옆 종이컵 하나가 사용 가능성을 과도하게 남겼다",
    summary:
      "종이컵은 넘어지지 않았고, 물도 담기지 않았다. 관계자들은 이 상황이 어떤 일정과도 연결되지 않는다고 밝혔다."
  },
  {
    title: "회의실 의자 하나가 책상 밑으로 충분히 들어가지 않은 상태로 남았다",
    summary:
      "의자는 이동 의사를 밝히지 않았다. 책상과의 거리는 업무상 판단에 영향을 주지 않는 수준으로 관측됐다."
  },
  {
    title: "엘리베이터 앞 안내문이 오늘도 아무도 묻지 않은 방향을 가리켰다",
    summary:
      "안내문은 기존 위치를 유지했다. 이용객 일부는 안내문을 보지 않았고, 보지 않은 사실 역시 별다른 파장을 낳지 않았다."
  },
  {
    title: "탕비실 서랍 안 나무젓가락 봉지가 뜯기지 않은 채 사회적 거리를 유지했다",
    summary:
      "해당 봉지는 다른 소모품과 접촉하지 않았다. 이 사안과 관련한 공식 회의는 열리지 않았다."
  },
  {
    title: "창가 블라인드 한 칸이 나머지 칸보다 조금 더 현실을 받아들였다",
    summary:
      "빛은 들어왔으나 결정적이지 않았다. 블라인드의 미세한 각도 차이는 아직 어떤 부서에도 배정되지 않았다."
  },
  {
    title: "복사기 위 스테이플러가 자기 업무 범위를 넘지 않는 침묵을 이어갔다",
    summary:
      "스테이플러는 눌리지 않았다. 종이는 주변에 없었고, 이로 인해 어떤 생산성 지표도 변화하지 않았다."
  },
  {
    title: "출입문 손잡이가 오전과 오후 사이 별다른 입장을 내지 않았다",
    summary:
      "손잡이는 계속 손잡이였다. 통행은 가능했으나 그것이 기사화될 이유는 발견되지 않았다."
  },
  {
    title: "책상 위 포스트잇 한 장이 적히지 않은 내용을 끝까지 공개하지 않았다",
    summary:
      "포스트잇은 비어 있었다. 비어 있다는 사실 외에 확인 가능한 추가 정보는 없었다."
  }
];

export function scheduledNonsenseCandidate(now: Date, timeZone: string): SourceItem | null {
  const slot = zonedSlot(now, timeZone);
  if (!NONSENSE_HOURS.has(slot.hour)) {
    return null;
  }

  const seed = SEEDS[seedIndex(slot.day, slot.hour)] ?? SEEDS[0];
  const slotId = `${slot.day}-${String(slot.hour).padStart(2, "0")}`;
  const url = `https://news.ploradian.com/nonsense/${slotId}/`;

  return {
    feedName: "The Ploradian 헛소리 데스크",
    feedUrl: "https://news.ploradian.com/archive/?category=%ED%97%9B%EC%86%8C%EB%A6%AC",
    category: "헛소리",
    title: seed.title,
    url,
    canonicalUrl: url,
    summary: [
      seed.summary,
      "이 소재는 실제 외부 뉴스가 아니라 헛소리 카테고리를 위해 만든 반뉴스 슬롯이다.",
      "기술, 비즈니스, 시장 정보로 독자를 유익하게 만들지 말고, 맥락이 회수되지 않는 진지한 신문 기사처럼 처리한다."
    ].join(" "),
    publishedAt: `${slot.day}T${String(slot.hour).padStart(2, "0")}:00:00${slot.offset}`,
    synthetic: true
  };
}

function zonedSlot(date: Date, timeZone: string): { day: string; hour: number; offset: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  const localAsUtc = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    hour,
    Number(get("minute")),
    Number(get("second"))
  );
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetMinute = String(absolute % 60).padStart(2, "0");

  return {
    day,
    hour,
    offset: `${sign}${offsetHour}:${offsetMinute}`
  };
}

function seedIndex(day: string, hour: number): number {
  let value = hour;
  for (let index = 0; index < day.length; index += 1) {
    value = (value * 31 + day.charCodeAt(index)) >>> 0;
  }
  return value % SEEDS.length;
}
