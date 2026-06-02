import type { SourceItem } from "./types";

const NONSENSE_HOURS = new Set([0, 8, 16]);

interface NonsenseObject {
  subject: string;
}

interface NonsenseState {
  title: string;
  summary: string;
}

interface NonsenseSeed {
  title: string;
  summary: string;
}

const LOCATIONS = [
  "사무실 구석에서",
  "복도 끝 정수기 옆에서",
  "회의실 문 안쪽에서",
  "탕비실 서랍 앞에서",
  "엘리베이터 버튼 아래에서",
  "창가 블라인드 근처에서",
  "복사기 오른쪽 모서리에서",
  "출입문 손잡이 아래에서",
  "책상 왼쪽 끝에서",
  "우산꽂이 뒤편에서",
  "프린터 용지함 옆에서",
  "냉장고 자석 아래에서",
  "화이트보드 받침대 위에서",
  "콘센트와 멀티탭 사이에서",
  "공용 서랍 두 번째 칸에서",
  "비상구 안내등 아래에서",
  "화분 받침 근처에서",
  "회의 예약표 옆에서",
  "분리수거함 뚜껑 위에서",
  "창틀 안쪽 먼지 옆에서",
  "키보드 받침대 뒤에서",
  "복도 의자 아래에서",
  "문서 파쇄기 옆 바닥에서",
  "탕비실 전자레인지 앞에서"
] as const;

const OBJECTS: NonsenseObject[] = [
  { subject: "클립 세 개가" },
  { subject: "종이컵 하나가" },
  { subject: "회의실 의자 하나가" },
  { subject: "안내문 한 장이" },
  { subject: "나무젓가락 봉지가" },
  { subject: "블라인드 한 칸이" },
  { subject: "스테이플러가" },
  { subject: "출입문 손잡이가" },
  { subject: "포스트잇 한 장이" },
  { subject: "마른 보드마카가" },
  { subject: "투명 파일철이" },
  { subject: "빈 택배 상자가" },
  { subject: "고무줄 하나가" },
  { subject: "충전 케이블 끝이" },
  { subject: "키보드 키캡 하나가" },
  { subject: "모니터 받침대가" },
  { subject: "우산 손잡이가" },
  { subject: "명함 한 장이" },
  { subject: "분실물 스티커가" },
  { subject: "서랍 라벨이" },
  { subject: "볼펜 뚜껑이" },
  { subject: "빈 물티슈 캡이" },
  { subject: "종이봉투 손잡이가" },
  { subject: "책상 다리 하나가" },
  { subject: "프린터 경고등이" },
  { subject: "카드키 목걸이가" },
  { subject: "미사용 봉투가" },
  { subject: "달력의 빈 칸이" },
  { subject: "커피 얼룩 가장자리가" },
  { subject: "테이프 끝부분이" },
  { subject: "서류철 고리가" },
  { subject: "책갈피 끈이" }
];

const STATES: NonsenseState[] = [
  { title: "방향 수정을 끝내 보류했다", summary: "방향을 바꾸지 않았고, 방향을 바꿀 만한 사정도 확인되지 않았다" },
  { title: "사용 가능성을 과도하게 남겼다", summary: "사용되지 않은 채 사용될 수도 있다는 가능성만 낮게 유지했다" },
  { title: "책상 아래로 충분히 들어가지 않은 상태를 유지했다", summary: "조금 덜 들어간 위치에서 별다른 조정을 받지 않았다" },
  { title: "아무도 묻지 않은 쪽을 조용히 가리켰다", summary: "질문을 받지 않았으나 방향성 비슷한 것을 보존했다" },
  { title: "뜯기지 않은 채 주변과 거리를 뒀다", summary: "열리지 않았고, 열리지 않은 사실은 현장에 그대로 남았다" },
  { title: "나머지보다 조금 더 기울어진 상태로 오후를 넘겼다", summary: "미세한 각도 차이를 보였으나 그 차이는 별도 조치를 부르지 않았다" },
  { title: "자기 업무 범위를 넘지 않는 침묵을 이어갔다", summary: "눌리거나 사용되지 않았고, 침묵은 비교적 안정적으로 지속됐다" },
  { title: "오전과 오후 사이 별다른 입장을 내지 않았다", summary: "계속 같은 물체였고, 그 사실에 추가 설명은 붙지 않았다" },
  { title: "적히지 않은 내용을 끝까지 공개하지 않았다", summary: "비어 있었고, 비어 있다는 사실 외에는 확인 가능한 내용이 없었다" },
  { title: "반쯤 밀린 듯한 인상을 남겼다", summary: "이동의 결과인지 원래 위치였는지 확인되지 않았다" },
  { title: "열릴 수 있었으나 열리지 않았다", summary: "개봉 가능성을 지닌 채 실제 개봉으로 나아가지 않았다" },
  { title: "주변 사물과 낮은 수준의 거리감을 유지했다", summary: "접촉하지도 완전히 떨어지지도 않은 상태로 관측됐다" },
  { title: "기능을 수행하지 않는 방식으로 기능을 암시했다", summary: "할 수 있는 일은 있었으나 실제로 한 일은 없었다" },
  { title: "옆으로 조금 돌아간 채 해석을 피했다", summary: "약간 돌아간 듯 보였지만 그 정도는 아무것도 결정하지 않았다" },
  { title: "마감과 무관한 표정으로 남았다", summary: "어떤 일정과도 직접 연결되지 않은 채 자리를 지켰다" },
  { title: "가까운 사물에게 특별한 신호를 보내지 않았다", summary: "주변 물체와 함께 있었으나 별도의 상호작용은 없었다" },
  { title: "확인되지 않은 필요성을 오래 보관했다", summary: "필요했는지 아닌지 알 수 없는 상태가 오후까지 이어졌다" },
  { title: "눈에 띄지 않는 쪽으로 성실하게 놓여 있었다", summary: "존재는 확인됐지만 존재 이상의 정보는 제공하지 않았다" },
  { title: "미세하게 어긋난 채 바로잡히지 않았다", summary: "정렬되지 않았으나 정렬의 필요성도 충분하지 않았다" },
  { title: "아무 일도 하지 않는 역할을 비교적 충실히 수행했다", summary: "움직임 없이 현장에 남아 무관함을 유지했다" }
];

const NEARBY_OBJECTS = [
  "흰 종이 한 장이",
  "닫힌 노트북이",
  "반쯤 찬 물컵이",
  "꺼진 모니터가",
  "접힌 휴지가",
  "비어 있는 의자가",
  "전원이 꺼진 멀티탭이",
  "날짜가 지난 메모가",
  "열리지 않은 서랍이",
  "뚜껑 닫힌 텀블러가",
  "잠긴 캐비닛이",
  "흐린 유리창이",
  "구겨지지 않은 봉투가",
  "작게 접힌 영수증이",
  "이름 없는 파일철이",
  "덮인 회의록이",
  "마르지 않은 듯한 얼룩이",
  "사용되지 않은 충전기가",
  "비어 있는 받침대가",
  "아무 숫자도 바꾸지 않은 달력이"
] as const;

const OBSERVATIONS = [
  "누구도 그 배치를 설명하지 않았다",
  "별도 회의는 열리지 않았다",
  "현장에 있던 사람들은 대체로 다른 일을 했다",
  "이 사안은 어떤 일정에도 편입되지 않았다",
  "관련 입장은 끝내 마련되지 않았다",
  "추가 확인을 해도 크게 달라질 내용은 없어 보였다",
  "주변 공기는 특별한 해석을 내놓지 않았다",
  "기록할 만한 변화는 기록되지 않았다",
  "원인과 결과가 서로를 찾지 않았다",
  "이 배열은 누구의 결재도 기다리지 않는 듯했다",
  "필요한 설명보다 남은 침묵이 더 많았다",
  "현장성은 있었으나 사건성은 도착하지 않았다",
  "어떤 부서도 이를 자기 업무로 가져가지 않았다",
  "의미는 가까이 오지 않고 복도 쪽에 머물렀다",
  "확인 가능한 파장은 바닥 가까이에 머물렀다",
  "해당 상태는 매우 낮은 목소리로 계속됐다",
  "아무도 서두르지 않아도 되는 종류의 장면이었다",
  "맥락은 현장에 출근하지 않은 것으로 보인다",
  "기사는 이 빈자리를 조심스럽게 받아 적었다",
  "별다른 결론은 끝까지 결론답게 행동하지 않았다"
] as const;

const NONSENSE_NOTES = [
  "이 소재는 실제 외부 뉴스가 아니라 헛소리 카테고리를 위해 만든 반뉴스 슬롯이다.",
  "기술, 비즈니스, 시장 정보로 독자를 유익하게 만들지 말고, 맥락이 회수되지 않는 진지한 신문 기사처럼 처리한다.",
  "기사 형식은 유지하되 독자가 얻을 실용 정보는 남기지 않는다."
] as const;

export function scheduledNonsenseCandidate(now: Date, timeZone: string): SourceItem | null {
  const slot = zonedSlot(now, timeZone);
  if (!NONSENSE_HOURS.has(slot.hour)) {
    return null;
  }

  const seed = nonsenseSeedForSlot(slot.day, slot.hour);
  const slotId = `${slot.day}-${String(slot.hour).padStart(2, "0")}`;
  const url = `https://news.ploradian.com/nonsense/${slotId}/`;

  return {
    feedName: "The Ploradian 헛소리 데스크",
    feedUrl: "https://news.ploradian.com/archive/?category=%ED%97%9B%EC%86%8C%EB%A6%AC",
    category: "헛소리",
    title: seed.title,
    url,
    canonicalUrl: url,
    summary: [seed.summary, ...NONSENSE_NOTES].join(" "),
    publishedAt: `${slot.day}T${String(slot.hour).padStart(2, "0")}:00:00${slot.offset}`,
    synthetic: true
  };
}

function nonsenseSeedForSlot(day: string, hour: number): NonsenseSeed {
  const random = mulberry32(hashString(`${day}-${hour}-ploradian-nonsense`));
  const location = pick(LOCATIONS, random);
  const object = pick(OBJECTS, random);
  const state = pick(STATES, random);
  const nearby = pick(NEARBY_OBJECTS, random);
  const observation = pick(OBSERVATIONS, random);

  return {
    title: `${location} ${object.subject} ${state.title}`,
    summary: [
      `${object.subject} ${state.summary}.`,
      `현장에는 ${nearby} 있었고, ${observation}.`,
      "누구에게 중요한지는 확인되지 않았으며, 확인되지 않은 상태가 이 소재의 대부분이다."
    ].join(" ")
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  if (items.length === 0) {
    throw new Error("nonsense pool must not be empty");
  }
  return items[Math.floor(random() * items.length)] as T;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
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
