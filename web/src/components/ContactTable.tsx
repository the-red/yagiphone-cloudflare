'use client';

import type { Contact } from '@/lib/api';

interface ContactTableProps {
  contacts: Contact[];
  onDelete: (contactKey: string) => void;
  isLoading: boolean;
}

export function ContactTable({ contacts, onDelete, isLoading }: ContactTableProps) {
  if (isLoading) {
    return <p className="text-gray-500">読み込み中...</p>;
  }

  if (contacts.length === 0) {
    return <p className="text-gray-500">名簿が登録されていません。</p>;
  }

  const recorders = contacts.filter((c) => c.contactType === 'recorder');
  const listeners = contacts.filter((c) => c.contactType === 'listener');

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-medium text-lg mb-2">録音者（recorder）: {recorders.length}人</h3>
        <ContactList contacts={recorders} onDelete={onDelete} />
      </section>
      <section>
        <h3 className="font-medium text-lg mb-2">聴取者（listener）: {listeners.length}人</h3>
        <ContactList contacts={listeners} onDelete={onDelete} />
      </section>
    </div>
  );
}

function ContactList({ contacts, onDelete }: { contacts: Contact[]; onDelete: (key: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b bg-gray-50">
          <th className="text-left px-4 py-2">名前</th>
          <th className="text-left px-4 py-2">電話番号</th>
          <th className="text-right px-4 py-2">操作</th>
        </tr>
      </thead>
      <tbody>
        {contacts.map((contact) => (
          <tr key={contact.contactKey} className="border-b hover:bg-gray-50">
            <td className="px-4 py-2">{contact.name}</td>
            <td className="px-4 py-2 font-mono">{contact.phoneNumber}</td>
            <td className="px-4 py-2 text-right">
              <button
                onClick={() => onDelete(contact.contactKey)}
                className="text-red-600 hover:text-red-800 text-sm"
              >
                削除
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
