// lib/firebase/firebase.ts
// Firebase 초기화 및 Firestore(db) export
// - app/user/page.tsx 등에서 db를 import 해서 사용합니다.
// - NEXT_PUBLIC_FIREBASE_* 환경변수는 Vercel/로컬 모두에 설정되어 있어야 합니다.

import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Firebase 설정 (환경변수 기반)
// ⚠️ 아래 환경변수 이름은 일반적인 Firebase 웹 설정 키입니다.
//    프로젝트에 이미 사용 중인 키 이름이 다르면 그 이름에 맞춰 변경해 주세요.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, // Firebase API Key
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, // Auth Domain
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, // Project ID
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, // Storage Bucket
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, // Sender ID
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID, // App ID
};

// 이미 초기화된 앱이 있으면 재사용(핫리로드/중복초기화 방지)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Firestore 인스턴스 export
export const db = getFirestore(app);
