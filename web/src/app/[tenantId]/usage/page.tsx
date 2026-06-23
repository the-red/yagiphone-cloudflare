'use client';

import { useEffect, useState, use } from 'react';
import { ApiClient, type UsageRecord } from '@/lib/api';
import { UsageTable } from '@/components/UsageTable';

const apiClient = new ApiClient('');

function getFiscalYearRange(): { startDate: string; endDate: string } {
  const now = new Date();
  let year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (month <= 2) {
    year -= 1;
  }

  const startDate = `${year}-03-01`;
  const endYear = year + 1;
  const endDate = `${endYear}-02-28`;

  return { startDate, endDate };
}

export default function UsagePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const defaultRange = getFiscalYearRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function loadUsage() {
    setIsLoading(true);
    try {
      const data = await apiClient.listUsageRecords(tenantId, startDate, endDate);
      setRecords(data || []);
    } catch (err) {
      console.error('利用料金取得エラー:', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-lg shadow flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">開始日</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">終了日</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={loadUsage}
          disabled={isLoading}
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? '取得中...' : '取得'}
        </button>
      </div>
      <UsageTable records={records} isLoading={isLoading} />
    </div>
  );
}
