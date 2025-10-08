// Machine Configuration Constants
export const MACHINE_CONFIG = {
  // Machine ID to Label mapping
  machineLabels: {
    D48AFC354603: "D05",
    D48AFC325A64: "D07",
    "2CF4321072A5": "D01",
    "68C63AFC13FA": "D02",
    "483FDA643B85": "D03",
    "48E7296DE4BF": "D04",
    D48AFC35465C: "D06",
    D48AFC31F4C0: "D08",
    D48AFC354357: "D09",
    BCDDC248DF58: "D10",
    C82B961E9BF3: "D11",
    "8CCE4EF44A99": "D12",
    "9C9C1F410120": "W01",
    "98F4ABD8506A": "W02",
    "8CAAB5D53E39": "W03",
    "84F3EB6ED32F": "W04",
    "483FDA69F7C5": "W05",
    "483FDA077794": "W06",
    "807D3A4E5A46": "W07",
    "5CCF7FDBB498": "W08",
    "483FDA6AFDC7": "W10",
    "500291EB8F36": "W09",
    A4CF12F307D1: "W11",
    "68C63AFC1863": "W12",
  },

  // Machine Label to Brand mapping
  machineBrands: {
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
  },

  // Machine Label to Max Weight mapping (all set to 10kg)
  machineMaxWeight: {
    // Dryers
    D01: 10,
    D02: 10,
    D03: 10,
    D04: 10,
    D05: 10,
    D06: 10,
    D07: 10,
    D08: 10,
    D09: 10,
    D10: 10,
    D11: 10,
    D12: 10,

    // Washers
    W01: 10,
    W02: 10,
    W03: 10,
    W04: 10,
    W05: 10,
    W06: 10,
    W07: 10,
    W08: 10,
    W09: 10,
    W10: 10,
    W11: 10,
    W12: 10,
  },

  // Machine Label to Type mapping
  machineTypes: {
    // Dryers
    D01: "dryer",
    D02: "dryer",
    D03: "dryer",
    D04: "dryer",
    D05: "dryer",
    D06: "dryer",
    D07: "dryer",
    D08: "dryer",
    D09: "dryer",
    D10: "dryer",
    D11: "dryer",
    D12: "dryer",

    // Washers
    W01: "washer",
    W02: "washer",
    W03: "washer",
    W04: "washer",
    W05: "washer",
    W06: "washer",
    W07: "washer",
    W08: "washer",
    W09: "washer",
    W10: "washer",
    W11: "washer",
    W12: "washer",
  },
};

// Helper functions
export const getMachineLabel = (machineId) => {
  return MACHINE_CONFIG.machineLabels[machineId] || machineId;
};

export const getMachineBrand = (machineLabel) => {
  return MACHINE_CONFIG.machineBrands[machineLabel] || "Unknown";
};

export const getMachineMaxWeight = (machineLabel) => {
  return MACHINE_CONFIG.machineMaxWeight[machineLabel] || 10;
};

export const getMachineType = (machineLabel) => {
  return MACHINE_CONFIG.machineTypes[machineLabel] || "unknown";
};

export const getAllMachineIds = () => {
  return Object.keys(MACHINE_CONFIG.machineLabels);
};

export const getMachinesByType = (type) => {
  return Object.entries(MACHINE_CONFIG.machineTypes)
    .filter(([label, machineType]) => machineType === type)
    .map(([label]) => label);
};

export const getDryerMachines = () => {
  return getMachinesByType("dryer");
};

export const getWasherMachines = () => {
  return getMachinesByType("washer");
};
