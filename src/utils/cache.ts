import type {
  MachineSnapshot,
  TransactionSummary,
  LeaderboardResponse,
} from "../types.js";

// Machine snapshot cache
let machineSnapshot: MachineSnapshot | null = null;
let lastMachineSuccessTime: number | null = null;

// Transaction cache
let dashboardSummaryCache: TransactionSummary | null = null;
let dashboardTransactionsCache: any = null;
let lastDashboardSuccessTime: number | null = null;

// Leaderboard cache
const frequencyLeaderboardCache = new Map<string, LeaderboardResponse>();
const revenueLeaderboardCache = new Map<string, LeaderboardResponse>();
let lastLeaderboardSuccessTime: number | null = null;

// Events leaderboard cache
const eventsLeaderboardCacheData = new Map<string, any>();
let lastEventsLeaderboardSuccessTime: number | null = null;

// Machine snapshot
export const machineCache = {
  get: () => machineSnapshot,
  set: (snapshot: MachineSnapshot) => {
    machineSnapshot = snapshot;
    lastMachineSuccessTime = Date.now();
  },
  getLastSuccessTime: () => lastMachineSuccessTime,
  setLastSuccessTime: (time: number) => {
    lastMachineSuccessTime = time;
  },
};

// Transaction cache
export const transactionCache = {
  summary: {
    get: () => dashboardSummaryCache,
    set: (data: TransactionSummary) => {
      dashboardSummaryCache = data;
      lastDashboardSuccessTime = Date.now();
    },
  },
  list: {
    get: () => dashboardTransactionsCache,
    set: (data: any) => {
      dashboardTransactionsCache = data;
      lastDashboardSuccessTime = Date.now();
    },
  },
  getLastSuccessTime: () => lastDashboardSuccessTime,
};

// Leaderboard cache
export const leaderboardCache = {
  frequency: {
    get: (key = "default") => frequencyLeaderboardCache.get(key) || null,
    set: (data: LeaderboardResponse, key = "default") => {
      frequencyLeaderboardCache.set(key, data);
      lastLeaderboardSuccessTime = Date.now();
    },
  },
  revenue: {
    get: (key = "default") => revenueLeaderboardCache.get(key) || null,
    set: (data: LeaderboardResponse, key = "default") => {
      revenueLeaderboardCache.set(key, data);
      lastLeaderboardSuccessTime = Date.now();
    },
  },
  getLastSuccessTime: () => lastLeaderboardSuccessTime,
};

// Events leaderboard cache
export const eventsLeaderboardCache = {
  get: (key = "default") => eventsLeaderboardCacheData.get(key) || null,
  set: (data: any, key = "default") => {
    eventsLeaderboardCacheData.set(key, data);
    lastEventsLeaderboardSuccessTime = Date.now();
  },
  getLastSuccessTime: () => lastEventsLeaderboardSuccessTime,
};
