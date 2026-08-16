import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { Shield, Lock, Unlock, Paperclip } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface EmailSnippet {
  id: string;
  senderName: string;
  sender: string;
  subject: string;
  snippet: string;
  date: string;
  isQuMailEncrypted: boolean;
  hasAttachments: boolean;
  qumailEnvelope?: {
    securityLevel: number;
  };
}

export function InboxPage() {
  const [emails, setEmails] = useState<EmailSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadEmails() {
      try {
        const res = await api.get('/emails/inbox');
        setEmails(res.data.messages || []);
      } catch (err) {
        console.error('Failed to load inbox', err);
      } finally {
        setLoading(false);
      }
    }
    loadEmails();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-1/4"></div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-slate-200 dark:bg-slate-800 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-950">
      <div className="p-6 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold">Inbox</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {emails.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Inbox is empty.</div>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {emails.map((email) => (
              <li
                key={email.id}
                onClick={() => navigate(`/read/${email.id}`)}
                className="p-4 hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer transition-colors group"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {email.isQuMailEncrypted ? (
                      <Shield
                        className={`h-4 w-4 ${
                          email.qumailEnvelope?.securityLevel === 3
                            ? 'text-fuchsia-500'
                            : 'text-cyan-500'
                        }`}
                      />
                    ) : (
                      <Unlock className="h-4 w-4 text-slate-400" />
                    )}
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {email.senderName || email.sender}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {format(new Date(email.date), 'MMM d, h:mm a')}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">
                    {email.subject}
                  </span>
                  {email.hasAttachments && <Paperclip className="h-3 w-3 text-slate-400" />}
                </div>

                <div className="text-sm text-slate-500 dark:text-slate-400 truncate pr-4">
                  {email.isQuMailEncrypted ? (
                    <span className="flex items-center gap-1 italic">
                      <Lock className="h-3 w-3" /> Encrypted content
                    </span>
                  ) : (
                    email.snippet
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
