/*
 * Who a campaign is for: the part of the world its views should come from. It's checked by
 * people, not code: a clipper shows their audience's countries (a screenshot from Instagram or
 * YouTube) and an admin accepts it. The country a clipper signs in from is only a hint for
 * admins (someone can live in one place and be watched in another, or use a VPN): it flags,
 * never blocks.
 */

export const AUDIENCES = {
  worldwide: "Worldwide",
  europe: "Europe",
  asia: "Asia",
  north_america: "North America",
  latin_america: "Latin America",
  africa: "Africa",
  oceania: "Oceania",
} as const;
export type Audience = keyof typeof AUDIENCES;
export const AUDIENCE_IDS = Object.keys(AUDIENCES) as Audience[];

/** Countries by region (ISO 3166 codes). Turkey, the Caucasus and the Middle East are Asia; Mexico, Central America and the Caribbean are Latin America. */
const REGIONS: Record<Exclude<Audience, "worldwide">, string> = {
  europe: "AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK",
  asia: "AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
  north_america: "US CA BM GL PM",
  latin_america: "MX GT BZ SV HN NI CR PA CU DO HT JM PR TT BS BB AG DM GD KN LC VC AW CW AR BO BR CL CO EC GY PY PE SR UY VE",
  africa: "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW",
  oceania: "AU NZ FJ PG SB VU WS TO KI FM MH NR PW TV NC PF GU",
};

const REGION_OF = new Map<string, Audience>(Object.entries(REGIONS).flatMap(([region, codes]) => codes.split(" ").map((code) => [code, region as Audience] as const)));

/** Every country code Bamio places in a region. */
export const COUNTRY_CODES = [...REGION_OF.keys()];

const names = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

/** A country's English name ("DE": "Germany"); the code itself when it has none. */
export const countryName = (code: string) => names?.of(code) ?? code;

let byName: Map<string, string> | null = null;

/** A country as a two-letter code, from a code ("de") or an English name ("Germany"). Null when it isn't one. */
export function countryCode(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  byName ??= new Map(COUNTRY_CODES.map((code) => [countryName(code).toLowerCase(), code]));
  return byName.get(value.toLowerCase()) ?? null;
}

/** The region a country is in, or null for one Bamio doesn't place. */
export const regionOf = (code: string | null) => (code ? (REGION_OF.get(code.toUpperCase()) ?? null) : null);

/** Whether a country is outside a campaign's audience: false when either is unknown, or the campaign is worldwide. */
export function outsideAudience(code: string | null, audience: Audience): boolean {
  if (audience === "worldwide") return false;
  const region = regionOf(code);
  return region !== null && region !== audience;
}
