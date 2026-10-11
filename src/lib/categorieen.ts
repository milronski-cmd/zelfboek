/**
 * Categorieën met RGS-code (Referentie Grootboekschema, verplicht bij SBR/XAF) en aftrekbaarheid.
 * aftrek: deel van de kosten dat aftrekbaar is voor de IB (1 = volledig, 0.8 = gemengde kosten zoals eten/drinken).
 */
export const CATEGORIE_INFO = {
  omzet:              { label: "Omzet",                    rgs: "WOmzNopOlv", soort: "omzet",  aftrek: 1 },
  omzet_eu:           { label: "Omzet EU (verlegd)",       rgs: "WOmzNopOlb", soort: "omzet",  aftrek: 1 },
  omzet_buiten_eu:    { label: "Omzet buiten EU",          rgs: "WOmzNopOlu", soort: "omzet",  aftrek: 1 },
  omzet_laag:         { label: "Omzet 9%",                 rgs: "WOmzNopOlv", soort: "omzet",  aftrek: 1 },
  omzet_vrijgesteld:  { label: "Omzet vrijgesteld",        rgs: "WOmzNopOlv", soort: "omzet",  aftrek: 1 },
  overige_opbrengst:  { label: "Overige opbrengsten",      rgs: "WOvbOvb",    soort: "omzet",  aftrek: 1 },
  inkoop:             { label: "Inkoop goederen",          rgs: "WKprKvg",    soort: "kosten", aftrek: 1 },
  inhuur:             { label: "Inhuur derden",            rgs: "WKprUkw",    soort: "kosten", aftrek: 1 },
  kantoorkosten:      { label: "Kantoorkosten",            rgs: "WBedKanKan", soort: "kosten", aftrek: 1 },
  huur_werkruimte:    { label: "Huur werkruimte",          rgs: "WBedHuiHuu", soort: "kosten", aftrek: 1 },
  software:           { label: "Software en abonnementen", rgs: "WBedAutSof", soort: "kosten", aftrek: 1 },
  telefoon_internet:  { label: "Telefoon en internet",     rgs: "WBedKanTel", soort: "kosten", aftrek: 1 },
  apparatuur:         { label: "Apparatuur (< 450)",       rgs: "WBedKanKlm", soort: "kosten", aftrek: 1 },
  investering:        { label: "Investering (> 450, activeren)", rgs: "BMvaBeiVvp", soort: "activa", aftrek: 0 },
  reiskosten:         { label: "Reiskosten OV en taxi",    rgs: "WBedAutRev", soort: "kosten", aftrek: 1 },
  auto:               { label: "Auto en brandstof",        rgs: "WBedAutBra", soort: "kosten", aftrek: 1 },
  parkeren:           { label: "Parkeren en tol",          rgs: "WBedAutPar", soort: "kosten", aftrek: 1 },
  marketing:          { label: "Marketing en reclame",     rgs: "WBedVkkRec", soort: "kosten", aftrek: 1 },
  representatie:      { label: "Eten, drinken, representatie", rgs: "WBedVkkRep", soort: "kosten", aftrek: 0.8 },
  opleiding:          { label: "Opleiding en vakliteratuur", rgs: "WBedOvpOpl", soort: "kosten", aftrek: 1 },
  verzekering:        { label: "Zakelijke verzekering",    rgs: "WBedAssOvp", soort: "kosten", aftrek: 1 },
  aov:                { label: "AOV-premie (privé aftrek)", rgs: "WBedAssOvp", soort: "prive_aftrek", aftrek: 0 },
  administratie:      { label: "Administratie en advies",  rgs: "WBedAdlAcc", soort: "kosten", aftrek: 1 },
  bankkosten:         { label: "Bankkosten",               rgs: "WFbeKbaKba", soort: "kosten", aftrek: 1 },
  betaalprovider:     { label: "Transactiekosten Mollie/Stripe", rgs: "WFbeKbaKba", soort: "kosten", aftrek: 1 },
  verzending:         { label: "Verzendkosten",            rgs: "WBedVkkVer", soort: "kosten", aftrek: 1 },
  belasting:          { label: "Belastingdienst (btw, IB)", rgs: "BSchBepBtw", soort: "balans", aftrek: 0 },
  lening:             { label: "Lening en rente",          rgs: "WFbeRlsRlo", soort: "kosten", aftrek: 1 },
  prive:              { label: "Privé",                    rgs: "BEivKapPro", soort: "prive",  aftrek: 0 },
  overboeking_eigen:  { label: "Eigen rekening",           rgs: "BLimKruKru", soort: "balans", aftrek: 0 },
  klant_terugbetaling:{ label: "Terugbetaling aan klant",  rgs: "WOmzNopOlv", soort: "omzet",  aftrek: 1 },
  afschrijving:       { label: "Afschrijving",             rgs: "WAfsAmvAmv", soort: "kosten", aftrek: 1 },
  boekresultaat:      { label: "Boekresultaat verkoop activa", rgs: "WOvbBvaBva", soort: "omzet", aftrek: 1 },
  overig:             { label: "Overige kosten",           rgs: "WBedOvpOvp", soort: "kosten", aftrek: 1 },
} as const;

/** RGS-omschrijvingen voor de auditfile en jaarrekening. */
export const RGS_OMSCHRIJVING: Record<string, string> = {
  WOmzNopOlv: "Netto-omzet leveringen en diensten",
  WOmzNopOlb: "Netto-omzet EU",
  WOmzNopOlu: "Netto-omzet buiten EU",
  WOvbOvb: "Overige opbrengsten",
  WOvbBvaBva: "Boekresultaat verkoop activa",
  WKprKvg: "Kostprijs verkochte goederen",
  WKprUkw: "Uitbesteed werk",
  WBedKanKan: "Kantoorkosten",
  WBedHuiHuu: "Huur onroerende zaak",
  WBedAutSof: "Software en automatisering",
  WBedKanTel: "Telefoon en internet",
  WBedKanKlm: "Kleine aanschaffingen",
  BMvaBeiVvp: "Bedrijfsinventaris",
  WBedAutRev: "Reiskosten",
  WBedAutBra: "Brandstof en autokosten",
  WBedAutPar: "Parkeerkosten",
  WBedVkkRec: "Reclame en marketing",
  WBedVkkRep: "Representatiekosten",
  WBedOvpOpl: "Opleidingskosten",
  WBedAssOvp: "Verzekeringen",
  WBedAdlAcc: "Administratie en advies",
  WFbeKbaKba: "Bankkosten",
  WBedVkkVer: "Verzendkosten",
  BSchBepBtw: "Te betalen omzetbelasting",
  WFbeRlsRlo: "Rentelasten",
  BEivKapPro: "Privé-opnamen en -stortingen",
  BLimKruKru: "Kruisposten",
  WBedOvpOvp: "Overige bedrijfskosten",
  WAfsAmvAmv: "Afschrijvingen materiële vaste activa",
  BLimBanRba: "Bankrekening",
  BVorDebHad: "Debiteuren",
  BEivKapOnd: "Ondernemingsvermogen",
};

export type Categorie = keyof typeof CATEGORIE_INFO;
export const CATEGORIEEN = Object.keys(CATEGORIE_INFO) as Categorie[];

export const BTW_CODES = ["21", "9", "0", "vrijgesteld", "geen", "verlegd", "eu_dienst", "eu_goed", "buiten_eu"] as const;
export type BtwCode = (typeof BTW_CODES)[number];

export const BTW_LABEL: Record<BtwCode, string> = {
  "21": "21%",
  "9": "9%",
  "0": "0%",
  vrijgesteld: "vrijgesteld",
  geen: "geen btw",
  verlegd: "verlegd (NL)",
  eu_dienst: "EU dienst (verlegd)",
  eu_goed: "EU goederen (ICV)",
  buiten_eu: "buiten EU",
};

export { KM_VERGOEDING as KM_VERGOEDING_2026 } from "./fiscaal/constanten-2026";
export const INVESTERINGSGRENS = 450;
export const URENCRITERIUM = 1225;

export function label(c: string | null | undefined) {
  return c && c in CATEGORIE_INFO ? CATEGORIE_INFO[c as Categorie].label : c ?? "–";
}
