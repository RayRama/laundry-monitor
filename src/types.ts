export interface MachineSnapshot {
  machines: Machine[];
  summary: {
    dryer: MachineSummary;
    washer: MachineSummary;
  };
  meta: {
    ts: string;
    stale: boolean;
    version: string;
    timezone?: string;
    utc_offset?: string;
    screen_info?: {
      breakpoints: {
        mobile: number;
        tablet: number;
        desktop: number;
        tv: number;
      };
    };
  };
}

export interface Machine {
  id: string;
  type: "washer" | "dryer";
  label: string;
  slot: string;
  status: "READY" | "RUNNING" | "OFFLINE";
  updated_at: string | null;
  aid?: string;
  tl?: number;
  dur?: number;
}

export interface MachineSummary {
  total: number;
  ready: number;
  running: number;
  offline: number;
}

export interface TransactionSummary {
  data: {
    total_nota?: number;
    jumlah?: number;
    [key: string]: any;
  };
}

export interface Transaction {
  idtransaksi: string;
  [key: string]: any;
}

export interface LeaderboardEntry {
  rank: number;
  machineId: string;
  machineLabel: string;
  frequency: number;
  totalRevenue: number;
  lastTransaction: string | null;
}

export interface LeaderboardResponse {
  success: boolean;
  data: LeaderboardEntry[];
  total_machines: number;
  total_revenue?: number;
  period: {
    filterBy: string;
    bulan?: string;
    tanggalAwal?: string;
    tanggalAkhir?: string;
  };
}

