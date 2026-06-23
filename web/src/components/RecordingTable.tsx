'use client';

import type { Recording } from '@/lib/api';

interface RecordingTableProps {
  recordings: Recording[];
  isLoading: boolean;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  } catch {
    return dateStr;
  }
}

function mp3Url(uri: string): string {
  const mp3Path = uri.replace('.json', '');
  return `https://api.twilio.com${mp3Path}`;
}

export function RecordingTable({ recordings, isLoading }: RecordingTableProps) {
  if (isLoading) {
    return <p className="text-gray-500">読み込み中...</p>;
  }

  if (recordings.length === 0) {
    return <p className="text-gray-500">録音がありません。</p>;
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-2">全{recordings.length}件</p>
      <table className="w-full text-sm bg-white rounded-lg shadow">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="text-left px-4 py-2">日時</th>
            <th className="text-left px-4 py-2">秒数</th>
            <th className="text-left px-4 py-2">通話SID</th>
            <th className="text-left px-4 py-2">録音</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((recording) => (
            <tr key={recording.sid} className="border-b hover:bg-gray-50">
              <td className="px-4 py-2">{formatDate(recording.dateCreated)}</td>
              <td className="px-4 py-2">{recording.duration}秒</td>
              <td className="px-4 py-2 font-mono text-xs">{recording.callSid}</td>
              <td className="px-4 py-2">
                <a
                  href={mp3Url(recording.uri)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800"
                >
                  再生
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
