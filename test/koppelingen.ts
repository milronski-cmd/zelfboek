/**
 * Draait alle koppelingstests (nep-fetch met gedocumenteerde antwoorden, geen netwerk, geen database).
 * Gebruik: npx tsx test/koppelingen.ts
 * De live sandbox-tests staan in test/koppelingen-live.ts (zie docs/koppelingen-testen.md).
 */
import { spawnSync } from "child_process";
import { join } from "path";

const tests = ["enablebanking", "bol", "mollie", "stripe", "shopify", "woocommerce", "paypal", "moneybird", "eboekhouden", "jortt"];
const mislukt: string[] = [];
for (const t of tests) {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "koppelingen", `${t}.ts`)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) mislukt.push(t);
}
console.log(mislukt.length ? `\nKOPPELINGEN MISLUKT: ${mislukt.join(", ")}` : `\nKOPPELINGEN-TESTS OK (${tests.length} adapters)`);
process.exit(mislukt.length ? 1 : 0);
