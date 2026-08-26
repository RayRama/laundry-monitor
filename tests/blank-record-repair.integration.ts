/**
 * Integration regression test for the blank-placeholder-record OFFLINE bug.
 *
 * Drives the real refreshMachines() against a stubbed Smartlink and a stubbed
 * gateway, so it needs no network and no credentials.
 *
 * Scenario 1 covers the detail_snap_mesin cross-check and deliberately imports
 * nothing that only exists after the fix, so it can be run against the pre-fix
 * tree and fail there — which is the point: before the repair pass, a blank list
 * record made a live machine OFFLINE.
 *
 * Scenario 2 covers the last-known-good hold. Blank episodes measured on
 * 2026-08-26 ran up to 60s and hit BOTH Smartlink endpoints at once (16 of 24
 * machines were affected inside a 5-minute window, with none of them actually
 * offline), so the detail cross-check alone cannot clear every false OFFLINE.
 *
 * Run: npm run test:blank-record-repair
 */

process.env.UPSTREAM_BASE = "https://stub.invalid/masterData/meta";
process.env.OUTLET_ID = "OTL_TEST";
process.env.UPSTREAM_BEARER = "stub-token";
process.env.UPSTREAM_TIMEOUT_MS = "5000";
process.env.EVENT_GATEWAY_BASE = "https://gateway.invalid";
process.env.MONITOR_INGEST_SECRET = "stub-secret";

/** Blank placeholder record — what Smartlink randomly returns. */
const BLANK = {
  id: "",
  sw: false,
  st: 0,
  aid: "",
  tl: 0,
  ol: false,
  door: false,
  dur: 0,
  ver: 0,
  cur: 0,
  pow: 0,
  vol: 0,
  ssid: "",
  rssi: 0,
  ip: "",
};

const idle = (id: string) => ({ ...BLANK, id, ol: true, ver: 100 });
const running = (id: string, tl: number, dur: number) => ({
  ...BLANK,
  id,
  ol: true,
  ver: 100,
  sw: true,
  st: 1,
  aid: "260835BCA000139260765",
  tl,
  dur,
});

const row = (id: string, nama: string, jenis: number, device: any) => ({
  id,
  nama,
  jenis,
  updated_at: "2026-08-26T16:20:06+07:00",
  snap_report_device: device,
});

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}` +
      (ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

// ---------------------------------------------------------------- stub wiring
let listRows: any[] = [];
let detailAnswers: Record<string, any> = {};
let gatewayKnown: Record<string, { device: any; ts: number }> = {};
let detailCalls = 0;
let gatewayBodies: any[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const json = (body: any) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  if (url.includes("/list_snap_mesin")) {
    // Fresh copies each call so a repair cannot leak between refreshes.
    return json({ code: 200, status: true, data: JSON.parse(JSON.stringify(listRows)) });
  }
  if (url.includes("/detail_snap_mesin")) {
    detailCalls += 1;
    const id = new URL(url).searchParams.get("idsnap_mesin") || "";
    return json({ code: 200, status: true, data: { snap_report_device: detailAnswers[id] ?? null } });
  }
  if (url.includes("/api/monitoring/device-snapshot")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    gatewayBodies.push({ ...body, secret: init?.headers?.["X-Monitor-Ingest-Secret"] });
    const known: Record<string, any> = {};
    for (const id of body.need ?? []) if (gatewayKnown[id]) known[id] = gatewayKnown[id];
    return json({ success: true, data: { known, stored: Object.keys(body.good ?? {}).length } });
  }
  // Status-change logging fires at the gateway; swallow it.
  return json({ ok: true });
}) as typeof fetch;

async function statuses() {
  const { machineCache } = await import("../src/utils/cache.js");
  const snapshot = machineCache.get();
  return {
    byLabel: Object.fromEntries((snapshot?.machines ?? []).map((m: any) => [m.label, m.status])),
    machines: snapshot?.machines ?? [],
    offline:
      (snapshot?.summary?.dryer?.offline ?? 0) + (snapshot?.summary?.washer?.offline ?? 0),
  };
}

async function main() {
  const { loadControllerMap, refreshMachines } = await import("../src/services/machineService.js");
  await loadControllerMap();

  // ------------------------------------------------- scenario 1: detail check
  listRows = [
    // blank in list, alive in detail -> must NOT end up OFFLINE
    row("68C63AFC13FA", "Dryer 02 Speedqueen", 2, { ...BLANK }),
    // blank in list AND detail -> must stay OFFLINE
    row("8CAAB5D53E39", "Washer 03 LG 24", 1, { ...BLANK }),
    // healthy running machine -> must stay RUNNING
    row("D48AFC35465C", "Dryer 06 Maytag", 2, running("D48AFC35465C", 2374849, 2400000)),
  ];
  detailAnswers = {
    "68C63AFC13FA": idle("68C63AFC13FA"),
    "8CAAB5D53E39": { ...BLANK },
  };
  gatewayKnown = {};
  detailCalls = 0;
  gatewayBodies = [];

  await refreshMachines();
  const s1 = await statuses();

  console.log("\n-- scenario 1: detail_snap_mesin cross-check --");
  console.log(`  statuses: ${JSON.stringify(s1.byLabel)}`);
  console.log(`  detail_snap_mesin calls: ${detailCalls}`);

  // The original regression. Pre-fix this is "OFFLINE".
  check("D02 blank in list but alive in detail -> READY", s1.byLabel.D02, "READY");
  check("W03 blank in list and detail -> OFFLINE", s1.byLabel.W03, "OFFLINE");
  check("D06 healthy -> RUNNING", s1.byLabel.D06, "RUNNING");
  check("only the two blank rows were re-read", detailCalls, 2);
  check("summary counts exactly one machine offline", s1.offline, 1);
  check("gateway received the good records", Object.keys(gatewayBodies[0]?.good ?? {}).sort(), [
    "68C63AFC13FA",
    "D48AFC35465C",
  ]);
  check("gateway was asked about the still-blank row", gatewayBodies[0]?.need, ["8CAAB5D53E39"]);
  check("ingest secret was sent", gatewayBodies[0]?.secret, "stub-secret");

  // ---------------------------------------------- scenario 2: last-known hold
  // Different machines from scenario 1 so the 3s hysteresis window cannot mask
  // a status change.
  const now = Date.now();
  listRows = [
    row("483FDA643B85", "Dryer 03 Fogia", 2, { ...BLANK }),
    row("48E7296DE4BF", "Dryer 04 Foggia", 2, { ...BLANK }),
    row("D48AFC354603", "Dryer 05 Maytag", 2, { ...BLANK }),
  ];
  // Blank in detail too — this is the episode the cross-check cannot clear.
  detailAnswers = {
    "483FDA643B85": { ...BLANK },
    "48E7296DE4BF": { ...BLANK },
    "D48AFC354603": { ...BLANK },
  };
  gatewayKnown = {
    // mid-cycle 60s ago: 10 of 30 minutes left -> still running, 9 min left now
    "483FDA643B85": { device: running("483FDA643B85", 600_000, 1_800_000), ts: now - 60_000 },
    // 30s left as of 120s ago -> the cycle ended during the gap
    "48E7296DE4BF": { device: running("48E7296DE4BF", 30_000, 1_800_000), ts: now - 120_000 },
    // nothing known for D05
  };
  detailCalls = 0;
  gatewayBodies = [];

  await refreshMachines();
  const s2 = await statuses();

  console.log("\n-- scenario 2: last-known-good hold --");
  console.log(`  statuses: ${JSON.stringify(s2.byLabel)}`);

  check("D03 held mid-cycle -> RUNNING, not OFFLINE", s2.byLabel.D03, "RUNNING");
  check("D04 cycle ended during the gap -> READY, not a frozen timer", s2.byLabel.D04, "READY");
  check("D05 blank everywhere and unknown -> OFFLINE", s2.byLabel.D05, "OFFLINE");
  check("only D05 counts as offline", s2.offline, 1);

  // The countdown must keep running through the gap, not freeze at the stored tl.
  const d03 = s2.machines.find((m: any) => m.label === "D03");
  const elapsed = Math.round((d03?.elapsed_ms ?? 0) / 1000);
  check(
    "D03 elapsed advanced by the gap (1200s stored + 60s gap = 1260s)",
    elapsed >= 1258 && elapsed <= 1262,
    true
  );

  globalThis.fetch = realFetch;
  console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
