// lib/firebase/firebase.ts
// Firebase 초기화 및 Firestore(db), Auth(auth) export
// - 기존에 db만 쓰던 코드 영향 최소화를 위해 db export는 유지합니다.
// - Project 생성/관리 기능에서 auth가 필요하므로 auth도 함께 export 합니다.
// - NEXT_PUBLIC_FIREBASE_* 환경변수는 Vercel/로컬 모두에 설정되어 있어야 합니다.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Firebase 설정 (환경변수 기반)
// ⚠️ 환경변수 이름은 현재 파일에 있던 형태를 그대로 유지합니다.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, // Firebase API Key
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, // Auth Domain
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, // Project ID
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, // Storage Bucket
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, // Sender ID
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID, // App ID
};

// 이미 초기화된 앱이 있으면 재사용(핫리로드/중복초기화 방지)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Firestore/Auth 인스턴스 export
export const db = getFirestore(app);
export const auth = getAuth(app);

// (필요시) app도 외부에서 쓸 수 있도록 export
export { app };
