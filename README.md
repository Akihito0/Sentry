# 🔒 Sentry

**Sentry** is a browser extension that helps families stay safe online by **blurring inappropriate content**, **blocking phishing and scam links**, and **notifying parents** when children encounter unsafe digital material.  

---

## 🌟 Features

- 🛡️ **Blur Inappropriate Content** – Automatically detects and blurs unsafe/explicit images and text.  
- 🚨 **Phishing & Scam Protection** – Warns users when visiting suspicious or malicious websites.  
- 👨‍👩‍👧 **Family Manager** – Sends real-time notifications to parents if children encounter harmful content.  
- 🤖 **Powered by Gemini AI** – Uses Google’s Gemini AI for free OCR and content analysis.  

---

## 🏗️ Tech Stack

- **Frontend**: JavaScript (Browser Extension APIs)  
- **AI/Detection**: Google Gemini AI (for text/image analysis)  
- **Backend (optional)**: Node.js / Express (for parent notification service)  

---

## 📦 Installation & Setup

### Prerequisites

- **Node.js** (v16 or higher)
- **Python** (v3.8 or higher)
- **npm** (comes with Node.js)

### Quick Start (One Command)

1. **Install all dependencies:**
   ```bash
   npm run install-all
   ```

2. **Set up Gemini API Key:**
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create an API key
   - Create a file `backend/.env` and add:
     ```
     GEMINI_API_KEY=your_api_key_here
     ```

3. **Start both backend and frontend with one command:**

   **Windows:**
   ```bash
   start.bat
   ```
   
   **Mac/Linux:**
   ```bash
   npm start
   ```
   
   Or use Node.js directly:
   ```bash
   node start.js
   ```

   This will start:
   - **Backend**: FastAPI server on `http://localhost:8000`
   - **Frontend**: Vite dev server (check console for URL)

### Manual Setup (Alternative)

If you prefer to run services separately:

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend:**
```bash
cd extension/ai-extension
npm install
npm run dev
```

### Load Extension in Browser

1. Open your browser's Extension Manager (Chrome: `chrome://extensions/`)
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select the `extension/ai-extension` folder (or `extension/ai-extension/dist` if built)
5. The extension should now be active in your browser

## 🔑 Environment Variables

Create `backend/.env` with:
```
GEMINI_API_KEY=your_api_key_here
```

**Never commit your .env file** – it should be listed in `.gitignore`.

## 🚧 Roadmap

 Set up extension structure (manifest, permissions, popup UI)

 Integrate Gemini AI for text and image analysis

 Implement content blurring (images, text, video previews)

 Add phishing & scam detection

 Create family manager dashboard (parent notifications)

 Optimize AI detection with feedback loop

## 🤝 Contributing

Contributions are welcome! Please fork the repo and submit a pull request.

## 👥 Team Members

- Cabandon, Jordan – Project Lead / Full-stack Development

- Claudio, Karl Jovanne – Backend & AI Integration

- Suan, Noah Gabriel – Frontend & UI/UX
