'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavigationProps {
  tenantId: string;
}

// テナント配下のナビゲーション項目
const navItems = [
  { href: '', label: 'ダッシュボード' },
  { href: '/contacts', label: '名簿管理' },
  { href: '/recordings', label: '録音一覧' },
  { href: '/usage', label: '利用料金' },
];

export function Navigation({ tenantId }: NavigationProps) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 mb-6 border-b">
      {navItems.map((item) => {
        const href = `/${tenantId}${item.href}`;
        const isActive = pathname === href || pathname === `${href}/`;
        return (
          <Link
            key={item.href}
            href={`${href}/`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
