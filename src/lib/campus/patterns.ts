import type { FindingCategory } from "../types";

/*
 * Student-targeted scam patterns. Every pattern's `sources` are pages that were opened and
 * read while writing it (FTC Consumer Advice, FBI IC3, CFPB, Federal Student Aid, university
 * police advisories). Statistics below were read from the primary page, not from memory.
 * Generic across US campuses: nothing here claims anything about a specific school.
 */

export type Source = { title: string; url: string };

export type PatternId =
  | "fake-job-check"
  | "aid-refund-phish"
  | "rental-deposit"
  | "professor-gift-cards"
  | "fake-scholarship-fee"
  | "marketplace-overpayment"
  | "loan-forgiveness"
  | "login-suspension"
  | "immigration-threat"
  | "fake-recruiter"
  | "roommate-ticket"
  | "family-voice-clone";

/** A fact category that makes the scam more convincing, and why. */
export type Fuel = { category: FindingCategory; why: string; weight: number };

/** Free-text hint found in a finding's label, value or snippet. */
export type Signal = { re: RegExp; why: string; weight: number };

export type CampusPattern = {
  id: PatternId;
  name: string;
  /** One line: what it is. */
  tagline: string;
  /** How it starts. */
  opener: string;
  fuel: Fuel[];
  signals: Signal[];
  redFlags: string[];
  /** The single most useful action. */
  action: string;
  report: Source[];
  sources: Source[];
};

const FTC_REPORT: Source = { title: "ReportFraud.ftc.gov", url: "https://reportfraud.ftc.gov/" };
const IC3_REPORT: Source = { title: "ic3.gov", url: "https://www.ic3.gov/" };
const CFPB_COMPLAINT: Source = { title: "CFPB complaint", url: "https://www.consumerfinance.gov/complaint/" };

const S = {
  jobsCollege: { title: "FTC: College students are targeted with job scams, too (2024)", url: "https://consumer.ftc.gov/consumer-alerts/2024/04/college-students-are-targeted-jobs-scams-too-0" },
  jobsPersonal: { title: "FTC: Job scams targeting college students are getting personal (2023)", url: "https://consumer.ftc.gov/consumer-alerts/2023/12/job-scams-targeting-college-students-are-getting-personal" },
  fakeCheck: { title: "FTC: How to spot, avoid and report fake check scams", url: "https://consumer.ftc.gov/articles/how-spot-avoid-and-report-fake-check-scams" },
  fakeCheckHub: { title: "FTC: Fake check scams", url: "https://consumer.ftc.gov/fake-check-scams" },
  binghamton: { title: "Binghamton University Police: Safety alert, Jan 22 2024", url: "https://www.binghamton.edu/police/1-22-24-alert.html" },
  studentLoanScams: { title: "FTC: Student loan and education scams", url: "https://consumer.ftc.gov/all-scams/student-loan-education-scams" },
  payingForSchool: { title: "FTC: Paying for school and avoiding scams", url: "https://consumer.ftc.gov/articles/paying-school-and-avoiding-scams" },
  cfpbForgiveness: { title: "CFPB: Student loan forgiveness", url: "https://www.consumerfinance.gov/paying-for-college/student-loan-forgiveness/" },
  wire: { title: "FTC: What to know before you wire money", url: "https://consumer.ftc.gov/articles/what-know-you-wire-money" },
  rental: { title: "FTC: Rental and housing scams", url: "https://consumer.ftc.gov/all-scams/rental-housing-scams" },
  giftBoss: { title: "FTC: Starting a college job or internship? Watch for this scam (2024)", url: "https://consumer.ftc.gov/consumer-alerts/2024/09/starting-college-job-or-internship-fall-semester-watch-scam" },
  techSupport: { title: "FTC: How to spot, avoid and report tech support scams", url: "https://consumer.ftc.gov/articles/how-spot-avoid-and-report-tech-support-scams" },
  phishing: { title: "FTC: How to recognize and avoid phishing scams", url: "https://consumer.ftc.gov/articles/how-recognize-avoid-phishing-scams" },
  ic3Visa: { title: "FBI IC3 PSA I-051325-PSA: Scammers target foreign students (2025)", url: "https://www.ic3.gov/PSA/2025/PSA250513" },
  family: { title: "FTC: Family emergency scams", url: "https://consumer.ftc.gov/all-scams/family-emergency-scams" },
} satisfies Record<string, Source>;

export const PATTERNS: CampusPattern[] = [
  {
    id: "fake-job-check",
    name: "Fake campus job with a check",
    tagline: "A \"research assistant\" or \"personal assistant\" job that pays you with a check that will bounce.",
    opener: "A mass email that looks like it came from a professor or campus office, or a listing on a job board, offers easy part-time work. A check arrives before you start.",
    fuel: [
      { category: "school", why: "Lets the email name your school and sound like faculty.", weight: 0.35 },
      { category: "email", why: "A school address is how the mass email reaches you.", weight: 0.3 },
      { category: "interest", why: "Your major or clubs make the job sound like a fit.", weight: 0.15 },
      { category: "schedule", why: "Posted free time makes \"flexible hours\" appealing.", weight: 0.1 },
    ],
    signals: [
      { re: /\b(looking for (a )?(job|work)|part[- ]?time|side hustle|need (money|cash)|student worker|work[- ]study)\b/i, why: "Public posts about looking for work.", weight: 0.35 },
    ],
    redFlags: [
      "A check arrives before you have done any work",
      "You are told to deposit it and send part back, or buy gift cards",
      "The sender uses a personal address, or a school address you did not look up",
      "Duties, pay and hours are not given in writing",
    ],
    action: "Do not deposit the check. Email the professor or office yourself, using an address from the school directory.",
    report: [FTC_REPORT],
    sources: [S.jobsCollege, S.fakeCheckHub, S.binghamton],
  },
  {
    id: "aid-refund-phish",
    name: "Financial aid or tuition refund phishing",
    tagline: "A message about a refund, a hold or an unpaid balance that sends you to a fake school portal.",
    opener: "A text or email says your aid is on hold, a refund is waiting, or tuition is overdue and your classes will be dropped unless you pay now.",
    fuel: [
      { category: "school", why: "The message can name your real school and look official.", weight: 0.4 },
      { category: "email", why: "It lands in the inbox you actually use for school.", weight: 0.3 },
      { category: "phone", why: "Texts reach you directly and feel urgent.", weight: 0.2 },
      { category: "birthday", why: "Your birth date makes a fake \"verification\" feel routine.", weight: 0.1 },
    ],
    signals: [{ re: /\b(fafsa|financial aid|tuition|refund|bursar|semester)\b/i, why: "Public posts about aid, tuition or refunds.", weight: 0.25 }],
    redFlags: [
      "Threat to drop your classes unless you pay right away",
      "A link to log in instead of your normal school portal",
      "Request for your FSA ID, school password or a code",
      "Payment by gift card, wire or app",
    ],
    action: "Open your school portal by typing the address yourself, or call the bursar's office on a number from the school website.",
    report: [FTC_REPORT, { title: "reportphishing@apwg.org", url: "mailto:reportphishing@apwg.org" }],
    sources: [S.studentLoanScams, S.payingForSchool, S.phishing],
  },
  {
    id: "rental-deposit",
    name: "Rental or sublet deposit scam",
    tagline: "A cheap apartment near campus that needs a deposit before you can see it.",
    opener: "A listing with low rent and great photos. The \"landlord\" is out of town, so you pay a deposit or fee by wire or app to \"hold\" it.",
    fuel: [
      { category: "location", why: "Knowing the area you want makes a listing there look made for you.", weight: 0.35 },
      { category: "school", why: "\"Walking distance to campus\" targets your school.", weight: 0.2 },
      { category: "schedule", why: "Move dates and lease timing create deadline pressure.", weight: 0.15 },
    ],
    signals: [{ re: /\b(apartment|sublet|sublease|lease|housing|moving|move[- ]in|roommate wanted|off[- ]campus)\b/i, why: "Public posts about housing or moving.", weight: 0.45 }],
    redFlags: [
      "Rent far below similar places nearby",
      "The owner cannot meet or show the unit in person",
      "Deposit by wire, gift card, crypto or a payment app",
      "Pressure to pay now because others are interested",
    ],
    action: "Never pay a deposit before you see the unit and a lease in person, or on a live video tour of the same address.",
    report: [FTC_REPORT, { title: "Wire recall contacts", url: S.wire.url }],
    sources: [S.rental, S.wire],
  },
  {
    id: "professor-gift-cards",
    name: "\"Your professor needs gift cards\"",
    tagline: "A message from a boss, professor or supervisor who needs a favor, urgently.",
    opener: "A text or email from a name you recognize asks you to buy gift cards for a surprise and send the numbers. They promise to pay you back.",
    fuel: [
      { category: "school", why: "Your school makes a faculty or staff name believable.", weight: 0.3 },
      { category: "employer", why: "A campus job or internship supervisor is easy to copy.", weight: 0.35 },
      { category: "email", why: "Your address is the target of the spoofed message.", weight: 0.2 },
      { category: "phone", why: "The same pitch works by text.", weight: 0.15 },
    ],
    signals: [{ re: /\b(new (job|internship)|start(ed|ing) (a )?(job|internship)|campus job|work[- ]study|ta |research assistant)\b/i, why: "A new job or internship announced publicly.", weight: 0.3 }],
    redFlags: [
      "Urgent request to keep it quiet or surprise someone",
      "Asks for gift card numbers or PINs, or a photo of the card",
      "Sender address or number does not match the real one",
      "Promises to pay you back later",
    ],
    action: "Contact the person on a number or address you already have. Gift cards are never a payment method for work.",
    report: [FTC_REPORT],
    sources: [S.giftBoss, S.binghamton],
  },
  {
    id: "fake-scholarship-fee",
    name: "Fake scholarship or aid fee",
    tagline: "A scholarship you never applied for, with a fee to \"release\" it.",
    opener: "You have won, or been selected, or a service promises to find aid for you. First there is a processing fee or a request for your bank details.",
    fuel: [
      { category: "school", why: "A named school and major make the award sound targeted.", weight: 0.3 },
      { category: "interest", why: "Clubs and activities are quoted back as \"qualifications\".", weight: 0.25 },
      { category: "email", why: "The offer arrives at an address tied to your enrollment.", weight: 0.2 },
    ],
    signals: [{ re: /\b(scholarship|grant|fafsa|financial aid|apply(ing)? for aid)\b/i, why: "Public posts about scholarships or aid.", weight: 0.4 }],
    redFlags: [
      "A fee to apply, to \"guarantee\" or to receive an award",
      "You won a contest you did not enter",
      "Pressure to decide today",
      "Requests for your FSA ID or bank login",
    ],
    action: "Apply for federal aid only through the free FAFSA form, and ask your school's financial aid office about any outside offer.",
    report: [FTC_REPORT, { title: "Your state attorney general", url: "https://www.usa.gov/state-attorney-general" }],
    sources: [S.payingForSchool, S.studentLoanScams],
  },
  {
    id: "marketplace-overpayment",
    name: "Textbook or marketplace overpayment",
    tagline: "A buyer sends too much and asks you to send the extra back.",
    opener: "You list a textbook, bike or furniture. A buyer \"accidentally\" pays with a check for more than the price and asks you to refund the difference.",
    fuel: [
      { category: "handle", why: "Your seller handle is public on the listing.", weight: 0.3 },
      { category: "email", why: "Contact details on the listing go straight to the scammer.", weight: 0.25 },
      { category: "phone", why: "Buyers ask to move to text, where checks are easier to push.", weight: 0.2 },
      { category: "location", why: "A pickup area makes the deal feel local.", weight: 0.1 },
    ],
    signals: [{ re: /\b(for sale|selling|textbook|craigslist|marketplace|facebook marketplace|depop|offerup|poshmark)\b/i, why: "Public posts selling things.", weight: 0.4 }],
    redFlags: [
      "A check or payment for more than the price",
      "Asked to send back the difference",
      "Buyer insists on gift cards, wire or crypto",
      "Buyer will pick up nothing, or sends a shipper",
    ],
    action: "Do not refund anything. A deposited check can bounce weeks later, and the bank will take the money back from you.",
    report: [FTC_REPORT, { title: "U.S. Postal Inspection Service", url: "https://www.uspis.gov/report" }],
    sources: [S.fakeCheck, S.wire],
  },
  {
    id: "loan-forgiveness",
    name: "Student loan forgiveness or relief",
    tagline: "A caller or ad that promises to cut or erase your loans for a fee.",
    opener: "A call, text or ad says you qualify for a special forgiveness or lower-payment program. They need your FSA ID or an upfront fee.",
    fuel: [
      { category: "school", why: "Your school hints you may have federal loans.", weight: 0.25 },
      { category: "phone", why: "Calls and texts are the main way this scam reaches you.", weight: 0.3 },
      { category: "email", why: "Marketing lists tied to enrollment carry your address.", weight: 0.2 },
      { category: "birthday", why: "A birth date makes \"verification\" sound plausible.", weight: 0.1 },
    ],
    signals: [{ re: /\b(student loans?|loan forgiveness|my loans|debt|repayment)\b/i, why: "Public posts about student loans.", weight: 0.4 }],
    redFlags: [
      "A fee before any help",
      "They ask for your FSA ID or login",
      "Claims of a special government program, with a deadline",
      "A caller who knows your balance (this proves nothing)",
    ],
    action: "Never pay for help with federal loans. Use StudentAid.gov or your servicer.",
    report: [FTC_REPORT, CFPB_COMPLAINT],
    sources: [S.studentLoanScams, S.cfpbForgiveness, S.payingForSchool],
  },
  {
    id: "login-suspension",
    name: "Tech support or school account suspension",
    tagline: "A warning that your school account or device is compromised, with a link or phone number to fix it.",
    opener: "An email says your school account will be suspended unless you verify, or a pop-up says your laptop has a virus and gives a number to call.",
    fuel: [
      { category: "school", why: "A real school name makes the notice look like IT.", weight: 0.35 },
      { category: "email", why: "Your school address is the account they claim to protect.", weight: 0.35 },
      { category: "handle", why: "Known usernames help guess or reset accounts.", weight: 0.1 },
      { category: "phone", why: "A text version of the same warning reaches you fast.", weight: 0.1 },
    ],
    signals: [],
    redFlags: [
      "A link to log in that is not your school's real address",
      "Deadline, or threat of losing your account",
      "Request for a verification code",
      "A pop-up telling you to call a number",
    ],
    action: "Go to your school's IT page by typing the address yourself. Never share a verification code.",
    report: [FTC_REPORT, { title: "reportphishing@apwg.org", url: "mailto:reportphishing@apwg.org" }],
    sources: [S.techSupport, S.phishing],
  },
  {
    id: "immigration-threat",
    name: "Immigration or visa threat call",
    tagline: "A caller posing as an immigration official says your status is in trouble.",
    opener: "A call, with a spoofed number, claims you broke student visa rules and will be deported or prosecuted unless you pay or share details.",
    fuel: [
      { category: "school", why: "Naming your university makes the call credible.", weight: 0.3 },
      { category: "phone", why: "The call reaches your number directly.", weight: 0.3 },
      { category: "location", why: "Your city or home country adds convincing detail.", weight: 0.2 },
    ],
    signals: [{ re: /\b(international student|f-?1|visa|opt\b|i-20|study(ing)? abroad|from (india|china|nepal|saudi|uae|qatar|jordan))\b/i, why: "Public details that show you are an international student.", weight: 0.45 }],
    redFlags: [
      "A government official demanding payment by phone",
      "Payment by crypto, prepaid cards or wire",
      "Threat of arrest or deportation, with urgency",
      "A website with a look-alike address, or a request for a 2FA code",
    ],
    action: "Hang up. Contact the agency through a number you find yourself, and your school's international student office.",
    report: [IC3_REPORT, FTC_REPORT],
    sources: [S.ic3Visa],
  },
  {
    id: "fake-recruiter",
    name: "Fake internship recruiter",
    tagline: "A \"recruiter\" from a big firm who knows your school and wants your documents.",
    opener: "A message on a social or professional site mentions a professor or school tradition, runs a quick virtual interview and makes an offer.",
    fuel: [
      { category: "employer", why: "Real employers and past internships are copied into the pitch.", weight: 0.3 },
      { category: "school", why: "School names, deans and traditions build instant trust.", weight: 0.3 },
      { category: "handle", why: "Public profiles are where recruiters find you.", weight: 0.2 },
      { category: "interest", why: "Majors and clubs are quoted back as a \"match\".", weight: 0.15 },
    ],
    signals: [
      { re: /\b(intern(ship)?s?|recruit(er|ing)?|career fair|resume|linkedin|open to work|seeking)\b/i, why: "Public job-hunting posts or profile.", weight: 0.4 },
    ],
    redFlags: [
      "Says a professor recommended you, without proof",
      "Writes from a personal webmail address",
      "Asks for your SSN or bank details before an offer is verified",
      "Sends a signing check and tells you to buy equipment",
    ],
    action: "Contact the professor yourself and call the company on a number from its own website.",
    report: [FTC_REPORT],
    sources: [S.jobsPersonal, S.jobsCollege],
  },
  {
    id: "roommate-ticket",
    name: "Roommate or ticket deal scam",
    tagline: "A seller or roommate you met online who needs money first.",
    opener: "Someone in a school group chat sells tickets or offers a room. They want a deposit, and cannot meet in person.",
    fuel: [
      { category: "handle", why: "Your handles show which groups and chats you are in.", weight: 0.3 },
      { category: "interest", why: "Teams, concerts and clubs tell them what you want.", weight: 0.3 },
      { category: "photo", why: "Public photos help a fake profile look like a classmate.", weight: 0.1 },
      { category: "school", why: "A \"fellow student\" claim is easy to fake.", weight: 0.15 },
    ],
    signals: [{ re: /\b(tickets?|concert|game day|festival|roommate|spring break|looking for a room)\b/i, why: "Public posts about tickets, rooms or events.", weight: 0.4 }],
    redFlags: [
      "Payment only by wire, gift card, crypto or a friends-and-family app",
      "Cannot meet or video call, always an excuse",
      "Price far below the going rate",
      "Account is new or the photos are borrowed",
    ],
    action: "Pay only with a card, through a platform that holds the money. Never wire money to someone you have not met.",
    report: [FTC_REPORT, { title: "Wire transfer recall contacts", url: S.wire.url }],
    sources: [S.wire, S.rental],
  },
  {
    id: "family-voice-clone",
    name: "Family emergency with a cloned voice",
    tagline: "A panicked call from \"you\" to your family, or from \"a relative\" to you, asking for money now.",
    opener: "A call sounds like you or a relative in trouble: a crash, an arrest, a lost wallet abroad. The voice may be cloned from a clip posted online.",
    fuel: [
      { category: "relative", why: "Names of parents and siblings make the call specific.", weight: 0.4 },
      { category: "photo", why: "Public videos give a voice sample to copy.", weight: 0.2 },
      { category: "phone", why: "Their numbers and yours are the way in.", weight: 0.2 },
      { category: "location", why: "Where you are makes a travel emergency believable.", weight: 0.1 },
    ],
    signals: [{ re: /\b(my (mom|dad|mother|father|sister|brother|grandma|grandpa)|family|parents)\b/i, why: "Family members named or tagged publicly.", weight: 0.25 }],
    redFlags: [
      "A panicked voice and a demand for money right now",
      "Wire, gift cards or crypto requested",
      "Asked to keep it secret from the rest of the family",
      "A call from an unknown number or a new \"lawyer\"",
    ],
    action: "Hang up and call back on the number you have. Agree a family code word before you need one.",
    report: [FTC_REPORT, IC3_REPORT],
    sources: [S.family, S.wire],
  },
];

export const PATTERN_BY_ID: Record<PatternId, CampusPattern> = Object.fromEntries(PATTERNS.map((p) => [p.id, p])) as Record<PatternId, CampusPattern>;

/** Headline numbers. Each was read on the linked primary page. Do not edit without re-checking the page. */
export type CampusStat = { id: string; figure: string; label: string; year: number; source: Source };

export const CAMPUS_STATS: CampusStat[] = [
  {
    id: "ic3-20s",
    figure: "$540.1M",
    label: "lost by ages 20 to 29 in 71,399 complaints to the FBI",
    year: 2024,
    source: { title: "FBI IC3 2024 Internet Crime Report", url: "https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf" },
  },
  {
    id: "ftc-jobs",
    figure: "$90M to $501M",
    label: "reported job and employment agency scam losses, 2020 to 2024",
    year: 2024,
    source: { title: "FTC press release", url: "https://www.ftc.gov/news-events/news/press-releases/2025/03/new-ftc-data-show-big-jump-reported-losses-fraud-125-billion-2024" },
  },
  {
    id: "ftc-total",
    figure: "$12.5B",
    label: "reported fraud losses in the US, up 25% on 2023",
    year: 2024,
    source: { title: "FTC press release", url: "https://www.ftc.gov/news-events/news/press-releases/2025/03/new-ftc-data-show-big-jump-reported-losses-fraud-125-billion-2024" },
  },
];
