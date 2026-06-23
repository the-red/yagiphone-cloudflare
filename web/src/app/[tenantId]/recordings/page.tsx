'use client';

import { useEffect, useState, use } from 'react';
import { ApiClient, type Recording } from '@/lib/api';
import { RecordingTable } from '@/components/RecordingTable';

const apiClient = new ApiClient('');

export default function RecordingsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiClient.listRecordings(tenantId);
        setRecordings(data || []);
      } catch (err) {
        console.error('録音一覧取得エラー:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [tenantId]);

  return (
    <div>
      <RecordingTable recordings={recordings} isLoading={isLoading} />
    </div>
  );
}
