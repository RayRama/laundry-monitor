/**
 * Mock data untuk Laundry Monitor
 * 24 mesin: 12 Dryer (D1-D12) + 12 Washer (W1-W12)
 * Wajib ada 6 USING Dryer dan 6 USING Washer untuk panel ETA
 */

// Fungsi helper untuk generate ETA waktu realistis
function generateETA() {
  const now = new Date();
  const minutes = Math.floor(Math.random() * 60) + 5; // 5-65 menit
  const finishTime = new Date(now.getTime() + minutes * 60000);
  return finishTime.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Fungsi helper untuk generate timestamp
function generateTimestamp() {
  const now = new Date();
  return now.toISOString();
}

// Mock data 24 mesin dengan variasi status
window.MOCK_MACHINES = [
  // DRYER (D1-D12) - 6 harus USING untuk ETA
  {
    id: "D1",
    type: "D",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "D2",
    type: "D",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "D3",
    type: "D",
    status: "OFFLINE",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "D4",
    type: "D",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "D5",
    type: "D",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "D6",
    type: "D",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "D7",
    type: "D",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "D8",
    type: "D",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "D9",
    type: "D",
    status: "OFFLINE",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "D10",
    type: "D",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "D11",
    type: "D",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "D12",
    type: "D",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },

  // WASHER (W1-W12) - 6 harus USING untuk ETA
  {
    id: "W1",
    type: "W",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "W2",
    type: "W",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "W3",
    type: "W",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "W4",
    type: "W",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "W5",
    type: "W",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "W6",
    type: "W",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "W7",
    type: "W",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "W8",
    type: "W",
    status: "OFFLINE",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "W9",
    type: "W",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "W10",
    type: "W",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
  {
    id: "W11",
    type: "W",
    status: "READY",
    eta: null,
    updated_at: generateTimestamp(),
  },
  {
    id: "W12",
    type: "W",
    status: "USING",
    eta: generateETA(),
    updated_at: generateTimestamp(),
  },
];

// Fungsi untuk update mock data (simulasi perubahan status)
window.updateMockData = function () {
  const machines = window.MOCK_MACHINES;

  machines.forEach((machine) => {
    // Simulasi perubahan status acak (10% chance)
    if (Math.random() < 0.1) {
      const statuses = ["READY", "USING", "OFFLINE"];
      const currentIndex = statuses.indexOf(machine.status);
      let newIndex;

      // Pastikan tidak sama dengan status sebelumnya
      do {
        newIndex = Math.floor(Math.random() * statuses.length);
      } while (newIndex === currentIndex && statuses.length > 1);

      machine.status = statuses[newIndex];

      // Update ETA jika status berubah ke USING
      if (machine.status === "USING") {
        machine.eta = generateETA();
      } else {
        machine.eta = null;
      }

      machine.updated_at = generateTimestamp();
    }

    // Update ETA untuk mesin yang sedang USING (simulasi countdown)
    if (machine.status === "USING" && machine.eta) {
      // Kadang-kadang update ETA (30% chance)
      if (Math.random() < 0.3) {
        machine.eta = generateETA();
        machine.updated_at = generateTimestamp();
      }
    }
  });
};

// Simulasi perubahan data setiap 15 detik
setInterval(() => {
  window.updateMockData();
}, 15000);

console.log("Mock data loaded:", window.MOCK_MACHINES.length, "machines");
