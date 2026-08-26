/**
 * Regression tests for the blank-placeholder-record OFFLINE bug (2026-08-26).
 *
 * Smartlink serves an all-zero `snap_report_device` at random — `id:""`, `ver:0`,
 * `ol:false`, `ssid:""`, `ip:""` — for machines that are perfectly healthy. The
 * classifier read `ol` as a device state and painted those machines OFFLINE.
 *
 * Measured against live prod: 12 polls of list_snap_mesin at 2.5s over 24
 * machines (288 samples). Every `ol=false` was a blank record (100% correlation,
 * a populated record never once reported `ol=false`), and the blanking flapped
 * hard — D07 blank 3/12, D09 7/12, D02 9/12, D11 9/12. detail_snap_mesin
 * returned `ol:true, ver:100` for six of the nine machines the list endpoint had
 * just called offline.
 *
 * Run: npm run test:blank-record
 * Add UPSTREAM_* env vars (or `vercel env pull`) to also run the live check.
 */
import { normalize, isBlankDeviceRecord } from "../src/normalize.js";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}` +
      (ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

/** Exactly the shape Smartlink returns for a blank placeholder record. */
const BLANK_DEVICE = {
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

/** A real, idle machine as detail_snap_mesin reports it (note ver:100). */
const REAL_IDLE_DEVICE = {
  id: "68C63AFC13FA",
  sw: false,
  st: 0,
  aid: "",
  tl: 0,
  ol: true,
  door: false,
  dur: 0,
  ver: 100,
  cur: 0,
  pow: 0,
  vol: 0,
  ssid: "",
  rssi: 0,
  ip: "",
};

/** A real, running machine straight out of list_snap_mesin. */
const REAL_RUNNING_DEVICE = {
  id: "D48AFC35465C",
  sw: true,
  st: 1,
  aid: "260835GO-PAY1ronji807105",
  tl: 2374849,
  ol: true,
  door: false,
  dur: 2400000,
  ver: 100,
  cur: 0,
  pow: 0,
  vol: 0,
  ssid: "",
  rssi: 0,
  ip: "",
};

const row = (id: string, nama: string, jenis: number, device: any) => ({
  id,
  nama,
  jenis,
  updated_at: "2026-08-26T16:20:06+07:00",
  snap_report_device: device,
});

const statusOf = (id: string, nama: string, jenis: number, device: any) =>
  normalize([row(id, nama, jenis, device)], null).list[0]?.status;

console.log("\n-- isBlankDeviceRecord --");
check("blank placeholder is detected", isBlankDeviceRecord(BLANK_DEVICE), true);
check("real idle record is not blank", isBlankDeviceRecord(REAL_IDLE_DEVICE), false);
check("real running record is not blank", isBlankDeviceRecord(REAL_RUNNING_DEVICE), false);
check("missing device counts as blank", isBlankDeviceRecord(undefined), true);
check("empty object counts as blank", isBlankDeviceRecord({}), true);
check(
  "populated id with ver:0 is not blank (id proves a real record)",
  isBlankDeviceRecord({ ...BLANK_DEVICE, id: "8CAAB5D53E39" }),
  false
);

console.log("\n-- classification --");
// THIS is the bug. Before the fix, machineService handed normalize the raw blank
// record from list_snap_mesin and the machine went OFFLINE. Now the blank row is
// re-read from detail_snap_mesin first, so normalize sees the real record.
check(
  "blank row repaired from detail -> READY, not OFFLINE",
  statusOf("68C63AFC13FA", "Dryer 02 Speedqueen", 2, REAL_IDLE_DEVICE),
  "READY"
);
check(
  "blank in list AND detail -> still OFFLINE (genuinely down)",
  statusOf("8CAAB5D53E39", "Washer 03 LG 24", 1, BLANK_DEVICE),
  "OFFLINE"
);
check(
  "running machine still RUNNING (no regression)",
  statusOf("D48AFC35465C", "Dryer 06 Maytag", 2, REAL_RUNNING_DEVICE),
  "RUNNING"
);
check(
  "populated record reporting ol:false -> OFFLINE",
  statusOf("A4CF12F307D1", "Washer 11 Beko", 1, { ...REAL_IDLE_DEVICE, id: "A4CF12F307D1", ol: false }),
  "OFFLINE"
);
// Guards the 2026-07-23 aid fix — a lingering aid must not read as RUNNING.
check(
  "stale aid with tl=0/dur=0 -> READY, not RUNNING",
  statusOf("9C9C1F410120", "Washer 01 Titan", 1, {
    ...REAL_IDLE_DEVICE,
    id: "9C9C1F410120",
    aid: "BOS",
  }),
  "READY"
);

console.log("\n-- elapsed --");
check(
  "running machine carries elapsed_ms = dur - tl",
  normalize([row("8CCE4EF44A99", "Dryer 12 Ipso", 2, REAL_RUNNING_DEVICE)], null).list[0]
    ?.elapsed_ms,
  2400000 - 2374849
);

async function liveCheck() {
  const { UPSTREAM_BASE, OUTLET_ID, UPSTREAM_BEARER } = process.env;
  if (!UPSTREAM_BASE || !OUTLET_ID || !UPSTREAM_BEARER) {
    console.log("\n-- live check skipped (no UPSTREAM_* env) --");
    return;
  }

  console.log("\n-- live check against Smartlink --");
  const listUrl = `${UPSTREAM_BASE}/list_snap_mesin?idoutlet=${encodeURIComponent(
    OUTLET_ID
  )}&offset=0&limit=25`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${UPSTREAM_BEARER}`,
    "User-Agent": "blank-record-test/1.0",
    Origin: "https://dashboard-vue.smartlink.id",
    Referer: "https://dashboard-vue.smartlink.id",
  };

  const rows: any[] = (await (await fetch(listUrl, { headers })).json())?.data ?? [];
  const naiveOffline = rows
    .filter((x) => !x?.snap_report_device?.ol)
    .map((x) => String(x.nama).trim());

  // Same repair machineService does, inlined so the test needs no server.
  const blanks = rows.filter((x) => x?.id && isBlankDeviceRecord(x?.snap_report_device));
  await Promise.all(
    blanks.map(async (x) => {
      const url = `${UPSTREAM_BASE}/detail_snap_mesin?idoutlet=${encodeURIComponent(
        OUTLET_ID
      )}&idsnap_mesin=${encodeURIComponent(String(x.id))}`;
      const device = (await (await fetch(url, { headers })).json())?.data?.snap_report_device;
      if (device && !isBlankDeviceRecord(device)) x.snap_report_device = device;
    })
  );
  const repairedOffline = rows
    .filter((x) => !x?.snap_report_device?.ol)
    .map((x) => String(x.nama).trim());

  console.log(`  list-only OFFLINE (${naiveOffline.length}): ${naiveOffline.join(", ") || "none"}`);
  console.log(
    `  after repair  OFFLINE (${repairedOffline.length}): ${repairedOffline.join(", ") || "none"}`
  );
  const rescued = naiveOffline.filter((n) => !repairedOffline.includes(n));
  console.log(`  false offline eliminated (${rescued.length}): ${rescued.join(", ") || "none"}`);

  check(
    "repair never invents an OFFLINE the list did not report",
    repairedOffline.every((n) => naiveOffline.includes(n)),
    true
  );
}

liveCheck().then(() => {
  console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
});
