/**
 * Google Sheets Integration untuk Laundry Monitor
 * Menyimpan data mesin laundry ke spreadsheet
 */

import { google } from "googleapis";
import { randomUUID } from "crypto";

// Interface untuk data mesin yang akan disimpan
export interface MachineRecord {
  uniqueKey: string; // Unique Key untuk tracking (UUID)
  id: string; // ID Mesin (W1, D1, etc.)
  name: string; // Nama Mesin (BEKO, TITAN, etc.)
  startTime: string; // Jam Mulai (HH:MM:SS)
  endTime: string; // Jam Beres (HH:MM:SS)
  duration: string; // Durasi Mesin (HH:MM:SS)
  trigger: string; // Bekerja Trigger (Smart Owner, Payment, etc.)
  savedAt: string; // Waktu Tersimpan (HH:MM:SS)
}

// Mapping brand names
const MACHINE_BRANDS: Record<string, string> = {
  // Dryers
  D01: "SQ",
  D02: "SQ",
  D03: "FGD",
  D04: "FGD",
  D05: "MDG",
  D06: "MDG",
  D07: "MDG",
  D08: "MDG",
  D09: "MDG",
  D10: "NTG",
  D11: "NTG",
  D12: "NTG",
  // Washers
  W01: "Titan",
  W02: "Titan",
  W03: "LG24",
  W04: "LG24",
  W05: "FGD",
  W06: "FGD",
  W07: "LG20",
  W08: "LG20",
  W09: "LG20",
  W10: "NTG",
  W11: "BEKO",
  W12: "BEKO",
};

// Mapping aid status ke trigger type
const AID_TO_TRIGGER: Record<string, string> = {
  BOS: "Smart Owner",
  // Semua aid lainnya akan menggunakan value asli dari API
};

// Function to get trigger from aid, fallback to original value if not mapped
function getTriggerFromAid(aid: string): string {
  return AID_TO_TRIGGER[aid] || aid; // Return original aid value if not in mapping
}

export class SpreadsheetManager {
  private sheets: any;
  private spreadsheetId: string;
  private machineStates: Map<
    string,
    { status: string; startTime?: Date; aid?: string }
  > = new Map();
  private savedRecords: Set<string> = new Set(); // Track saved records to prevent duplicates

  constructor(spreadsheetId: string, credentials: any) {
    this.spreadsheetId = spreadsheetId;

    // Setup Google Sheets API with updated authentication
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth });
  }

  /**
   * Track perubahan status mesin dan simpan ke spreadsheet saat ada event
   */
  async trackMachineStatus(machines: any[]) {
    console.log(
      `🔍 Processing ${machines.length} machines for status tracking`
    );

    for (const machine of machines) {
      const machineId = machine.label;
      const currentStatus = machine.status;
      const aid = machine.aid || "UNKNOWN";

      console.log(
        `📊 Machine ${machineId}: status=${currentStatus}, aid=${aid}`
      );

      const previousState = this.machineStates.get(machineId);
      console.log(`📋 Previous state for ${machineId}:`, previousState);

      // Jika mesin baru mulai running
      if (
        currentStatus === "RUNNING" &&
        (!previousState || previousState.status !== "RUNNING")
      ) {
        console.log(`🟢 Machine ${machineId} started running`);

        this.machineStates.set(machineId, {
          status: currentStatus,
          startTime: new Date(),
          aid: aid,
        });
      }

      // Jika mesin selesai (dari RUNNING ke READY)
      else if (
        currentStatus === "READY" &&
        previousState?.status === "RUNNING"
      ) {
        console.log(`🔴 Machine ${machineId} finished running`);

        const startTime = previousState.startTime;
        if (startTime) {
          const endTime = new Date();
          const duration = this.calculateDuration(startTime, endTime);

          // Generate unique UUID for this record
          const uniqueKey = randomUUID();

          // Round times to minute to handle millisecond differences
          const roundToMinute = (date: Date) => {
            const rounded = new Date(date);
            rounded.setSeconds(0, 0); // Set detik dan milidetik ke 0
            return rounded;
          };

          const roundedStartTime = roundToMinute(startTime);
          const roundedEndTime = roundToMinute(endTime);

          // Create unique key to prevent duplicates (rounded to minute + duration)
          const recordKey = `${machineId}_${this.formatTime(
            roundedStartTime
          )}_${this.formatTime(roundedEndTime)}_${duration}`;

          // Check if record already exists
          if (this.savedRecords.has(recordKey)) {
            console.log(
              `⚠️ Duplicate record detected for ${machineId}, skipping... (Key: ${recordKey})`
            );
            console.log(`🔍 All saved records:`, Array.from(this.savedRecords));
            return;
          }

          console.log(`✅ New record for ${machineId} (Key: ${recordKey})`);
          console.log(
            `📅 Original: ${this.formatTime(startTime)} → ${this.formatTime(
              endTime
            )} (${duration})`
          );
          console.log(
            `📅 Rounded:  ${this.formatTime(
              roundedStartTime
            )} → ${this.formatTime(roundedEndTime)} (${duration})`
          );
          console.log(`🔍 Saved records count: ${this.savedRecords.size}`);

          const record: MachineRecord = {
            uniqueKey: uniqueKey,
            id: machineId,
            name: MACHINE_BRANDS[machineId] || "Unknown",
            startTime: this.formatTime(startTime),
            endTime: this.formatTime(endTime),
            duration: duration,
            trigger: getTriggerFromAid(previousState.aid || "UNKNOWN"),
            savedAt: this.formatDateTime(new Date()),
          };

          // Simpan ke spreadsheet
          await this.saveToSpreadsheet(record);

          // Mark as saved to prevent duplicates
          this.savedRecords.add(recordKey);
          console.log(`📊 Total saved records: ${this.savedRecords.size}`);
        }

        // Update state
        this.machineStates.set(machineId, {
          status: currentStatus,
          aid: aid,
        });
      }

      // Update state untuk mesin yang tidak berubah status
      else if (previousState) {
        this.machineStates.set(machineId, {
          ...previousState,
          aid: aid,
        });
      }
    }
  }

  /**
   * Simpan data mesin ke Google Spreadsheet
   */
  private async saveToSpreadsheet(record: MachineRecord) {
    try {
      console.log(`💾 Saving machine record to spreadsheet:`, record);

      const values = [
        [
          record.uniqueKey,
          record.id,
          record.name,
          record.startTime,
          record.endTime,
          record.duration,
          record.trigger,
          record.savedAt,
        ],
      ];

      console.log(`📝 Appending values to spreadsheet:`, values);

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: "Sheet1!A:H", // Kolom A sampai H
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: values,
        },
      });

      console.log(
        `✅ Data saved to spreadsheet: ${record.id} - ${record.name}`
      );
    } catch (error) {
      console.error("❌ Error saving to spreadsheet:", error);
    }
  }

  /**
   * Hitung durasi antara dua waktu
   */
  private calculateDuration(startTime: Date, endTime: Date): string {
    const diffMs = endTime.getTime() - startTime.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  /**
   * Format waktu ke HH:MM:SS dengan timezone Indonesia (WIB)
   */
  private formatTime(date: Date): string {
    // Convert to Indonesia timezone (UTC+7)
    const indonesiaTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);

    const hours = indonesiaTime.getUTCHours().toString().padStart(2, "0");
    const minutes = indonesiaTime.getUTCMinutes().toString().padStart(2, "0");
    const seconds = indonesiaTime.getUTCSeconds().toString().padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Format tanggal dan waktu lengkap ke DD/MM/YYYY HH:MM:SS dengan timezone Indonesia (WIB)
   */
  private formatDateTime(date: Date): string {
    // Convert to Indonesia timezone (UTC+7)
    const indonesiaTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);

    const day = indonesiaTime.getUTCDate().toString().padStart(2, "0");
    const month = (indonesiaTime.getUTCMonth() + 1).toString().padStart(2, "0");
    const year = indonesiaTime.getUTCFullYear();
    const hours = indonesiaTime.getUTCHours().toString().padStart(2, "0");
    const minutes = indonesiaTime.getUTCMinutes().toString().padStart(2, "0");
    const seconds = indonesiaTime.getUTCSeconds().toString().padStart(2, "0");

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Setup header di spreadsheet (jika belum ada)
   */
  async setupHeaders() {
    try {
      const headers = [
        [
          "Unique Key",
          "ID Mesin",
          "Nama Mesin",
          "Jam Mulai",
          "Jam Beres",
          "Durasi Mesin",
          "Bekerja Trigger",
          "Waktu Tersimpan",
        ],
      ];

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: "Sheet1!A1:H1",
        valueInputOption: "RAW",
        requestBody: {
          values: headers,
        },
      });

      console.log("✅ Headers setup completed");
    } catch (error) {
      console.error("❌ Error setting up headers:", error);
    }
  }
}
