# Japan MEXT Scholarship Supervisor Outreach & LoA Tracker

<div align="center">

[![Live Web App](https://img.shields.io/badge/Live_App-mexttracker.netlify.app-00a2ff?style=for-the-badge&logo=netlify&logoColor=white)](https://mexttracker.netlify.app/)
[![Google Apps Script](https://img.shields.io/badge/Backend-Google_Apps_Script-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Google Sheets](https://img.shields.io/badge/Database-Google_Sheets-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)](https://www.google.com/sheets/about/)
[![Gmail API](https://img.shields.io/badge/Sync-Gmail_API-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](https://mail.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

**An automated academic CRM and correspondence tracker tailored for Japanese Government (MEXT / Monbukagakusho) Scholarship applicants.**

Connect your own Google Sheet and Gmail to use the hosted web app, track professor correspondence automatically, and export your data to Excel.

[Launch Web App](https://mexttracker.netlify.app/) | [Report Issue](https://github.com/khizarlatif/MEXT_Tracker/issues)

</div>

---

## What is MEXT Tracker?

Securing a **Letter of Acceptance (LoA)** from a prospective professor (Sensei) at a Japanese university (The University of Tokyo, Kyoto University, Osaka University, Tohoku University, Tokyo Tech, etc.) is the most critical milestone for both **Embassy Recommendation** and **University Recommendation** tracks of the MEXT scholarship.

**MEXT Tracker provides a ready-to-use hosted web dashboard that connects directly to your own Google Sheet and Gmail:**
- **Hosted App:** Ready to use immediately at [mexttracker.netlify.app](https://mexttracker.netlify.app/) (no installation or hosting required).
- **Your Data Stays Yours:** All professor profiles, interaction logs, and notes live securely in your private Google Sheet and Gmail account.
- **Automated Tracking:** Background scripts automatically scan your Gmail for replies from professors, clean email quotes, and update interaction statuses.
- **Excel Export:** Download your entire outreach tracker as an Excel spreadsheet (`.xlsx`) at any time.

---

## Features

- **MEXT Outreach KPI Dashboard:** Live metrics tracking total Sensei contacted, response rate %, LoA acquisition count, and pending follow-ups.
- **Automated Gmail Synchronization:** Runs every 8 hours in the background to scan for incoming replies and update interaction statuses.
- **Email Quote Cleaning:** Strips Japanese and English quotation headers, forwarded dividers, and mobile signatures.
- **Status Pipeline:** Classifies interactions into Not Contacted, Awaiting Reply, Action Required, Accepted (LoA), Ignored, Rejected, or Ghosted.
- **Offline Caching:** Powered by IndexedDB so your dashboard loads instantly even with slow internet.
- **1-Click Excel Backup:** Export your entire professor database directly into an Excel (`.xlsx`) workbook at any time.

---

## Quick Setup: How to Use with Your Own Google Sheet

You do **not** need to deploy or host any web application. The web app is already live at [mexttracker.netlify.app](https://mexttracker.netlify.app/). Follow these 3 steps to connect your own sheet and script:

### Step 1: Create Your Google Sheet
1. Create a new Google Sheet at [sheets.new](https://sheets.new).
2. Set the sheet tab name to `Sheet1`.
3. Add the following column headers in Row 1:
   ```text
   Professor | University | Research Interest | Email | Linked_Email | Email_Logs | Last_Contact | Thread_State | Notes | Reply_Status
   ```

### Step 2: Add the Background Script ("The Brain")
1. In your Google Sheet, click **Extensions** > **Apps Script**.
2. Replace any default code with the contents of [`backend_template.js`](backend_template.js).
3. At the top of the file, fill in your Google Sheet URL and your Gmail address:
   ```javascript
   var TRACKER_SHEET_URL         = "PASTE_YOUR_GOOGLE_SHEET_URL_HERE";
   var TRACKER_SHEET_NAME        = "Sheet1";
   var TRACKER_USER_EMAIL        = "your.email@gmail.com";
   var IGNORED_DAYS_THRESHOLD         = 14;
   var ACTION_REQUIRED_DAYS_THRESHOLD = 7;
   ```
4. Click **Deploy** > **New deployment**.
5. Select type **Web app**:
   - **Execute as:** `Me (your account)`
   - **Who has access:** `Anyone`
6. Click **Deploy**, authorize the permissions, and **copy your Web App URL** (looks like `https://script.google.com/macros/s/.../exec`).

#### Enable Automatic 24/7 Gmail Sync:
1. In the Apps Script left sidebar, click the **Triggers (clock icon)**.
2. Click **Add Trigger** (bottom right):
   - **Choose which function to run:** `syncRecent`
   - **Select event source:** `Time-driven`
   - **Type of time based trigger:** `Hour timer` -> `Every 8 hours`
3. Click **Save**.

### Step 3: Connect to the Live Web App
1. Open [mexttracker.netlify.app](https://mexttracker.netlify.app/).
2. Click the **API Settings** button in the navigation bar.
3. Paste your **Web App URL** from Step 2 and click **Save**.
4. That is it! Your personal dashboard is connected:
   - Add professors directly from the app or from your Google Sheet.
   - Click **Run Sync** to scan your Gmail on demand.
   - Click **Export to Excel** to download your spreadsheet.

---

## Status Classification Guide

| Status | Meaning |
| :--- | :--- |
| **Not Contacted** | Newly added professor profile; no outreach email sent yet. |
| **Awaiting Reply** | Outreach email sent; waiting for Sensei response (within 14 days). |
| **Action Required** | Sensei has replied and awaits your answer, or follow-up is overdue (> 7 days). |
| **Accepted** | Informal consent, interview offer, or Letter of Acceptance (LoA) obtained. |
| **Ignored** | No reply received after 14 days. |
| **Rejected** | Laboratory capacity full or research alignment mismatch. |
| **Ghosted** | Communication stalled after initial interest. |

---

## Privacy & Security

- **Your data stays in your control:** The web app runs client-side in your browser. All records are stored exclusively in your own Google Sheet and your own Gmail account.
- **No third-party database:** Nothing is stored on external servers or Netlify databases.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

<div align="center">

Built by [Khizar Latif](https://github.com/khizarlatif)

</div>
