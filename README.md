# Laundry Monitor - TV Display

Sistem monitoring laundry untuk layar TV Full HD (1920×1080) yang menampilkan status mesin cuci dan pengering secara real-time.

## 🎯 Fitur Utama

- **Grid Layout**: 24 mesin (12 Dryer + 12 Washer) dalam grid 14×2 dengan posisi tetap
- **Status Monitoring**: Tersedia, Sedang Digunakan, Offline dengan warna berbeda
- **ETA Display**: Estimasi waktu selesai untuk maksimal 6 Dryer dan 6 Washer
- **Summary Statistics**: Persentase mesin tersedia vs digunakan per tipe
- **Hysteresis**: Mencegah "kedip" status dengan threshold 3 detik
- **Auto Refresh**: Update data setiap 8 detik
- **Responsive**: Optimized untuk layar TV Full HD

## 📁 Struktur File

```
laundry-monitor/
├── public/
│   └── index.html          # File HTML utama
├── styles/
│   └── main.css           # Styling CSS dengan grid layout
├── scripts/
│   ├── app.js             # Logic aplikasi utama
│   └── data.mock.js       # Data dummy 24 mesin
├── assets/
│   └── icons/
│       ├── washer.svg     # Icon mesin cuci
│       └── dryer.svg      # Icon pengering
└── README.md              # Dokumentasi
```

## 🎨 Desain UI

### Layout Grid

- **Kanvas**: 1920×1080 px dengan padding 32px
- **Font**: Plus Jakarta Sans dengan fallback system-ui/Arial
- **Grid**: 14 kolom × 2 baris, setiap sel 48×48px dengan gap 12px

### Warna Status

- 🟢 **Tersedia**: Hijau (#10B981) dengan fill tipis
- 🟠 **Sedang Digunakan**: Oranye (#F59E0B) dengan fill tegas
- ⚫ **Offline**: Abu-abu (#94A3B8) dengan border dashed merah

### Posisi Mesin (Grid Area)

```
TOP ROW:    D13 D12 D11 D10 D9  D8  D7  D6  D5  D4  D3  [gap] [gap] D2
BOTTOM ROW: W13 W12 W11 W10 W9  W8  W7  W6  W5  W4  [gap] W2   W1   D1
```

## 🚀 Cara Menjalankan

1. **Buka file HTML**:

   ```bash
   # Buka browser dan navigasi ke:
   file:///path/to/laundry-monitor/public/index.html

   # Atau gunakan local server:
   python -m http.server 8000
   # Lalu buka: http://localhost:8000/public/
   ```

2. **Untuk layar TV**: Buka di browser TV atau mirror dari komputer

## 📊 Data Structure

### Format Mock Data

```javascript
{
  id: "D1",           // ID mesin (D1-D12, W1-W12)
  type: "D",          // Tipe: "D" (Dryer) atau "W" (Washer)
  status: "USING",    // Status: "READY", "USING", "OFFLINE"
  eta: "14:30",       // Estimasi selesai (format HH:mm) atau null
  updated_at: "2025-09-19T09:31:00+07:00"  // Timestamp ISO
}
```

### Mapping API (untuk integrasi)

```javascript
// Field dari API real:
{
  id: "machine_001",
  nama: "D1",
  jenis: 2,                    // 1=Washer, 2=Dryer
  snap_report_device: {
    ol: true,                  // online status
    st: 0,                     // status angka
    pow: 1500                  // daya dalam watt
  },
  updated_at: "2025-09-19T09:31:00+07:00"
}
```

## ⚙️ Konfigurasi

### Polling Interval

```javascript
// Di app.js, line ~280
setInterval(() => {
  updateData();
  renderEta();
  renderSummary();
  renderUpdatedAt();
}, 8000); // 8 detik
```

### Hysteresis Threshold

```javascript
// Di app.js, line ~15
const HYSTERESIS_THRESHOLD = 3000; // 3 detik
```

### Grid Mapping

```javascript
// Di app.js, line ~20-50
const MACHINE_GRID_MAPPING = {
  D1: "div1", // Posisi grid CSS
  D2: "div2",
  // ... dst
};
```

## 🔌 Integrasi API

Untuk menggunakan API real (bukan mock data):

1. **Uncomment fetch function** di `app.js` (line ~300-400)
2. **Update endpoint** di function `fetchMachines()`:
   ```javascript
   const response = await fetch("/machines"); // Ganti dengan URL API Anda
   ```
3. **Map data** sesuai format API Anda di function `mapFromApi()`

### Aturan Status dari API

- **OFFLINE**: `snap_report_device.ol == false`
- **SEDANG DIGUNAKAN**: `ol == true && (st != 0 || pow > 0)`
- **TERSEDIA**: `ol == true && st == 0 && pow == 0`

## 🎛️ Panel Kontrol

### Status Legend

Menampilkan legenda warna untuk setiap status mesin

### Estimasi Waktu

- **Kolom Kiri**: Maksimal 6 Dryer yang sedang digunakan
- **Kolom Kanan**: Maksimal 6 Washer yang sedang digunakan
- **Format**: `D1 ⇒ 14:30` atau `—` jika tidak ada

### Ringkasan

- **Dryer**: Persentase tersedia vs digunakan (dibulatkan ke 10)
- **Washer**: Persentase tersedia vs digunakan (dibulatkan ke 10)
- **Timestamp**: "Terakhir diperbarui: HH:mm:ss"

## 🔧 Troubleshooting

### Masalah Umum

1. **Grid tidak tampil**:

   - Pastikan `data.mock.js` dimuat sebelum `app.js`
   - Check console untuk error JavaScript

2. **Status tidak update**:

   - Pastikan polling interval berjalan (8 detik)
   - Check mock data update di `data.mock.js`

3. **Layout tidak sesuai**:

   - Pastikan browser support CSS Grid
   - Check viewport size (harus 1920×1080)

4. **Font tidak tampil**:
   - Pastikan koneksi internet untuk Google Fonts
   - Font akan fallback ke system-ui/Arial

### Browser Compatibility

- ✅ Chrome 60+
- ✅ Firefox 55+
- ✅ Safari 12+
- ✅ Edge 79+

## 📝 Changelog

### v1.0.0 (2025-09-19)

- ✅ Grid layout 14×2 dengan posisi tetap
- ✅ 24 mesin dummy dengan variasi status
- ✅ Hysteresis untuk mencegah "kedip"
- ✅ Panel ETA dengan 6 Dryer + 6 Washer
- ✅ Summary statistics per tipe
- ✅ Auto refresh setiap 8 detik
- ✅ Responsive untuk layar TV Full HD
- ✅ API integration ready (commented)

## 📄 License

MIT License - Silakan gunakan dan modifikasi sesuai kebutuhan.

## 🤝 Kontribusi

Untuk fitur tambahan atau bug report, silakan buat issue atau pull request.

---

**Dibuat untuk**: Monitoring Laundry TV Display  
**Target Platform**: Browser di layar TV Full HD  
**Update Terakhir**: 19 September 2025
