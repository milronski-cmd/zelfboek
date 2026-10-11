/**
 * Fiscale constanten belastingjaar 2026 voor een eenmanszaak (IB-ondernemer, jonger dan AOW-leeftijd).
 * Gecontroleerd op 11-10-2026 tegen de Belastingdienst (bron-URL per constante hieronder).
 * Deze bedragen zijn een indicatie; de aanslag van de Belastingdienst is leidend.
 */
const BD = "https://www.belastingdienst.nl/wps/wcm/connect";
export const BRONNEN = {
  ondernemersaftrek: `${BD}/fisin/fisin2026/ondernemersaftrek_en_investeringsaftrek`,
  zelfstandigenaftrek: `${BD}/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/veranderingen-inkomstenbelasting-2026/ondernemersaftrek-2026/zelfstandigenaftrek-2026`,
  box1: `${BD}/fisin/fisin2026/belastingberekening`,
  heffingskortingen: `${BD}/nl/voorlopige-aanslag/content/voorlopige-aanslag-tarieven-en-heffingskortingen`,
  zvw: `${BD}/bldcontentnl/belastingdienst/prive/werk_en_inkomen/zorgverzekeringswet/veranderingen-bijdrage-zvw/percentages-zvw`,
  kia: `${BD}/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/veranderingen-inkomstenbelasting-2026/investeringsaftrek-2026/kleinschaligheidsinvesteringsaftrek-2026`,
  kor: `${BD}/bldcontentnl/belastingdienst/zakelijk/btw/hoe_werkt_de_btw/kleineondernemersregeling/`,
  kilometer: `${BD}/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/veranderingen-inkomstenbelasting-2026/zakelijk-gebruik-privevervoermiddel-2026`,
} as const;

export const JAAR = 2026;

/** € 1.200 (2025: € 2.470). Bron: BRONNEN.zelfstandigenaftrek */
export const ZELFSTANDIGENAFTREK = 1200;
/** € 2.123. Bron: BRONNEN.ondernemersaftrek */
export const STARTERSAFTREK = 2123;
/** 12,7% van de winst na ondernemersaftrek. Bron: BRONNEN.ondernemersaftrek */
export const MKB_WINSTVRIJSTELLING = 0.127;
/** Minimaal 1.225 uur per kalenderjaar. Bron: BRONNEN.ondernemersaftrek */
export const URENCRITERIUM = 1225;

/** Ondernemersaftrek en MKB-vrijstelling leveren in 2026 maximaal 37,56% voordeel op (tarief tweede schijf). Bron: BRONNEN.zelfstandigenaftrek */
export const AFTREKBEPERKING_TARIEF = 0.3756;

/** Box 1 2026, jonger dan AOW-leeftijd. Bron: BRONNEN.box1 (schijf 1 was hier 35,7% en schijf 2 liep tot € 79.137; beide gecorrigeerd). */
export const BOX1_SCHIJVEN: { tot: number | null; tarief: number }[] = [
  { tot: 38883, tarief: 0.3575 },
  { tot: 78426, tarief: 0.3756 },
  { tot: null, tarief: 0.495 },
];

/** Algemene heffingskorting 2026: € 3.115 − 6,398% × (inkomen − € 29.736), nihil vanaf € 78.426. Bron: BRONNEN.heffingskortingen */
export const ALGEMENE_HEFFINGSKORTING = {
  maximum: 3115,
  afbouwVanaf: 29736,
  afbouwPercentage: 0.06398,
};

/** Arbeidskorting 2026: opbouw in trappen, daarna € 5.685 − 6,51% × (arbeidsinkomen − € 45.592), nihil vanaf € 132.920. Bron: BRONNEN.heffingskortingen */
export const ARBEIDSKORTING = {
  trappen: [
    { tot: 11965, vast: 0, pct: 0.08324 },
    { tot: 25845, vast: 996, pct: 0.31009 },
    { tot: 45592, vast: 5300, pct: 0.0195 },
  ],
  maximum: 5685,
  afbouwVanaf: 45592,
  afbouwPercentage: 0.0651,
  nulVanaf: 132920,
};

/** Inkomensafhankelijke bijdrage Zvw via aanslag: 4,85%, maximum bijdrage-inkomen € 79.409. Bron: BRONNEN.zvw */
export const ZVW = {
  percentage: 0.0485,
  maximumInkomen: 79409,
};

/** KIA 2026: 0% t/m € 2.900, 28% t/m € 71.683, € 20.072 t/m € 132.746, afbouw 7,56%, 0% boven € 398.236. Bedrijfsmiddelen vanaf € 450. Bron: BRONNEN.kia */
export const KIA = {
  minimumPerMiddel: 450,
  drempel: 2900,
  pctTot: 71683,
  pct: 0.28,
  vastBedrag: 20072,
  vastTot: 132746,
  afbouwPct: 0.0756,
  nulVanaf: 398236,
};

/** KOR: omzet niet meer dan € 20.000 per kalenderjaar. Bron: BRONNEN.kor */
export const KOR_GRENS = 20000;
/** € 0,25 per zakelijke km met privévervoer in 2026 (2025: € 0,23). Bron: BRONNEN.kilometer */
export const KM_VERGOEDING = 0.25;
export const INVESTERINGSGRENS = 450;

/** Wettelijke rente voor handelstransacties (H2 2026, indicatie) en WIK-staffel incassokosten. */
export const WETTELIJKE_HANDELSRENTE = 0.1025;
