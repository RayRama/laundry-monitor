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
let frequencyLeaderboardCache: LeaderboardResponse | null = null;
let revenueLeaderboardCache: LeaderboardResponse | null = null;
let lastLeaderboardSuccessTime: number | null = null;

// Events leaderboard cache
let eventsLeaderboardCacheData: any = null;
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
    get: () => frequencyLeaderboardCache,
    set: (data: LeaderboardResponse) => {
      frequencyLeaderboardCache = data;
      lastLeaderboardSuccessTime = Date.now();
    },
  },
  revenue: {
    get: () => revenueLeaderboardCache,
    set: (data: LeaderboardResponse) => {
      revenueLeaderboardCache = data;
      lastLeaderboardSuccessTime = Date.now();
    },
  },
  getLastSuccessTime: () => lastLeaderboardSuccessTime,
};

// Events leaderboard cache
export const eventsLeaderboardCache = {
  get: () => eventsLeaderboardCacheData,
  set: (data: any) => {
    eventsLeaderboardCacheData = data;
    lastEventsLeaderboardSuccessTime = Date.now();
  },
  getLastSuccessTime: () => lastEventsLeaderboardSuccessTime,
};
