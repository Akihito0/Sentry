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

## 📦 Installation

1. Clone the repository:

    ```bash
   git clone https://github.com/your-username/sentry.git

Open your browser’s Extension Manager.

Enable Developer Mode.

Click Load unpacked and select the project folder.

The extension should now be active in your browser.

🔑 Setup Gemini API
Sentry uses Google Gemini AI for content detection.

Go to Google AI Studio.

Sign in with your Google account.

Create an API key.

In your project folder, create a .env file and add your key:

bash
Copy code
GEMINI_API_KEY=your_api_key_here
In the code, make sure to load the key (example in Node.js):

javascript
Copy code
import 'dotenv/config';
const apiKey = process.env.GEMINI_API_KEY;
Never commit your .env file – it should be listed in .gitignore.

🚧 Roadmap

 Set up extension structure (manifest, permissions, popup UI)

 Integrate Gemini AI for text and image analysis

 Implement content blurring (images, text, video previews)

 Add phishing & scam detection

 Create family manager dashboard (parent notifications)

 Optimize AI detection with feedback loop

🤝 Contributing

Contributions are welcome! Please fork the repo and submit a pull request.

👥 Team Members

Cabandon, Jordan – Project Lead / Full-stack Development

Claudio, Karl Jovanne – Backend & AI Integration

Suan, Noah Gabriel – Frontend & UI/UX
