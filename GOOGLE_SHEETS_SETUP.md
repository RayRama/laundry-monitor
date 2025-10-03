# Google Sheets Integration Setup

## 📊 Overview

Sistem ini akan otomatis menyimpan data mesin laundry ke Google Spreadsheet dengan format:

| ID Mesin | Nama Mesin | Jam Mulai | Jam Beres | Durasi Mesin | Bekerja Trigger |
| -------- | ---------- | --------- | --------- | ------------ | --------------- |
| W1       | BEKO       | 12:41:55  | 13:15:30  | 00:33:35     | Smart Owner     |
| D1       | TITAN      | 12:45:10  | 13:20:45  | 00:35:35     | Payment         |

## 🔧 Setup Steps

### 1. Buat Google Cloud Project

1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat project baru atau pilih project yang ada
3. Enable Google Sheets API

### 2. Buat Service Account

1. Di Google Cloud Console, buka "IAM & Admin" > "Service Accounts"
2. Klik "Create Service Account"
3. Beri nama: `laundry-monitor-sheets`
4. Klik "Create and Continue"
5. Skip role assignment untuk sekarang
6. Klik "Done"

### 3. Generate Credentials

1. Klik service account yang baru dibuat
2. Buka tab "Keys"
3. Klik "Add Key" > "Create new key"
4. Pilih "JSON" dan download file credentials

### 4. Setup Spreadsheet

1. Buat Google Spreadsheet baru
2. Share spreadsheet dengan email service account (dari file JSON: `client_email`)
3. Beri permission "Editor"
4. Copy Spreadsheet ID dari URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

### 5. Environment Variables

Tambahkan ke `.env.local`:

```bash
# Google Sheets Integration
GOOGLE_SPREADSHEET_ID=your-spreadsheet-id-here
GOOGLE_CREDENTIALS_PATH=./credentials/google-credentials.json
```

### 6. File Structure

```
laundry-monitor/
├── credentials/
│   └── google-credentials.json  # File dari step 3
├── .env.local                   # Environment variables
└── ...
```

## 🎯 How It Works

### Event Detection

- **Mesin Mulai Running**: Sistem detect perubahan status READY → RUNNING
- **Mesin Selesai**: Sistem detect perubahan status RUNNING → READY
- **Data Collection**: Kumpulkan ID, nama, jam mulai/beres, durasi, trigger

### Trigger Mapping

- `aid: "BOS"` → `"Smart Owner"`
- `aid: "PAYMENT"` → `"Payment"`
- `aid: "CARD"` → `"Payment"`
- `aid: "COIN"` → `"Payment"`
- `aid: "MANUAL"` → `"Manual"`
- `aid: "UNKNOWN"` → `"Unknown"`

### Duration Calculation

Durasi dihitung otomatis: `Jam Beres - Jam Mulai`

## 🚀 Testing

1. Start server: `npm run dev`
2. Check logs untuk: `✅ Google Sheets integration initialized`
3. Test dengan mesin running di laundry
4. Cek spreadsheet untuk data baru

## 🔍 Troubleshooting

### Error: "Google Sheets not configured"

- Pastikan environment variables sudah di-set
- Cek file credentials ada dan valid

### Error: "Failed to setup Google Sheets"

- Pastikan service account punya akses ke spreadsheet
- Cek spreadsheet ID benar
- Cek file credentials valid

### Data tidak muncul di spreadsheet

- Cek console logs untuk error
- Pastikan mesin benar-benar berubah status
- Cek network connectivity ke Google API
