import Link from 'next/link';

export default async function TenantDashboard({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  // ダッシュボードカード一覧
  const cards = [
    { href: `/${tenantId}/contacts/`, title: '名簿管理', description: 'recorder / listener の追加・編集・削除' },
    { href: `/${tenantId}/recordings/`, title: '録音一覧', description: 'Twilio に保存された録音の一覧表示' },
    { href: `/${tenantId}/usage/`, title: '利用料金', description: '通話料金・利用実績の確認' },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 className="font-medium text-lg">{card.title}</h3>
          <p className="text-sm text-gray-500 mt-2">{card.description}</p>
        </Link>
      ))}
    </div>
  );
}
