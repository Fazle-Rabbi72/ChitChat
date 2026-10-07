# 🚀 AuraChat Full Deployment Guide

এই অ্যাপ্লিকেশনে দুটি অংশ রয়েছে:
1. **Frontend (`chat-frontend`)**: React + Vite (এটি সরাসরি **Vercel**-এ ডিপ্লয় হবে)।
2. **Backend (`chat-backend`)**: FastAPI + persistent WebSockets + WebRTC Signaling (এটি **Render.com**-এ ডিপ্লয় করতে হবে)।
3. **Database**: **Neon PostgreSQL** (ইতিমধ্যেই ক্লাউডে সক্রিয় রয়েছে)।

> ⚠️ **কেন ব্যাকএন্ড Vercel-এ চলবে না?**
> Vercel হলো একটি **Serverless** প্ল্যাটফর্ম। এর ফাংশনগুলো ১০-১৫ সেকেন্ড পর স্বয়ংক্রিয়ভাবে বন্ধ হয়ে যায়। কিন্তু আমাদের চ্যাট অ্যাপে অডিও/ভিডিও কল, সার্বক্ষণিক অ্যাক্টিভ/অফলাইন স্ট্যাটাস এবং ইনস্ট্যান্ট মেসেজিংয়ের জন্য **WebSocket (wss://)** সার্বক্ষণিক কানেক্টেড থাকতে হয়। তাই ব্যাকএন্ড **Render.com** (সম্পূর্ণ ফ্রি) এবং ফ্রন্টএন্ড **Vercel**-এ ডিপ্লয় করাই ইন্ডাস্ট্রি স্ট্যান্ডার্ড ও বেস্ট আর্কিটেকচার।

---

## ধাপ ১: গিটহাব (GitHub)-এ প্রজেক্ট আপলোড করুন

আপনার টার্মিনালে এই কমান্ডগুলো চালিয়ে প্রজেক্টটি গিটহাবে পুশ করুন:

```bash
git init
git add .
git commit -m "feat: complete chat app with realtime presence, calls, and delivery status"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git
git push -u origin main
```

---

## ধাপ ২: ব্যাকএন্ড ডিপ্লয় করুন (Render.com - সম্পূর্ণ ফ্রি)

1. [Render.com](https://render.com)-এ যান এবং আপনার GitHub একাউন্ট দিয়ে **Sign In** করুন।
2. **New +** বাটনে ক্লিক করে **Web Service** সিলেক্ট করুন।
3. আপনার চ্যাট অ্যাপের GitHub Repository সিলেক্ট করুন।
4. নিচের সেটিংসগুলো দিন:
   - **Name**: `aurachat-backend` (বা যেকোনো নাম)
   - **Root Directory**: `chat-backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: **Free**
5. নিচে **Advanced** -> **Add Environment Variable**-এ ক্লিক করে ৩টি ভ্যারিয়েবল যোগ করুন:
   - `DATABASE_URL` = `postgresql://neondb_owner:npg_9DEAuOVIvwx4@ep-cold-lab-b4f5z4j3-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
   - `SECRET_KEY` = `AURA_CHAT_SUPER_SECRET_PRODUCTION_KEY_2026`
   - `IMGBB_API_KEY` = `6f2066a27370f245f424cffff0bffd64`
6. **Deploy Web Service**-এ ক্লিক করুন।
7. ২-৩ মিনিট পর ডিপ্লয় সম্পন্ন হলে Render আপনাকে একটি লাইভ URL দিবে, যেমন:
   `https://aurachat-backend.onrender.com`

---

## ধাপ ৩: ফ্রন্টএন্ড ডিপ্লয় করুন (Vercel)

1. [Vercel.com](https://vercel.com)-এ যান এবং GitHub দিয়ে **Log In** করুন।
2. **Add New...** -> **Project**-এ ক্লিক করুন।
3. আপনার GitHub Repository সিলেক্ট করে **Import** করুন।
4. Configure Project সেকশনে:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `chat-frontend` সিলেক্ট করুন (Edit-এ ক্লিক করে `chat-frontend` সিলেক্ট করে Continue চাপুন)।
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. **Environment Variables** এক্সপ্যান্ড করে এই ২টি ভ্যারিয়েবল দিন (Render থেকে পাওয়া আপনার ব্যাকএন্ড URL বসাবেন):
   - `VITE_API_URL` = `https://aurachat-backend.onrender.com`
   - `VITE_WS_URL` = `wss://aurachat-backend.onrender.com/ws` (খেয়াল করুন: `https` এর বদলে `wss`)
6. **Deploy** বাটনে ক্লিক করুন!

🎉 মাত্র ১ মিনিটের মধ্যে আপনার ফ্রন্টএন্ড Vercel-এ লাইভ হয়ে যাবে এবং একটি লিংক পাবেন (যেমন: `https://your-chat-app.vercel.app`)!

---

## টেস্ট এবং ভেরিফিকেশন চেকলিস্ট
- [ ] Vercel লিংকে গিয়ে রেজিস্ট্রেশন / লগইন করুন।
- [ ] অপর একটি ব্রাউজার বা ট্যাবে দ্বিতীয় ইউজার দিয়ে লগইন করে রিয়েলটাইম চ্যাট টেস্ট করুন।
- [ ] অনলাইন থাকলে `✓✓ Delivered` এবং মেসেজ দেখলে `✓✓ Seen` (নীল টিক) চেক করুন।
- [ ] ছবি বা ফাইল সিলেক্ট করে প্রিভিউ চেক করুন (Send বাটনে চাপার পর সেন্ড হবে)।
- [ ] Delete for everyone এবং Delete for me টেস্ট করুন।
- [ ] অডিও ও ভিডিও কল টেস্ট করুন।
