'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Cloudflare Access はエッジで認証を処理するため、このページは不要。
// 万が一 /auth/callback へアクセスされた場合はトップへリダイレクトする。
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen text-gray-500">
      リダイレクト中...
    </div>
  );
}
