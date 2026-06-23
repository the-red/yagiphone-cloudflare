import Link from 'next/link';

const tenants = [
  { id: 'hosoiri', name: '細入自治会連合会' },
  { id: 'ioridani', name: '庵谷自治会' },
];

export default function Home() {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">テナント選択</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {tenants.map((tenant) => (
          <Link
            key={tenant.id}
            href={`/${tenant.id}/`}
            className="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <h3 className="text-lg font-medium">{tenant.name}</h3>
            <p className="text-sm text-gray-500 mt-1">{tenant.id}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
