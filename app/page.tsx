"use client";

// app/page.tsx
// - 첫 랜딩 페이지 (업무 프로세스 지원툴 소개 + 로그인)
// - Google 로그인 성공 시 /convert로 이동
// - Firebase는 NEXT_PUBLIC_* 환경변수 기반

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  User,
} from "firebase/auth";

/** Firebase Auth 싱글톤 */
function getFirebaseAuth() {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const required = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.appId,
  ];

  if (required.some((v) => !v)) {
    throw new Error(
      "Firebase 환경변수가 누락되었습니다. NEXT_PUBLIC_FIREBASE_* 값을 확인해주세요."
    );
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getAuth(app);
}

export default function HomePage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Firebase 초기화 오류");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) router.replace("/convert");
    });

    return () => unsub();
  }, [auth, router]);

  const handleGoogleLogin = async () => {
    try {
      setErrorMsg("");
      if (!auth) return;

      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "로그인 중 오류가 발생했습니다.");
    }
  };

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">Datalign</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              업무 프로세스 지원툴
            </div>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {loading ? "상태 확인 중..." : user ? "로그인됨" : "로그인 필요"}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section className="rounded-2xl border p-8">
            <h1 className="text-2xl font-bold">
              데이터 업무를 더 빠르고 안전하게
            </h1>
            <p className="mt-4 text-gray-700 dark:text-gray-200">
              데이터 변환, 정합성 확인, 문서화를 하나의 워크스페이스에서
              처리하세요.
            </p>
          </section>

          <section className="rounded-2xl border p-8">
            <h2 className="text-xl font-bold">로그인</h2>

            {errorMsg && (
              <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="mt-6 w-full rounded-xl bg-gray-900 px-4 py-3 text-white dark:bg-white dark:text-gray-900"
            >
              Google로 로그인
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
