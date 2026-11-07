/** One spelling contract for board validation and player answer matching. */
export function normalizeAnswer(value: string): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, " ")
    .replace(/^(?:a|an|the) /, "")
    .split(" ").map((word) => word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word).join(" ");
}

// These are reusable equivalents, independent of the question-specific board aliases.
const equivalentPhrases = [
  ["talk", "talking", "chat", "chatting", "chitchat", "chit chat", "converse", "conversing", "yap", "yapping", "have a conversation", "have a chat", "make conversation", "shoot the breeze"],
  ["keep talk", "talk for a while", "chat for a while", "talk a bit longer", "talk more", "long conversation"],
  ["argue", "arguing", "argument", "bicker", "bickering", "quarrel", "quarreling"],
  ["apologize", "apologise", "apologizing", "say sorry", "saying sorry", "tell them I'm sorry"],
  ["laugh", "laughing", "crack up", "cracking up"],
  ["cry", "crying", "tear up", "tearing up", "burst into tears"],
  ["dance", "dancing", "do a dance", "bust a move"],
  ["sing", "singing", "sing a song"],
  ["nap", "napping", "take a nap", "taking a nap", "take a quick nap", "doze off", "dozing off"],
  ["sleep", "sleeping", "go to sleep"],
  ["eat", "eating", "have something to eat"],
  ["drink", "drinking"],
  ["cook", "cooking", "make a meal"],
  ["run", "running"],
  ["walk", "walking"],
  ["wait", "waiting"],
  ["swear", "swearing", "curse", "cursing", "cuss", "cussing"],
  ["complain", "complaining", "grumble", "grumbling"],
  ["get lost", "getting lost", "got lost", "lose their way", "lose my way"],
  ["cheat", "cheating"],
  ["study", "studying", "hit the books"],
  ["exercise", "exercising", "work out", "working out"],
  ["ask", "asking"],
  ["buy", "buying", "bought", "purchase", "purchasing", "purchased"],
  ["order", "ordering", "ordered"],
  ["get", "getting", "got"],
  ["take", "taking"],
  ["watch", "watching"],
  ["take photo", "take a photo", "take a picture", "take a pic", "taking a photo", "taking a picture", "snap a photo", "snap a pic", "snap a picture"],
  ["close eyes", "close my eyes", "close your eyes", "close their eyes", "shut eyes", "shut my eyes", "shut your eyes", "shut their eyes"],
  ["check phone", "check my phone", "check your phone", "check their phone", "checking their phone", "look at my phone", "look at your phone", "look at their phone"],
  ["brush teeth", "brush my teeth", "brush your teeth", "brush their teeth", "brushing my teeth", "brushing their teeth"],
  ["phone", "cell phone", "cellphone", "mobile phone", "smart phone", "smartphone"],
  ["photo", "pic"],
  ["screenshot", "screen shot", "screen capture"],
  ["video call", "video chat", "face time", "facetime"],
  ["group chat", "group text", "group message thread"],
  ["direct message", "dm", "private message"],
  ["instagram", "insta", "ig"],
  ["tiktok", "tik tok"],
  ["youtube", "you tube"],
  ["snapchat", "snap chat"],
  ["wifi", "wi fi", "wireless internet"],
  ["headphones", "head phones"],
  ["earbuds", "ear buds", "in ear headphones"],
  ["toothbrush", "tooth brush"],
  ["toothpaste", "tooth paste"],
  ["bathroom", "restroom", "washroom"],
  ["toilet paper", "toilet roll"],
  ["trash", "garbage", "rubbish"],
  ["trash can", "garbage can", "rubbish bin"],
  ["backpack", "back pack", "book bag", "bookbag", "rucksack"],
  ["homework", "home work", "schoolwork", "school work"],
  ["t shirt", "tee shirt", "tshirt"],
  ["sneakers", "tennis shoes", "trainers"],
  ["sweatpants", "sweat pants", "track pants"],
  ["eyeglasses", "eye glasses", "spectacles", "prescription glasses"],
  ["car", "automobile"],
  ["gas station", "petrol station"],
  ["parking lot", "car park"],
  ["subway train", "metro train", "underground train"],
  ["traffic jam", "gridlock", "traffic backup"],
  ["line", "queue"],
  ["takeout", "takeaway", "take out food", "takeaway food", "food to go"],
  ["leftovers", "left overs", "leftover food"],
  ["fries", "french fries"],
  ["soda", "soft drink", "soda pop", "fizzy drink"],
  ["ice cream", "icecream"],
  ["hot dog", "hotdog"],
  ["popcorn", "pop corn"],
  ["food delivery", "meal delivery", "delivery food"],
  ["movie theater", "cinema", "movie theatre"],
  ["tv", "television"],
  ["video game", "videogame"],
  ["board game", "tabletop game"],
  ["basketball court", "basketball gym"],
  ["referee", "ref"],
  ["overtime", "extra time"],
  ["power outage", "blackout", "power cut"],
  ["bad weather", "rough weather", "poor weather"],
];

function removeArticles(value: string): string {
  return value.replace(/\b(?:a|an|the) (?=[a-z])/g, "");
}

const phraseMeanings = new Map<string, string>();
for (const [canonical, ...variants] of equivalentPhrases) {
  const meaning = removeArticles(normalizeAnswer(canonical));
  for (const phrase of [canonical, ...variants]) {
    phraseMeanings.set(removeArticles(normalizeAnswer(phrase)), meaning);
  }
}
const phrasePattern = new RegExp(`\\b(?:${[...phraseMeanings.keys()].sort((a, b) => b.length - a.length).join("|")})\\b`, "g");

export function answerMeaning(normalized: string): string {
  const withoutLeadIn = normalized.replace(/^(?:i (?:think|guess|d say|would say)|my guess is|maybe|probably) /, "")
    .replace(/^(?:it s|it is) /, "");
  return removeArticles(withoutLeadIn)
    .replace(phrasePattern, (phrase) => phraseMeanings.get(phrase)!)
    .replace(/^(?:picture|photograph)$/, "photo")
    .replace(/^photograph(?:ing)? (?=(?:them|her|him|it|someone|people|me|you)$)/, "take photo of ")
    .replace(/^(?:check|look at) (?:my|your|their|our) phone$/, "check phone")
    .replace(/^(?:keep(?: on)?|kept|continue(?: to)?|carry on) (?=talk\b)/, "keep ")
    .replace(/^(?:start(?: to)?|started) (?=talk\b)/, "start ")
    .replace(/^(?:stop|quit|do not|don t|no) (?=talk\b)/, "stop ")
    .replace(/\btalk (?:with|to) each other$/, "talk");
}

// A bare action or item can stand for a longer board label only when it
// identifies a single slot. Opposite actions still participate in that check.
export function conciseMeaning(meaning: string): string {
  return meaning.replace(/^(?:keep|start|stop) (?=talk\b)/, "")
    .replace(/^(?:get|buy|order) (?!(?:up|out|off|on|in|over|away|back|it|them|there|here|to)\b)(?=[a-z])/, "");
}

export function typoQualifiers(normalized: string): string {
  return normalized.match(/\b(?:no|not|never|none|without|avoid|stop|quit|don t|doesn t|didn t|can t|won t|and|or|on|off|up|down|in|out|before|after)\b/g)?.join(" ") ?? "";
}
