'use client';

import { useEffect, useState } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState('');

  useEffect(() => {
    fetch('/cdn-cgi/access/get-identity', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.email) setEmail(d.email); })
      .catch(() => {});
  }, []);

  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <h1 className="text-xl font-bold text-gray-900">yagiphone 管理画面</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{email}</span>
              <a href="/cdn-cgi/access/logout" className="text-sm text-red-600 hover:text-red-800">ログアウト</a>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
