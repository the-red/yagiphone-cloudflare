import { Navigation } from '@/components/Navigation';
import Link from 'next/link';

// 静的エクスポート用テナント一覧
export function generateStaticParams() {
  return [{ tenantId: 'hosoiri' }, { tenantId: 'ioridani' }];
}

// テナント表示名マップ
const tenantNames: Record<string, string> = {
  hosoiri: '細入自治会連合会',
  ioridani: '庵谷自治会',
};

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenantName = tenantNames[tenantId] || tenantId;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">
          ← テナント選択
        </Link>
        <span className="text-gray-400">/</span>
        <h2 className="text-lg font-semibold">{tenantName}</h2>
      </div>
      <Navigation tenantId={tenantId} />
      {children}
    </div>
  );
}
