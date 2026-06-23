'use client';

import type { UsageRecord } from '@/lib/api';

interface UsageTableProps {
  records: UsageRecord[];
  isLoading: boolean;
}

const categoryLabels: Record<string, string> = {
  phonenumbers: '050電話番号',
  'calls-inbound': '電話着信',
  'calls-outbound': '電話発信',
  'calls-client': '電話テスト発信',
  recordings: '録音',
  'calls-text-to-speech': '自動音声利用',
  totalprice: '合計',
};

const displayCategories = Object.keys(categoryLabels);

const TAX_SWITCH_DATE = new Date('2023-05-01');
const TAX_RATE = 0.1;

function calculateTax(records: UsageRecord[], startDate: string, endDate: string): number | string {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start >= TAX_SWITCH_DATE) {
    const totalRecord = records.find((r) => r.category === 'totalprice');
    if (!totalRecord) return 0;
    return parseFloat(totalRecord.price) * TAX_RATE;
  }
  if (end < TAX_SWITCH_DATE) {
    return 0;
  }
  return '期間が税率切替日をまたいでいるため計算できません';
}

export function UsageTable({ records, isLoading }: UsageTableProps) {
  if (isLoading) {
    return <p className="text-gray-500">読み込み中...</p>;
  }

  if (records.length === 0) {
    return <p className="text-gray-500">利用実績がありません。</p>;
  }

  const filtered = records.filter((r) => displayCategories.includes(r.category));
  const totalRecord = filtered.find((r) => r.category === 'totalprice');
  const startDate = records[0]?.startDate || '';
  const endDate = records[0]?.endDate || '';
  const tax = calculateTax(records, startDate, endDate);
  const totalPrice = totalRecord ? parseFloat(totalRecord.price) : 0;
  const taxIncluded = typeof tax === 'number' ? totalPrice + tax : null;

  return (
    <div>
      <table className="w-full text-sm bg-white rounded-lg shadow">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="text-left px-4 py-2">カテゴリ</th>
            <th className="text-right px-4 py-2">回数</th>
            <th className="text-right px-4 py-2">使用量</th>
            <th className="text-right px-4 py-2">金額 (USD)</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((record) => (
            <tr key={record.category} className="border-b hover:bg-gray-50">
              <td className="px-4 py-2">{categoryLabels[record.category] || record.category}</td>
              <td className="px-4 py-2 text-right font-mono">{record.count} {record.countUnit}</td>
              <td className="px-4 py-2 text-right font-mono">{record.usage} {record.usageUnit}</td>
              <td className="px-4 py-2 text-right font-mono">${record.price}</td>
            </tr>
          ))}
          <tr className="border-t-2 bg-gray-50">
            <td className="px-4 py-2 font-medium">消費税</td>
            <td colSpan={2}></td>
            <td className="px-4 py-2 text-right font-mono">
              {typeof tax === 'number' ? `$${tax.toFixed(4)}` : tax}
            </td>
          </tr>
          {taxIncluded !== null && (
            <tr className="bg-gray-100 font-bold">
              <td className="px-4 py-2">税込合計</td>
              <td colSpan={2}></td>
              <td className="px-4 py-2 text-right font-mono">${taxIncluded.toFixed(4)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
