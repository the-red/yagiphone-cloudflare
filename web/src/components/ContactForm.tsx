'use client';

import { useState } from 'react';
import type { CreateContactInput } from '@/lib/api';

interface ContactFormProps {
  onSubmit: (input: CreateContactInput) => Promise<void>;
}

export function ContactForm({ onSubmit }: ContactFormProps) {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [contactType, setContactType] = useState<'recorder' | 'listener'>('listener');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await onSubmit({ name, phoneNumber, contactType });
      setName('');
      setPhoneNumber('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white p-4 rounded-lg shadow space-y-4">
      <h3 className="font-medium">名簿追加</h3>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">名前</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="やまだ　たろう　さん"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            required
            className="w-full border rounded px-3 py-2 text-sm font-mono"
            placeholder="+819012345678"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">種別</label>
          <select
            value={contactType}
            onChange={(e) => setContactType(e.target.value as 'recorder' | 'listener')}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="listener">聴取者（listener）</option>
            <option value="recorder">録音者（recorder）</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? '追加中...' : '追加'}
          </button>
        </div>
      </div>
    </form>
  );
}
